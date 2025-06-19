const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createQueue, processQueue } = require('../routes/services/serviceBull');
const { User, ChatMessage, ChatRoom } = require('../db');
const { findOrCreateOneOnOneRoom } = require('../routes/services/serviceChat');
const { handleGetChatRooms, handleGetMessageList } = require('../routes/controller/controllerChat');
const { toObjectId } = require('../utils/globalFunction');
// const ChatMessage = require('./models/ChatMessage');
// const ChatRoom = require('./models/ChatRoom');

const connectedUsers = {};
function setupSocket(server) {
    const io = new Server(server, {
        cors: {
            origin: '*',
        }
    });





    io.use((socket, next) => {
        // 1. Try to get token from handshake.auth.token (browser clients)
        let token = socket.handshake.auth.token;

        // 2. If not present, fallback to Authorization header (Postman, non-browser)
        if (!token && socket.handshake.headers.authorization) {
            token = socket.handshake.headers.authorization || socket.handshake.headers.Authorization;
        }

        if (!token) {
            return next(new Error('Authentication error: token missing'));
        }

        if (token.startsWith('Bearer ')) {
            token = token.slice(7);
        }

        try {
            const user = jwt.verify(token, process.env.JWT_SECRET_KEY);
            socket.user = user;
            next();
        } catch (err) {
            next(new Error('Authentication error: invalid token'));
        }
    });


    io.on('connection', (socket) => {
        const userId = socket.user.userId;
        let socketId = socket.id
        socket.join(`user_${userId}`);
        connectedUsers[socket.id] = userId;
        if (userId) {
            liveStatusQueue.add({ userId, isLive: true });
        }

        // Join room manually after
        socket.on('joinRoom', (roomInfo) => {
            const roomToJoin = typeof roomInfo === 'string' ? roomInfo : roomInfo.roomId;
            socket.join(roomToJoin);
            console.log(`User ${userId} joined room ${roomToJoin}`);
        });

        //sendMessage
        socket.on('sendMessage', async ({ roomId, type, content, mediaUrl, systemMeta, ...data }) => {
            let isNewRoom = false;
            if (!roomId) {
                if (!data.otherUserId) {
                    return socket.emit('error', { message: 'roomId or otherUserId required' });
                }
                // Use your service to find or create 1-on-1 room
                const { room, isNew } = await findOrCreateOneOnOneRoom(userId, data.otherUserId);
                roomId = room._id.toString();
                isNewRoom = isNew || false;
                socket.join(roomId); // join the socket room dynamically
            }
            const newMessage = new ChatMessage({
                chatRoom: roomId,
                sender: type === 'SYSTEM' || type === 'ORDER' ? null : userId,
                messageType: type,
                content,
                mediaUrl,
                systemMeta
            });
            await newMessage.save();
            const updatedRoom = await ChatRoom.findByIdAndUpdate(roomId, { lastMessage: newMessage._id, updatedAt: new Date() }, { new: true }).populate('lastMessage').populate('participants', 'userName profileImage');
            io.to(roomId).emit('newMessage', newMessage);

            const roomForSender = {
                ...updatedRoom.toObject(),
                participants: updatedRoom.participants.filter(p => p._id.toString() !== userId.toString())
            };

            const roomForReceiver = {
                ...updatedRoom.toObject(),
                participants: updatedRoom.participants.filter(p => p._id.toString() !== data.otherUserId.toString())
            };
            if (isNewRoom) {
                io.to(`user_${userId}`).emit('newChatRoom', {
                    ...roomForSender,
                    unreadCount: 0 // sender has no unread
                });

                const unreadCount = await ChatMessage.countDocuments({
                    chatRoom: roomId,
                    seenBy: { $nin: [toObjectId(data.otherUserId)] },
                    sender: { $ne: toObjectId(data.otherUserId) }
                });
                io.to(`user_${data.otherUserId}`).emit('newChatRoom', {
                    ...roomForReceiver,
                    unreadCount
                });
            } else {
                io.to(`user_${userId}`).emit('roomUpdated', {
                    ...roomForSender,
                    unreadCount: 0
                });

                const unreadCount = await ChatMessage.countDocuments({
                    chatRoom: roomId,
                    seenBy: { $ne: toObjectId(data.otherUserId) },
                    sender: { $ne: toObjectId(data.otherUserId) }
                });

                io.to(`user_${data.otherUserId}`).emit('roomUpdated', {
                    ...roomForReceiver,
                    unreadCount
                });
            }


        });

        socket.on('markMessagesAsSeen', async ({ roomId }) => {
            try {
                const userId = socket.user.userId;
                if (!roomId) return;
console.log("userIduserId",userId)
                // Update messages in this room that are not already seen by this user
                const result = await ChatMessage.updateMany(
                    {
                        chatRoom: roomId,
                        seenBy: { $ne: toObjectId(userId) },
                        sender: { $ne: toObjectId(userId) } // don't mark own messages
                    },
                    { $addToSet: { seenBy: toObjectId(userId) } }
                );
console.log("resultresultresult",result)

                if (result.modifiedCount > 0) {
                    // Notify all participants in the room that messages have been seen by this user
                    io.to(roomId).emit('messagesSeen', {
                        roomId,
                        userId,
                        seenAt: new Date().toISOString()
                    });

                    // Optionally, update unread counts for each participant in the room
                    // Fetch updated room and recalc unread counts for each user
                    const room = await ChatRoom.findById(roomId).populate('participants', '_id');

                    for (const participant of room.participants) {
                        const participantId = participant._id.toString();

                        // Skip the user who marked messages as seen (their unread is 0)
                        if (participantId === userId) {
                            io.to(`user_${participantId}`).emit('roomUpdated', {
                                ...room.toObject(),
                                unreadCount: 0
                            });
                            continue;
                        }

                        const unreadCount = await ChatMessage.countDocuments({
                            chatRoom: roomId,
                            seenBy: { $ne: toObjectId(participantId) },
                            sender: { $ne: toObjectId(participantId) }
                        });

                        io.to(`user_${participantId}`).emit('roomUpdated', {
                            ...room.toObject(),
                            unreadCount
                        });
                    }
                }

            } catch (error) {
                console.error('Error marking messages as seen:', error);
                socket.emit('error', { message: 'Failed to mark messages as seen' });
            }
        });


        socket.on('getChatRooms', (data) => {
            handleGetChatRooms(socket, data);
        });


        socket.on('getMessageList', (data) => {
            handleGetMessageList(socket, data);
        });


        socket.on('disconnect', () => {
            console.log(`🔴 User ${userId} disconnected`);
            delete connectedUsers[socket.id];
            if (userId) {
                liveStatusQueue.add({ userId, isLive: false });
            }
        });
    });

    return io;
}



// queue setup
const LIVE_STATUS_QUEUE = 'live-status-queue';
const liveStatusQueue = createQueue(LIVE_STATUS_QUEUE);
processQueue(liveStatusQueue, async (job) => {
    const { userId, isLive } = job.data;
    await User.findByIdAndUpdate(userId, { isLive });
    console.log(`Updated live status for user ${userId} to ${isLive}`);
});




module.exports = { setupSocket };
