const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
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
            token = socket.handshake.headers.authorization||socket.handshake.headers.Authorization;
        }
        
        if (!token) {
            return next(new Error('Authentication error: token missing'));
        }
        
        if (token.startsWith('Bearer ')) {
            token = token.slice(7);
        }
        console.log("socket.handshakesocket.handshake", socket.handshake)

        try {
            const user = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = user;
            next();
        } catch (err) {
            next(new Error('Authentication error: invalid token'));
        }
    });


    io.on('connection', (socket) => {
        const userId = socket.user.id;
        connectedUsers[socket.id] = userId;
        console.log(`🟢 Authenticated socket connected: ${userId}`);

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

module.exports = { setupSocket };
