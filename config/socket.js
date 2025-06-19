const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createQueue, processQueue } = require('../routes/services/serviceBull');
const { User, ChatMessage, ChatRoom } = require('../db');
const { findOrCreateOneOnOneRoom } = require('../routes/services/serviceChat');
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
        connectedUsers[socket.id] = userId;
        if (userId) {
            liveStatusQueue.add({ userId, isLive: true });
        }

        // Join room manually after
        socket.on('joinRoom', (roomId) => {
            socket.join(roomId.roomId);
            console.log(`User ${userId} joined room ${roomId.roomId}`);
        });

        socket.on('sendMessage', async ({ roomId, type, content, mediaUrl, systemMeta, ...data }) => {
            if (!roomId) {
                if (!data.otherUserId) {
                    return socket.emit('error', { message: 'roomId or otherUserId required' });
                }
                // Use your service to find or create 1-on-1 room
                const room = await findOrCreateOneOnOneRoom(userId, data.otherUserId);
                roomId = room._id.toString();
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
            await ChatRoom.findByIdAndUpdate(roomId, { lastMessage: newMessage._id });
            io.to(roomId).emit('newMessage', newMessage);
        });

        socket.on("newMessage", (msg) => {
            console.log("📩 New Message Received:", msg);
        });

        //for updating the List
        io.to(socketId).emit('newChatNotification', {
            roomId,
            message: newMessage
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
