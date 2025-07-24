const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createQueue, processQueue } = require('../routes/services/serviceBull');
const { User, ChatMessage, ChatRoom } = require('../db');
const { findOrCreateOneOnOneRoom } = require('../routes/services/serviceChat');
const { handleGetChatRooms, handleGetMessageList } = require('../routes/controller/controllerChat');
const { toObjectId } = require('../utils/globalFunction');
const path = require('path');

// Get base URL from environment or default to localhost
const BASE_URL = process.env.BASE_URL || 'http://localhost:9097';

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
            io.to(`user_${userId}`).emit('userLiveStatus', { userId, isLive: true });

        }

        // Join room manually after
        socket.on('joinRoom', (roomInfo) => {
            const roomToJoin = typeof roomInfo === 'string' ? roomInfo : roomInfo.roomId;
            socket.join(roomToJoin);
            console.log(`User ${userId} joined room ${roomToJoin}`);
        });

        //sendMessage
        socket.on('sendMessage', async ({ roomId, type, content, mediaUrl, fileName, systemMeta, ...data }) => {
            try {
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

                // Handle file uploads
                if (type === 'IMAGE' || type === 'VIDEO' || type === 'AUDIO' || type === 'FILE') {
                    try {
                        // Extract file data and type from base64
                        const matches = content.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);

                        if (!matches || matches.length !== 3) {
                            throw new Error('Invalid file data');
                        }

                        const fileType = matches[1];
                        const fileData = Buffer.from(matches[2], 'base64');

                        // Check file size (2MB)
                        if (fileData.length > 2 * 1024 * 1024) {
                            throw new Error('File size exceeds 2MB limit');
                        }

                        // Generate unique filename
                        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                        const sanitizedName = fileName.replace(/[^a-zA-Z0-9.]/g, '-');
                        const filename = uniqueSuffix + '-' + sanitizedName;
                        const filepath = path.join('public/uploads/chat/', filename);

                        // Create directory if it doesn't exist
                        const dir = path.dirname(filepath);
                        if (!require('fs').existsSync(dir)) {
                            require('fs').mkdirSync(dir, { recursive: true });
                        }

                        // Save file
                        require('fs').writeFileSync(filepath, fileData);

                        // Update content to be the full URL
                        const relativePath = `/uploads/chat/${filename}`;
                        content = `${BASE_URL}${relativePath}`;
                        mediaUrl = content;
                    } catch (error) {
                        console.error('File upload error:', error);
                        return socket.emit('error', { message: error.message });
                    }
                }

                // Handle product messages - validate and enrich product data
                if (type === 'PRODUCT') {
                    try {
                        if (!systemMeta?.productId) {
                            return socket.emit('error', { message: 'Product ID is required for product messages' });
                        }

                        // Fetch complete product data
                        const SellProduct = require('../db/models/SellProducts');
                        const product = await SellProduct.findById(systemMeta.productId)
                            .populate('categoryId', 'name')
                            .populate('subCategoryId', 'name')
                            .lean();

                        if (!product) {
                            return socket.emit('error', { message: 'Product not found' });
                        }

                        // Check if product is available for purchase
                        if (product.isSold && product.saleType === 'fixed') {
                            return socket.emit('error', { message: 'This product is already sold' });
                        }

                        // Enrich systemMeta with complete product data
                        systemMeta = {
                            ...systemMeta,
                            productId: product._id,
                            productName: product.title,
                            productImage: product.productImages?.[0] || null,
                            price: product.fixedPrice || product.auctionSettings?.startingPrice || 0,
                            saleType: product.saleType,
                            condition: product.condition,
                            category: product.categoryId?.name,
                            subCategory: product.subCategoryId?.name,
                            description: product.description,
                            isSold: product.isSold,
                            isActive: product.isActive,
                            // Auction specific data
                            ...(product.saleType === 'auction' && {
                                currentBid: product.auctionSettings?.currentBid,
                                startingBid: product.auctionSettings?.startingBid,
                                endTime: product.auctionSettings?.endTime,
                                bidCount: product.auctionSettings?.bidCount || 0
                            })
                        };

                        // Update content with product info
                        content = `Product: ${product.title}`;
                    } catch (error) {
                        console.error('Product message error:', error);
                        return socket.emit('error', { message: 'Failed to process product message' });
                    }
                }

                // Create message
                let newMessage = new ChatMessage({
                    chatRoom: roomId,
                    sender: (type === 'SYSTEM' || type === 'ORDER') ? null : userId,
                    messageType: type,
                    content,
                    mediaUrl,
                    fileName,
                    systemMeta
                });

                await newMessage.save();

                // Populate sender info
                newMessage = await newMessage.populate('sender', '_id userName profileImage');

                // For product messages, populate product info
                if (type === 'PRODUCT' && systemMeta?.productId) {
                    newMessage = await newMessage.populate('systemMeta.productId');
                }

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

                // Add null check for updatedRoom
                if (!updatedRoom) {
                    console.error(`Room not found with ID: ${roomId}`);
                    return socket.emit('error', { message: 'Room not found' });
                }

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
            } catch (error) {
                console.error('Error in sendMessage:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });




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
                const userId = socket.user?.userId;

                if (!otherUserId) {
                    return socket.emit('error', { message: 'otherUserId is required' });
                }

                const page = Math.max(1, parseInt(pageNo));
                const limit = Math.min(100, parseInt(size));
                const skip = (page - 1) * limit;

                // Find existing one-on-one room
                const room = await ChatRoom.findOne({
                    isGroup: false,
                    participants: { $all: [toObjectId(userId), toObjectId(otherUserId)], $size: 2 }
                });

                if (!room) {
                    return socket.emit('messageList', {
                        chatRoomId: null,
                        total: 0,
                        pageNo: page,
                        size: limit,
                        messages: [],
                        hasMore: false,
                        isNewRoom: true
                    });
                }

                const chatRoomId = room._id.toString();

                let messages = await ChatMessage.find({ chatRoom: chatRoomId })
                    .populate('sender', 'userName profileImage')
                    .sort({ createdAt: -1 }) // newest first
                    .skip(skip)
                    .limit(limit)
                    .lean();

                const totalMessages = await ChatMessage.countDocuments({ chatRoom: chatRoomId });

                // Optional: reverse to send oldest first
                messages = messages.reverse();

                socket.emit('messageList', {
                    chatRoomId,
                    total: totalMessages,
                    pageNo: page,
                    size: limit,
                    messages,
                    hasMore: totalMessages > page * limit,
                    isNewRoom: false
                });

            } catch (error) {
                console.error('❌ Error in getMessagesWithUser:', error);
                socket.emit('error', { message: 'Failed to get messages with user' });
            }
        });


        socket.on('getTotalUnreadCount', async () => {
            const userId = socket.user?.userId;
            if (!userId) return;

            await emitTotalUnreadCount(io, userId);
        });



        socket.on('markAllNotificationsAsRead', async () => {
            try {
                const userId = socket.user?.userId;
                if (!userId) return;


                await updateNotificationQueue.add({ userId });

                socket.emit('allNotificationsMarkedAsRead', {
                    success: true,
                    queued: true,
                    timestamp: new Date().toISOString()
                });


                // const { Notification } = require('../db');
                // await Notification.updateMany(
                //     { userId: toObjectId(userId), read: false },
                //     { read: true }
                // );



            } catch (error) {
                console.error('Error marking notifications as read:', error);
                socket.emit('error', { message: 'Failed to mark notifications as read' });
            }
        });



        // Mark all messages in a specific room as read (accepts roomId or otherUserId)
        socket.on('markRoomMessagesAsRead', async ({ roomId, otherUserId }) => {
            try {
                const userId = socket.user?.userId;
                if (!userId) return;

                let targetRoomId = roomId;

                // If roomId not provided, find room using otherUserId
                if (!targetRoomId && otherUserId) {
                    const room = await ChatRoom.findOne({
                        isGroup: false,
                        participants: { $all: [toObjectId(userId), toObjectId(otherUserId)], $size: 2 }
                    });

                    if (!room) {
                        return socket.emit('error', { message: 'Chat room not found' });
                    }

                    targetRoomId = room._id.toString();
                }

                if (!targetRoomId) {
                    return socket.emit('error', { message: 'roomId or otherUserId is required' });
                }

                // Mark ALL messages in this room as read for current user
                const result = await ChatMessage.updateMany(
                    {
                        chatRoom: toObjectId(targetRoomId),
                        seenBy: { $ne: toObjectId(userId) },
                        sender: { $ne: toObjectId(userId) }
                    },
                    { $addToSet: { seenBy: toObjectId(userId) } }
                );

                if (result.modifiedCount > 0) {
                    // Broadcast seen event to room
                    io.to(targetRoomId).emit('messagesSeen', {
                        roomId: targetRoomId,
                        userId,
                        seenAt: new Date().toISOString(),
                        allMessages: true
                    });

                    // Update room info for all participants
                    const room = await ChatRoom.findById(targetRoomId)
                        .populate('participants', '_id userName profileImage')
                        .populate('lastMessage');

                    if (room) {
                        const roomObj = room.toObject();
                        await Promise.all(room.participants.map(async (participant) => {
                            const participantId = participant._id?.toString();
                            let unreadCount = 0;
                            if (participantId !== userId) {
                                unreadCount = await ChatMessage.countDocuments({
                                    chatRoom: targetRoomId,
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

                    // Emit updated total unread count
                    await emitTotalUnreadCount(io, userId);
                }

                socket.emit('roomMessagesMarkedAsRead', {
                    success: true,
                    roomId: targetRoomId,
                    messagesCount: result.modifiedCount,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                console.error('❌ Error in markRoomMessagesAsRead:', error);
                socket.emit('error', { message: 'Failed to mark room messages as read' });
            }
        });

        // Mark all messages across all chats as read
        socket.on('markAllChatsAsRead', async () => {
            try {
                const userId = socket.user?.userId;
                if (!userId) return;

                // Get all user's chat rooms
                const userRooms = await ChatRoom.find({
                    participants: toObjectId(userId)
                }).select('_id');

                const roomIds = userRooms.map(room => room._id);

                // Mark all messages as seen across all rooms
                const result = await ChatMessage.updateMany(
                    {
                        chatRoom: { $in: roomIds },
                        seenBy: { $ne: toObjectId(userId) },
                        sender: { $ne: toObjectId(userId) }
                    },
                    { $addToSet: { seenBy: toObjectId(userId) } }
                );

                // Emit updated total count
                await emitTotalUnreadCount(io, userId);

                socket.emit('allChatsMarkedAsRead', {
                    success: true,
                    roomsCount: roomIds.length,
                    messagesCount: result.modifiedCount,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                console.error('Error marking all chats as read:', error);
                socket.emit('error', { message: 'Failed to mark all chats as read' });
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


    // Send total unread count to user
    async function emitTotalUnreadCount(io, userId) {
        try {
            const [chatUnreadCount, notificationUnreadCount] = await Promise.all([
                calculateTotalChatUnreadCount(userId),
                calculateTotalNotificationUnreadCount(userId)
            ]);

            const totalUnreadCount = chatUnreadCount + notificationUnreadCount;

            io.to(`user_${userId}`).emit('totalUnreadCount', {
                chatUnreadCount,
                notificationUnreadCount,
                totalUnreadCount,
                timestamp: new Date().toISOString()
            });

            return { chatUnreadCount, notificationUnreadCount, totalUnreadCount };
        } catch (error) {
            console.error('Error emitting total unread count:', error);
        }
    }

    return io;
}






async function calculateTotalChatUnreadCount(userId) {
    try {
        // Get all chat rooms for this user
        const userRooms = await ChatRoom.find({
            participants: toObjectId(userId)
        }).select('_id');

        const roomIds = userRooms.map(room => room._id);

        // Count all unread messages across all rooms
        const totalChatUnread = await ChatMessage.countDocuments({
            chatRoom: { $in: roomIds },
            seenBy: { $ne: toObjectId(userId) },
            sender: { $ne: toObjectId(userId) }
        });

        return totalChatUnread;
    } catch (error) {
        console.error('Error calculating total chat unread:', error);
        return 0;
    }
}

// Calculate total unread notifications for a user  
async function calculateTotalNotificationUnreadCount(userId) {
    try {
        const { Notification } = require('../db');
        const totalNotificationUnread = await Notification.countDocuments({
            userId: toObjectId(userId),
            read: false
        });
        return totalNotificationUnread;
    } catch (error) {
        console.error('Error calculating notification unread:', error);
        return 0;
    }
}





// queue setup
const LIVE_STATUS_QUEUE = 'live-status-queue';

const UPDATE_NOTIFICATION = 'updateNotification';
const updateNotificationQueue = createQueue(UPDATE_NOTIFICATION);

processQueue(updateNotificationQueue, async (job) => {
    const { userId } = job.data;

    const { Notification } = require('../db');
    await Notification.updateMany(
        { userId: toObjectId(userId), read: false },
        { read: true }
    );

    console.log(`Marked all notifications as read for user ${userId}`);
});



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
