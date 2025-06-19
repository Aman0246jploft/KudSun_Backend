const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createQueue, processQueue } = require('../routes/services/serviceBull');
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
        connectedUsers[socket.id] = userId;
        console.log(`🟢 Authenticated socket connected: ${userId}`);
        if (userId){

        }

            // Join room manually after
            socket.on('joinRoom', (roomId) => {
                socket.join(roomId);
                console.log(`User ${userId} joined room ${roomId}`);
            });

        socket.on('sendMessage', async ({ roomId, type, content, mediaUrl, systemMeta }) => {
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

        socket.on('disconnect', () => {
            console.log(`🔴 User ${userId} disconnected`);
            delete connectedUsers[socket.id];
        });
    });

    return io;
}



// queue setup
const LIVE_STATUS_QUEUE = 'live-status-queue';
const liveStatusQueue = createQueue(LIVE_STATUS_QUEUE);
processQueue(liveStatusQueue, async (job) => {
    const { userId, isLive } = job.data;

    // Update in Redis or DB (example using Redis SET)
    await client.set(`user:${userId}:isLive`, isLive ? '1' : '0');

    console.log(`Updated live status for user ${userId} to ${isLive}`);
});




module.exports = { setupSocket };
