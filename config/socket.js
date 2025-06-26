const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createQueue, processQueue } = require('../routes/services/serviceBull');
const { User, ChatMessage, ChatRoom } = require('../db');
const { findOrCreateOneOnOneRoom } = require('../routes/services/serviceChat');
const { handleGetChatRooms, handleGetMessageList } = require('../routes/controller/controllerChat');
const { toObjectId } = require('../utils/globalFunction');


const connectedUsers = {};
async function setupSocket(server) {
    await resetAllLiveStatuses();
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
            io.to(`user_${userId}`).emit('userLiveStatus', { userId, isLive:true });

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
                roomId = room._id?.toString();
                isNewRoom = isNew || false;
                socket.join(roomId); // join the socket room dynamically
            }
            let newMessage = new ChatMessage({
                chatRoom: roomId,
                sender: (type === 'SYSTEM' || type === 'ORDER') ? null : userId,
                messageType: type,
                content,
                mediaUrl,
                systemMeta
            });
            await newMessage.save();

            // Correct way in Mongoose 6+
            newMessage = await newMessage.populate('sender', '_id userName profileImage');

            const updatedRoom = await ChatRoom.findByIdAndUpdate(
                roomId,
                { lastMessage: newMessage._id, updatedAt: new Date() },
                { new: true }
            ).populate('lastMessage').populate('participants', 'userName profileImage');

            const messageWithRoom = {
                ...newMessage.toObject(),
                chatRoom: roomId
            };

            io.to(roomId).emit('newMessage', messageWithRoom);


            const roomForSender = {
                ...updatedRoom.toObject(),
                participants: updatedRoom.participants.filter(p => p._id?.toString() !== userId?.toString())
            };

            const roomForReceiver = {
                ...updatedRoom.toObject(),
                participants: updatedRoom.participants.filter(p => p._id?.toString() !== data.otherUserId?.toString())
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

        // socket.on('markMessagesAsSeen', async ({ roomId }) => {
        //     try {
        //         const userId = socket.user?.userId;
        //         if (!roomId || !userId) return;
        //         const unseenMessages = await ChatMessage.find({
        //             chatRoom: toObjectId(roomId),
        //             seenBy: { $ne: toObjectId(userId) },
        //             sender: { $ne: toObjectId(userId) }
        //         });

        //         console.log("📥 Unseen messages for user:", unseenMessages.length);


        //         // Mark messages as seen (exclude user's own messages)
        //         const result = await ChatMessage.updateMany(
        //             {
        //                 chatRoom: toObjectId(roomId),
        //                 seenBy: { $ne: toObjectId(userId) },
        //                 sender: { $ne: toObjectId(userId) }
        //             },
        //             { $addToSet: { seenBy: toObjectId(userId) } }
        //         );

        //         if (result.modifiedCount > 0) {
        //             // Broadcast seen event to room
        //             io.to(roomId).emit('messagesSeen', {
        //                 roomId,
        //                 userId,
        //                 seenAt: new Date().toISOString()
        //             });

        //             // Fetch room with participants
        //             const room = await ChatRoom.findById(roomId)
        //                 .populate('participants', '_id userName profileImage')
        //                 .populate('lastMessage');

        //             if (!room) return;

        //             const roomObj = room.toObject();

        //             // Notify each participant with updated unread count
        //             await Promise.all(room.participants.map(async (participant) => {
        //                 const participantId = participant._id?.toString();

        //                 let unreadCount = 0;
        //                 if (participantId !== userId) {
        //                     unreadCount = await ChatMessage.countDocuments({
        //                         chatRoom: roomId,
        //                         seenBy: { $ne: toObjectId(participantId) },
        //                         sender: { $ne: toObjectId(participantId) }
        //                     });
        //                 }

        //                 io.to(`user_${participantId}`).emit('roomUpdated', {
        //                     ...roomObj,
        //                     participants: roomObj.participants.filter(p => p._id?.toString() !== participantId),
        //                     unreadCount
        //                 });
        //             }));
        //         }

        //     } catch (error) {
        //         console.error('❌ Error in markMessagesAsSeen:', error);
        //         socket.emit('error', { message: 'Failed to mark messages as seen' });
        //     }
        // });



        socket.on('markMessagesAsSeen', async ({ roomId }) => {
            try {
                const userId = socket.user?.userId;
                if (!roomId || !userId) return;

                const unseenMessages = await ChatMessage.find({
                    chatRoom: toObjectId(roomId),
                    seenBy: { $ne: toObjectId(userId) },
                    sender: { $ne: toObjectId(userId) }
                });

                console.log("📥 Unseen messages for user:", unseenMessages.length);

                // Mark messages as seen (exclude user's own messages)
                const result = await ChatMessage.updateMany(
                    {
                        chatRoom: toObjectId(roomId),
                        seenBy: { $ne: toObjectId(userId) },
                        sender: { $ne: toObjectId(userId) }
                    },
                    { $addToSet: { seenBy: toObjectId(userId) } }
                );

                if (result.modifiedCount > 0) {
                    // Broadcast seen event to room
                    io.to(roomId).emit('messagesSeen', {
                        roomId,
                        userId,
                        seenAt: new Date().toISOString()
                    });

                    // Fetch room with participants
                    const room = await ChatRoom.findById(roomId)
                        .populate('participants', '_id userName profileImage')
                        .populate('lastMessage');

                    if (!room) return;

                    const roomObj = room.toObject();

                    // Notify each participant with updated unread count
                    await Promise.all(room.participants.map(async (participant) => {
                        const participantId = participant._id?.toString();

                        let unreadCount = 0;
                        if (participantId !== userId) {
                            unreadCount = await ChatMessage.countDocuments({
                                chatRoom: roomId,
                                seenBy: { $ne: toObjectId(participantId) },
                                sender: { $ne: toObjectId(participantId) }
                            });
                        }

                        io.to(`user_${participantId}`).emit('roomUpdated', {
                            ...roomObj,
                            participants: roomObj.participants.filter(p => p._id?.toString() !== participantId),
                            unreadCount
                        });
                    }));
                }
            } catch (error) {
                console.error('❌ Error in markMessagesAsSeen:', error);
                socket.emit('error', { message: 'Failed to mark messages as seen' });
            }
        });




        socket.on('getChatRooms', (data) => {
            handleGetChatRooms(socket, data);
        });


        socket.on('getMessageList', (data) => {
            handleGetMessageList(socket, data);
        });

        socket.on('getMessagesWithUser', async ({ otherUserId, pageNo = 1, size = 20 }) => {
            try {
                const userId = socket.user.userId;

                if (!otherUserId) {
                    return socket.emit('error', { message: 'otherUserId is required' });
                }

                // Try to find existing one-on-one room (don't create)
                const room = await ChatRoom.findOne({
                    isGroup: false,
                    participants: { $all: [toObjectId(userId), toObjectId(otherUserId)], $size: 2 }
                });

                if (!room) {
                    // No existing room, return empty result
                    return socket.emit('messageList', {
                        chatRoomId: null,
                        total: 0,
                        pageNo: parseInt(pageNo),
                        size: parseInt(size),
                        messages: [],
                        isNewRoom: true
                    });
                }

                const chatRoomId = room._id?.toString();
                const page = parseInt(pageNo);
                const limit = parseInt(size);
                const skip = (page - 1) * limit;

                const messages = await ChatMessage.find({ chatRoom: chatRoomId })
                    .populate('sender', 'userName profileImage')
                    .sort({ createdAt: 1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                const totalMessages = await ChatMessage.countDocuments({ chatRoom: chatRoomId });

                socket.emit('messageList', {
                    chatRoomId,
                    total: totalMessages,
                    pageNo: page,
                    size: limit,
                    messages,
                    isNewRoom: false
                });

            } catch (error) {
                console.error('❌ Error in getMessagesWithUser:', error);
                socket.emit('error', { message: 'Failed to get messages with user' });
            }
        });

        socket.on('disconnect', () => {
            console.log(`🔴 User ${userId} disconnected`);
            delete connectedUsers[socket.id];
            if (userId) {
                liveStatusQueue.add({ userId, isLive: false });
                io.to(`user_${userId}`).emit('userLiveStatus', { userId, isLive: false });

            }
        });


        socket.on("connect_error", (err) => {
            console.error("❌ Socket connection error:", err.message, err);
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


async function resetAllLiveStatuses() {
    try {
        await User.updateMany({ isLive: true }, { isLive: false });
        console.log('✅ Reset all user live statuses on server start');
    } catch (err) {
        console.error('❌ Failed to reset live statuses:', err);
    }
}


module.exports = { setupSocket, resetAllLiveStatuses };
