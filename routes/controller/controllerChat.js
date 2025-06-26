
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const HTTP_STATUS = require('../../utils/statusCode');
const CONSTANTS = require('../../utils/constants');
const { ChatRoom, ChatMessage } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');

async function handleGetChatRooms(socket, data) {
    try {
        const userId = socket.user.userId;
        const page = parseInt(data.pageNo) || 1;
        const limit = parseInt(data.size) || 10;
        const skip = (page - 1) * limit;
        const keyWord = data.keyWord?.toLowerCase() || '';

        const chatRoomsQuery = ChatRoom.find({ participants: toObjectId(userId) })
            .populate({
                path: 'lastMessage',
                select: 'text createdAt sender content messageType',
                populate: { path: 'sender', select: 'userName profileImage' }
            })
            .populate({
                path: 'participants',
                select: 'userName profileImage isLive'
            })
            .sort({ updatedAt: -1 }) // Prefer updatedAt instead of createdAt for relevance
            .lean();

        const chatRooms = await chatRoomsQuery.exec();

        // Filter participants and keyword search
        const filteredRooms = chatRooms 
            .map(room => {
                const otherParticipants = room.participants.filter(
                    p => p._id.toString() !== userId.toString()
                );
                return { ...room, participants: otherParticipants };
            })
            .filter(room => {
                if (!keyWord) return true;
                return room.participants.some(p =>
                    p.userName?.toLowerCase().includes(keyWord)
                );
            });

        // Calculate unread message count for each room
        const unreadCounts = await Promise.all(
            filteredRooms.map(room =>
                ChatMessage.countDocuments({
                    chatRoom: room._id,
                    seenBy: { $ne: toObjectId(userId) },
                    sender: { $ne: toObjectId(userId) } // exclude own messages
                })
            )
        );

        // Attach unreadCount to each room
        const enrichedRooms = filteredRooms.map((room, index) => ({
            ...room,
            unreadCount: unreadCounts[index]
        }));

        // Apply pagination
        const paginatedRooms = enrichedRooms.slice(skip, skip + limit);

        // Emit chat room list with unread count
        socket.emit('chatRoomsList', {
            total: enrichedRooms.length,
            pageNo: page,
            size: limit,
            chatRooms: paginatedRooms
        });

    } catch (error) {
        console.error('Error fetching chat rooms:', error);
        socket.emit('error', { message: error.message });
    }
}



async function handleGetMessageList(socket, data) {
    try {
        const userId = socket.user?.userId;
        const { chatRoomId, pageNo = 1, size = 20 } = data;

        if (!chatRoomId) {
            return socket.emit('error', { message: 'chatRoomId is required' });
        }

        const page = Math.max(1, parseInt(pageNo));
        const limit = Math.min(100, parseInt(size)); // limit max size
        const skip = (page - 1) * limit;

        // Fetch messages sorted by newest first
        let messages = await ChatMessage.find({ chatRoom: chatRoomId })
            .populate('sender', 'userName profileImage')
            .sort({ createdAt: -1 }) // newest first
            .skip(skip)
            .limit(limit)
            .lean();

        const totalMessages = await ChatMessage.countDocuments({ chatRoom: chatRoomId });

        // Optional: Reverse if client expects ascending order
        messages = messages.reverse();

        socket.emit('messageList', {
            chatRoomId,
            total: totalMessages,
            pageNo: page,
            size: limit,
            hasMore: totalMessages > page * limit,
            messages,
        });

    } catch (error) {
        console.error('Error fetching message list:', error);
        socket.emit('error', { message: 'Failed to fetch messages' });
    }
}






module.exports = { handleGetChatRooms, handleGetMessageList };