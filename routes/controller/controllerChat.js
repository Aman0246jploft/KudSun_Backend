const express = require("express");
const multer = require("multer");
const upload = multer();
const router = express.Router();
const HTTP_STATUS = require("../../utils/statusCode");
const CONSTANTS = require("../../utils/constants");
const { ChatRoom, ChatMessage, Notification, BlockUser } = require("../../db");
const perApiLimiter = require("../../middlewares/rateLimiter");
const {
  apiErrorRes,
  apiSuccessRes,
  toObjectId,
} = require("../../utils/globalFunction");

async function handleGetChatRooms(socket, user, data) {
  try {
    let userId = user || socket.user.userId;

    // Safety check for userId
    if (!userId) {
      return socket.emit("error", { message: "User ID is required" });
    }

    // Ensure data exists
    const requestData = data || {};

    const page = Math.max(1, parseInt(requestData.pageNo) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(requestData.size) || 10)); // Limit max to 50
    const skip = (page - 1) * limit;
    const keyWord = requestData.keyWord?.toLowerCase() || "";

    // Use the same filtering logic as getVisibleRooms to exclude deleted rooms
    const chatRoomsQuery = ChatRoom.find({
      participants: toObjectId(userId),
      $and: [
        { isDeleted: false },
        {
          $or: [
            { deleteBy: { $size: 0 } },
            { "deleteBy.userId": { $ne: toObjectId(userId) } },
          ],
        },
      ],
    })
      .populate({
        path: "lastMessage",
        select: "text createdAt sender content messageType",
        populate: { path: "sender", select: "userName profileImage" },
      })
      .populate({
        path: "participants",
        select: "userName profileImage isLive is_Verified_Seller is_Preferred_seller",
      })
      .sort({ updatedAt: -1 }) // Prefer updatedAt instead of createdAt for relevance
      .lean();

    const chatRooms = await chatRoomsQuery.exec();

    // Filter participants and keyword search
    const filteredRooms = chatRooms
      .map((room) => {
        const otherParticipants = room.participants.filter(
          (p) => p._id.toString() !== userId.toString()
        );
        return { ...room, participants: otherParticipants };
      })
      .filter((room) => {
        if (!keyWord) return true;
        return room.participants.some((p) =>
          p.userName?.toLowerCase().includes(keyWord)
        );
      });

    // Calculate unread message count for each room
    const unreadCounts = await Promise.all(
      filteredRooms.map((room) =>
        ChatMessage.countDocuments({
          chatRoom: room._id,
          seenBy: { $ne: toObjectId(userId) },
          sender: { $ne: toObjectId(userId) }, // exclude own messages
          $and: [
            { isDeleted: false },
            {
              $or: [
                { deleteBy: { $size: 0 } },
                { "deleteBy.userId": { $ne: toObjectId(userId) } },
              ],
            },
          ],
        })
      )
    );

    // Attach unreadCount to each room
    const enrichedRooms = filteredRooms.map((room, index) => ({
      ...room,
      unreadCount: unreadCounts[index],
    }));

    // Apply pagination
    const paginatedRooms = enrichedRooms.slice(skip, skip + limit);

    // Fetch latest activity notification for the user
    const latestNotification = await Notification.findOne({
      recipientId: toObjectId(userId),
      // type: 'activity'
    })
      .sort({ createdAt: -1 }) // newest first
      .lean();

    let activity = null;
    if (latestNotification) {
      activity = {
        title: latestNotification.title,
        createdAt: latestNotification.createdAt,
      };
    }

    // Emit chat room list with unread count
    socket.emit("chatRoomsList", {
      total: enrichedRooms.length,
      pageNo: page,
      size: limit,
      chatRooms: paginatedRooms,
      activity: activity,
    });
  } catch (error) {
    console.error("Error fetching chat rooms:", error);
    socket.emit("error", { message: error.message });
  }
}

async function handleGetMessageList(socket, data) {
  try {
    const userId = socket.user?.userId;
    const { chatRoomId, pageNo = 1, size = 20 } = data;

    if (!chatRoomId) {
      return socket.emit("error", { message: "chatRoomId is required" });
    }

    const page = Math.max(1, parseInt(pageNo));
    const limit = Math.min(100, parseInt(size)); // limit max size
    const skip = (page - 1) * limit;

    // Use getVisibleMessages to exclude deleted messages for this user
    let messages = await ChatMessage.getVisibleMessages(
      { chatRoom: toObjectId(chatRoomId) },
      toObjectId(userId)
    )
      .populate("sender", "userName profileImage")
      .sort({ createdAt: -1 }) // newest first
      .skip(skip)
      .limit(limit)
      .lean();

    const totalMessages = await ChatMessage.countDocuments({
      chatRoom: toObjectId(chatRoomId),
      $and: [
        { isDeleted: false },
        {
          $or: [
            { deleteBy: { $size: 0 } },
            { "deleteBy.userId": { $ne: toObjectId(userId) } },
          ],
        },
      ],
    });

    // Optional: Reverse if client expects ascending order
    messages = messages.reverse();



    // ✅ Check block status
    const otherUserId =
      messages.length > 0
        ? messages[0].sender._id.toString() === userId.toString()
          ? messages[0].receiver?.toString()
          : messages[0].sender._id
        : null;

    let blocked = false;
    if (otherUserId) {
      const isBlocked = await BlockUser.findOne({
        $or: [
          { blockBy: toObjectId(userId), userId: toObjectId(otherUserId) },
          { blockBy: toObjectId(otherUserId), userId: toObjectId(userId) },
        ],
      });

      blocked = !!isBlocked;
    }


    socket.emit("messageList", {
      chatRoomId,
      total: totalMessages,
      pageNo: page,
      size: limit,
      hasMore: totalMessages > page * limit,
      messages,
      blocked
    });
  } catch (error) {
    console.error("Error fetching message list:", error);
    socket.emit("error", { message: "Failed to fetch messages" });
  }
}

module.exports = { handleGetChatRooms, handleGetMessageList };
