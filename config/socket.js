const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { createQueue, processQueue } = require("../routes/services/serviceBull");
const { User, ChatMessage, ChatRoom, Notification, BlockUser } = require("../db");
const moment = require("moment");

const { findOrCreateOneOnOneRoom } = require("../routes/services/serviceChat");
const {
  handleGetChatRooms,
  handleGetMessageList,
} = require("../routes/controller/controllerChat");
const { toObjectId } = require("../utils/globalFunction");
const path = require("path");
const {
  NOTIFICATION_TYPES,
  createStandardizedNotificationMeta,
} = require("../utils/Role");
const { saveNotification } = require("../routes/services/serviceNotification");

// Get base URL from environment or default to localhost
const BASE_URL = process.env.BASE_URL || "http://localhost:9194";

const connectedUsers = {};
async function setupSocket(server) {
  await resetAllLiveStatuses();
  const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });
  io.use((socket, next) => {
    // 1. Try to get token from handshake.auth.token (browser clients)
    let token = socket.handshake.auth.token;

    // 2. If not present, fallback to Authorization header (Postman, non-browser)
    if (!token && socket.handshake.headers.authorization) {
      token =
        socket.handshake.headers.authorization ||
        socket.handshake.headers.Authorization;
    }

    if (!token) {
      return next(new Error("Authentication error: token missing"));
    }

    if (token.startsWith("Bearer ")) {
      token = token.slice(7);
    }
    try {
      const user = jwt.verify(token, process.env.JWT_SECRET_KEY);
      socket.user = user;
      next();
    } catch (err) {
      next(new Error("Authentication error: invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user.userId;
    const userName = socket.user.userName;
    // console.log("userId",userId)

    let socketId = socket.id;
    socket.join(`user_${userId}`);
    connectedUsers[socket.id] = userId;
    if (userId) {
      liveStatusQueue.add({ userId, isLive: true });
      io.to(`user_${userId}`).emit("userLiveStatus", { userId, isLive: true });
    }

    // Join room manually after
    socket.on("joinRoom", (roomInfo) => {
      const roomToJoin =
        typeof roomInfo === "string" ? roomInfo : roomInfo.roomId;
      socket.join(roomToJoin);
      // console.log(`User ${userId} joined room ${roomToJoin}`);
    });

    //sendMessage
    socket.on(
      "sendMessage",
      async ({
        roomId,
        type,
        content,
        mediaUrl,
        fileName,
        systemMeta,
        ...data
      }) => {
        try {
          let isNewRoom = false;
          let roomRestored = false;

          if (!roomId) {
            if (!data.otherUserId) {
              return socket.emit("error", {
                message: "roomId or otherUserId required",
              });
            }
            // Use your service to find or create 1-on-1 room
            const result = await findOrCreateOneOnOneRoom(
              userId,
              data.otherUserId
            );
            if (result.statusCode === 500) {
              return socket.emit("error", { message: result.message });
            }
            const { room, isNew } = result;
            roomId = room._id?.toString();
            isNewRoom = isNew || false;

            // Check if room was restored (existed but was deleted)
            if (!isNew) {
              // Room existed, check if it was just restored
              const roomCheck = await ChatRoom.findById(roomId);
              const wasDeletedForSender = roomCheck.deleteBy.length > 0;
              if (wasDeletedForSender) {
                roomRestored = true;
                console.log(
                  `✅ Room ${roomId} was restored for conversation between ${userId} and ${data.otherUserId}`
                );
              }
            }

            socket.join(roomId); // join the socket room dynamically
          } else {
            // Room ID provided, ensure user can access it
            const room = await ChatRoom.findById(roomId);
            if (!room || room.isDeleted) {
              return socket.emit("error", {
                message: "Room not found or deleted",
              });
            }

            // Check if room is deleted for current user and restore if needed
            const isDeletedForUser = room.deleteBy.some(
              (del) => del.userId.toString() === userId
            );
            if (isDeletedForUser) {
              await ChatRoom.findByIdAndUpdate(roomId, {
                $pull: {
                  deleteBy: { userId: toObjectId(userId) },
                },
              });

              // DO NOT restore old messages - user should only see new messages after room restoration
              // Old messages remain deleted for this user to maintain the "fresh start" experience

              roomRestored = true;
              console.log(
                `✅ Room ${roomId} was restored for user ${userId} (old messages remain hidden)`
              );
            }

            socket.join(roomId);
          }

          if (data.otherUserId) {
            const usersToNotify = await User.find(
              {
                _id: toObjectId(data.otherUserId),
                dealChatnotification: true,
              },
              "_id"
            );

            const notification = [
              {
                recipientId: data.otherUserId,
                userId: userId,
                type: NOTIFICATION_TYPES.CHAT,
                title: `New message from ${userName}`,
                message: `You have received a new message in chat.`,
                meta: createStandardizedNotificationMeta({
                  roomId: roomId,
                  userName: userName,
                }),
              },
            ];
            if (usersToNotify && usersToNotify.length > 0) {
              await saveNotification(notification, true);
            }
          } else {
            const room = await ChatRoom.findById(roomId).lean();

            const otherParticipants = room.participants.filter(
              (p) => p.toString() !== userId
            );
            const usersToNotify = await User.find(
              {
                _id: { $in: toObjectId(otherParticipants) },

                dealChatnotification: true,
              },
              "_id"
            );
            for (const user of usersToNotify) {
              const notification = [
                {
                  recipientId: user._id,
                  userId: userId,
                  type: NOTIFICATION_TYPES.CHAT,
                  title: `New message from ${userName}`,
                  message: `You have received a new message in chat.`,
                  meta: createStandardizedNotificationMeta({
                    roomId: roomId,
                    userName: userName,
                  }),
                },
              ];
              await saveNotification(notification, true);
            }
          }

          // Handle file uploads
          if (
            type === "IMAGE" ||
            type === "VIDEO" ||
            type === "AUDIO" ||
            type === "FILE"
          ) {
            try {
              // Extract file data and type from base64
              const matches = content.match(
                /^data:([A-Za-z-+/]+);base64,(.+)$/
              );

              if (!matches || matches.length !== 3) {
                throw new Error("Invalid file data");
              }

              const fileType = matches[1];
              const fileData = Buffer.from(matches[2], "base64");

              // Check file size (2MB)
              if (fileData.length > 2 * 1024 * 1024) {
                throw new Error("File size exceeds 2MB limit");
              }

              // Generate unique filename
              const uniqueSuffix =
                Date.now() + "-" + Math.round(Math.random() * 1e9);
              const sanitizedName = fileName.replace(/[^a-zA-Z0-9.]/g, "-");
              const filename = uniqueSuffix + "-" + sanitizedName;
              const filepath = path.join("public/uploads/chat/", filename);

              // Create directory if it doesn't exist
              const dir = path.dirname(filepath);
              if (!require("fs").existsSync(dir)) {
                require("fs").mkdirSync(dir, { recursive: true });
              }

              // Save file
              require("fs").writeFileSync(filepath, fileData);

              // Update content to be the full URL
              const relativePath = `/uploads/chat/${filename}`;
              content = `${BASE_URL}${relativePath}`;
              mediaUrl = content;
            } catch (error) {
              console.error("File upload error:", error);
              return socket.emit("error", { message: error.message });
            }
          }

          // Handle product messages - validate and enrich product data
          if (type === "PRODUCT") {
            try {
              if (!systemMeta?.productId) {
                return socket.emit("error", {
                  message: "Product ID is required for product messages",
                });
              }

              // Fetch complete product data
              const SellProduct = require("../db/models/SellProducts");
              const product = await SellProduct.findById(systemMeta.productId)
                .populate("categoryId", "name")
                .populate("subCategoryId", "name")
                .lean();

              if (!product) {
                return socket.emit("error", { message: "Product not found" });
              }

              // Check if product is available for purchase
              if (product.isSold && product.saleType === "fixed") {
                return socket.emit("error", {
                  message: "This product is already sold",
                });
              }

              // Enrich systemMeta with complete product data
              systemMeta = {
                ...systemMeta,
                productId: product._id,
                productName: product.title,
                productImage: product.productImages?.[0] || null,
                price:
                  product.fixedPrice ||
                  product.auctionSettings?.startingPrice ||
                  0,
                saleType: product.saleType,
                condition: product.condition,
                category: product.categoryId?.name,
                subCategory: product.subCategoryId?.name,
                description: product.description,
                isSold: product.isSold,
                isActive: product.isActive,
                // Auction specific data
                ...(product.saleType === "auction" && {
                  currentBid: product.auctionSettings?.currentBid,
                  startingBid: product.auctionSettings?.startingBid,
                  endTime: product.auctionSettings?.endTime,
                  bidCount: product.auctionSettings?.bidCount || 0,
                }),
              };

              // Update content with product info
              content = `Product: ${product.title}`;
            } catch (error) {
              console.error("Product message error:", error);
              return socket.emit("error", {
                message: "Failed to process product message",
              });
            }
          }

          // Create message
          let newMessage = new ChatMessage({
            chatRoom: roomId,
            sender: type === "SYSTEM" || type === "ORDER" ? null : userId,
            messageType: type,
            content,
            mediaUrl,
            fileName,
            systemMeta,
          });

          await newMessage.save();

          // Populate sender info
          newMessage = await newMessage.populate(
            "sender",
            "_id userName profileImage"
          );

          // For product messages, populate product info
          if (type === "PRODUCT" && systemMeta?.productId) {
            newMessage = await newMessage.populate("systemMeta.productId");
          }

          const updatedRoom = await ChatRoom.findByIdAndUpdate(
            roomId,
            { lastMessage: newMessage._id, updatedAt: new Date() },
            { new: true }
          )
            .populate("lastMessage")
            .populate("participants", "userName profileImage");

          // Add null check for updatedRoom
          if (!updatedRoom) {
            console.error(`Room not found with ID: ${roomId}`);
            return socket.emit("error", { message: "Room not found" });
          }

          const roomForSender = {
            ...updatedRoom.toObject(),
            participants: updatedRoom.participants.filter(
              (p) => p._id?.toString() !== userId?.toString()
            ),
          };

          const roomForReceiver = {
            ...updatedRoom.toObject(),
            participants: updatedRoom.participants.filter(
              (p) => p._id?.toString() !== data.otherUserId?.toString()
            ),
          };

          // Calculate unread counts for both users
          const senderUnreadCount = await ChatMessage.countDocuments({
            chatRoom: roomId,
            seenBy: { $ne: toObjectId(userId) },
            sender: { $ne: toObjectId(userId) },
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

          const receiverUnreadCount = await ChatMessage.countDocuments({
            chatRoom: roomId,
            seenBy: { $ne: toObjectId(data.otherUserId) },
            sender: { $ne: toObjectId(data.otherUserId) },
            $and: [
              { isDeleted: false },
              {
                $or: [
                  { deleteBy: { $size: 0 } },
                  { "deleteBy.userId": { $ne: toObjectId(data.otherUserId) } },
                ],
              },
            ],
          });

          const messageWithRoom = {
            ...newMessage.toObject(),
            chatRoom: roomId,
          };

          // Emit newMessage to the room
          io.to(roomId).emit("newMessage", messageWithRoom);

          // Auto-update chatRoomsList for the receiver to move latest chat to top
          if (data.otherUserId) {
            await autoUpdateChatRoomsList(io, data.otherUserId);
          }

          // Auto-update chatRoomsList for the sender as well
          await autoUpdateChatRoomsList(io, userId);

          if (isNewRoom || roomRestored) {
            // Emit as new room for both users if it's truly new or was restored
            const eventType = isNewRoom ? "newChatRoom" : "roomRestored";

            io.to(`user_${userId}`).emit(eventType, {
              ...roomForSender,
              unreadCount: senderUnreadCount,
              isRestored: roomRestored,
            });

            io.to(`user_${data.otherUserId}`).emit(eventType, {
              ...roomForReceiver,
              unreadCount: receiverUnreadCount,
              isRestored: roomRestored,
            });
          } else {
            // Regular room update
            io.to(`user_${userId}`).emit("roomUpdated", {
              ...roomForSender,
              unreadCount: senderUnreadCount,
            });

            io.to(`user_${data.otherUserId}`).emit("roomUpdated", {
              ...roomForReceiver,
              unreadCount: receiverUnreadCount,
            });
          }

          // Emit updated total unread counts for both users when room is restored
          if (roomRestored) {
            await emitTotalUnreadCount(io, userId);
            if (data.otherUserId) {
              await emitTotalUnreadCount(io, data.otherUserId);
            }
          }
        } catch (error) {
          console.error("Error in sendMessage:", error);
          socket.emit("error", { message: "Failed to send message" });
        }
      }
    );

    socket.on("markMessagesAsSeen", async ({ roomId }) => {
      try {
        const userId = socket.user?.userId;
        if (!roomId || !userId) return;

        const unseenMessages = await ChatMessage.find({
          chatRoom: toObjectId(roomId),
          seenBy: { $ne: toObjectId(userId) },
          sender: { $ne: toObjectId(userId) },
        });

        console.log("📥 Unseen messages for user:", unseenMessages.length);

        // Mark messages as seen (exclude user's own messages)
        const result = await ChatMessage.updateMany(
          {
            chatRoom: toObjectId(roomId),
            seenBy: { $ne: toObjectId(userId) },
            sender: { $ne: toObjectId(userId) },
          },
          { $addToSet: { seenBy: toObjectId(userId) } }
        );

        if (result.modifiedCount > 0) {
          // Broadcast seen event to room
          io.to(roomId).emit("messagesSeen", {
            roomId,
            userId,
            seenAt: new Date().toISOString(),
          });

          // Fetch room with participants
          const room = await ChatRoom.findById(roomId)
            .populate("participants", "_id userName profileImage")
            .populate("lastMessage");

          if (!room) return;

          const roomObj = room.toObject();

          // Notify each participant with updated unread count
          await Promise.all(
            room.participants.map(async (participant) => {
              const participantId = participant._id?.toString();

              let unreadCount = 0;
              if (participantId !== userId) {
                unreadCount = await ChatMessage.countDocuments({
                  chatRoom: roomId,
                  seenBy: { $ne: toObjectId(participantId) },
                  sender: { $ne: toObjectId(participantId) },
                });
              }

              io.to(`user_${participantId}`).emit("roomUpdated", {
                ...roomObj,
                participants: roomObj.participants.filter(
                  (p) => p._id?.toString() !== participantId
                ),
                unreadCount,
              });
            })
          );
        }
      } catch (error) {
        console.error("❌ Error in markMessagesAsSeen:", error);
        socket.emit("error", { message: "Failed to mark messages as seen" });
      }
    });

    socket.on("getChatRooms", (data, userId) => {
      handleGetChatRooms(socket, userId, data);
    });

    socket.on("getMessageList", (data) => {
      handleGetMessageList(socket, data);
    });


    socket.on(
      "getMessagesWithUser",
      async ({ otherUserId, pageNo = 1, size = 20 }) => {
        try {
          const userId = socket.user?.userId;

          if (!otherUserId) {
            return socket.emit("error", { message: "otherUserId is required" });
          }

          const page = Math.max(1, parseInt(pageNo));
          const limit = Math.min(100, parseInt(size));
          const skip = (page - 1) * limit;

          // Find existing one-on-one room
          const room = await ChatRoom.findOne({
            isGroup: false,
            participants: {
              $all: [toObjectId(userId), toObjectId(otherUserId)],
              $size: 2,
            },
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

          if (!room) {
            return socket.emit("messageList", {
              chatRoomId: null,
              total: 0,
              pageNo: page,
              size: limit,
              messages: [],
              hasMore: false,
              isNewRoom: true,
              blocked: false, // default,
              is_Preferred_seller: false,
              is_Verified_Seller: false
            });
          }

          const chatRoomId = room._id.toString();

          // Get messages visible to this user
          let messages = await ChatMessage.getVisibleMessages(
            { chatRoom: toObjectId(chatRoomId) },
            toObjectId(userId)
          )
            .populate("sender", "userName profileImage")
            .sort({ createdAt: -1 })
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


          const isBlocked = await BlockUser.findOne({
            $or: [
              { blockBy: toObjectId(userId), userId: toObjectId(otherUserId) },
              { blockBy: toObjectId(otherUserId), userId: toObjectId(userId) },
            ],
          });
          const userInfos = await User.findById(otherUserId).select('userName is_Verified_Seller is_Preferred_seller isLive');




          const blocked = !!isBlocked;

          // Optional: reverse to send oldest first
          messages = messages.reverse();
          const formattedMessages = [];
          let lastDateLabel = "";

          messages.forEach((msg) => {
            const createdAt = moment(msg.createdAt);
            const today = moment();
            const yesterday = moment().subtract(1, "day");

            let dateLabel = createdAt.format("MMM DD, YYYY");
            if (createdAt.isSame(today, "day")) dateLabel = "Today";
            else if (createdAt.isSame(yesterday, "day")) dateLabel = "Yesterday";

            // Insert a date marker if this message belongs to a new date
            if (dateLabel !== lastDateLabel) {
              formattedMessages.push({
                messageType: "date",
                content:dateLabel,
                // time: createdAt.format("hh:mm A") // optional, can remove if not needed
              });
              lastDateLabel = dateLabel;
            }

            // Add the actual message with time
            formattedMessages.push({
              ...msg,
              // time: createdAt.format("hh:mm A") // hh:mm AM/PM
            });
          });

          messages = formattedMessages;


          // ✅ Automatically mark messages as read
          await ChatMessage.updateMany(
            {
              chatRoom: toObjectId(chatRoomId),
              seenBy: { $ne: toObjectId(userId) },
              sender: { $ne: toObjectId(userId) },
            },
            { $addToSet: { seenBy: toObjectId(userId) } }
          );

          // Broadcast seen event to room
          io.to(chatRoomId).emit("messagesSeen", {
            roomId: chatRoomId,
            userId,
            seenAt: new Date().toISOString(),
            allMessages: true,
          });

          socket.emit("messageList", {
            chatRoomId,
            total: totalMessages,
            pageNo: page,
            size: limit,
            messages,
            hasMore: totalMessages > page * limit,
            isNewRoom: false,
            blocked,
            is_Preferred_seller: userInfos?.is_Preferred_seller || false,
            is_Verified_Seller: userInfos?.is_Verified_Seller || false
          });

          // Optional: update unread counts for all participants
          await emitTotalUnreadCount(io, userId);
        } catch (error) {
          console.error("❌ Error in getMessagesWithUser:", error);
          socket.emit("error", { message: "Failed to get messages with user" });
        }
      }
    );

    socket.on("getTotalUnreadCount", async () => {
      const userId = socket.user?.userId;
      if (!userId) return;

      await emitTotalUnreadCount(io, userId);
    });

    socket.on("markAllNotificationsAsRead", async () => {
      try {
        const userId = socket.user?.userId;
        if (!userId) return;

        await updateNotificationQueue.add({ userId });

        socket.emit("allNotificationsMarkedAsRead", {
          success: true,
          queued: true,
          timestamp: new Date().toISOString(),
        });

        // const { Notification } = require('../db');
        // await Notification.updateMany(
        //     { userId: toObjectId(userId), read: false },
        //     { read: true }
        // );
      } catch (error) {
        console.error("Error marking notifications as read:", error);
        socket.emit("error", {
          message: "Failed to mark notifications as read",
        });
      }
    });

    // Mark all messages in a specific room as read (accepts roomId or otherUserId)
    socket.on("markRoomMessagesAsRead", async ({ roomId, otherUserId }) => {
      try {
        const userId = socket.user?.userId;
        if (!userId) return;

        let targetRoomId = roomId;

        // If roomId not provided, find room using otherUserId
        if (!targetRoomId && otherUserId) {
          const room = await ChatRoom.findOne({
            isGroup: false,
            participants: {
              $all: [toObjectId(userId), toObjectId(otherUserId)],
              $size: 2,
            },
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

          if (!room) {
            return socket.emit("error", { message: "Chat room not found" });
          }

          targetRoomId = room._id.toString();
        }

        if (!targetRoomId) {
          return socket.emit("error", {
            message: "roomId or otherUserId is required",
          });
        }

        // Mark ALL messages in this room as read for current user
        const result = await ChatMessage.updateMany(
          {
            chatRoom: toObjectId(targetRoomId),
            seenBy: { $ne: toObjectId(userId) },
            sender: { $ne: toObjectId(userId) },
          },
          { $addToSet: { seenBy: toObjectId(userId) } }
        );

        if (result.modifiedCount > 0) {
          // Broadcast seen event to room
          io.to(targetRoomId).emit("messagesSeen", {
            roomId: targetRoomId,
            userId,
            seenAt: new Date().toISOString(),
            allMessages: true,
          });

          // Update room info for all participants
          const room = await ChatRoom.findById(targetRoomId)
            .populate("participants", "_id userName profileImage")
            .populate("lastMessage");

          if (room) {
            const roomObj = room.toObject();
            await Promise.all(
              room.participants.map(async (participant) => {
                const participantId = participant._id?.toString();
                let unreadCount = 0;
                if (participantId !== userId) {
                  unreadCount = await ChatMessage.countDocuments({
                    chatRoom: targetRoomId,
                    seenBy: { $ne: toObjectId(participantId) },
                    sender: { $ne: toObjectId(participantId) },
                  });
                }

                io.to(`user_${participantId}`).emit("roomUpdated", {
                  ...roomObj,
                  participants: roomObj.participants.filter(
                    (p) => p._id?.toString() !== participantId
                  ),
                  unreadCount,
                });
              })
            );
          }

          // Emit updated total unread count
          await emitTotalUnreadCount(io, userId);
        }

        socket.emit("roomMessagesMarkedAsRead", {
          success: true,
          roomId: targetRoomId,
          messagesCount: result.modifiedCount,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("❌ Error in markRoomMessagesAsRead:", error);
        socket.emit("error", {
          message: "Failed to mark room messages as read",
        });
      }
    });

    // Mark all messages across all chats as read
    socket.on("markAllChatsAsRead", async () => {
      try {
        const userId = socket.user?.userId;
        if (!userId) return;

        // Get all user's chat rooms (excluding deleted rooms)
        const userRooms = await ChatRoom.find({
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
        }).select("_id");

        const roomIds = userRooms.map((room) => room._id);

        // Mark all messages as seen across all rooms
        const result = await ChatMessage.updateMany(
          {
            chatRoom: { $in: roomIds },
            seenBy: { $ne: toObjectId(userId) },
            sender: { $ne: toObjectId(userId) },
          },
          { $addToSet: { seenBy: toObjectId(userId) } }
        );

        // Emit updated total count
        await emitTotalUnreadCount(io, userId);

        socket.emit("allChatsMarkedAsRead", {
          success: true,
          roomsCount: roomIds.length,
          messagesCount: result.modifiedCount,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error marking all chats as read:", error);
        socket.emit("error", { message: "Failed to mark all chats as read" });
      }
    });

    // Delete a specific message for the current user
    socket.on(
      "deleteMessage",
      async ({ messageId, deleteForEveryone = false }) => {
        try {
          const userId = socket.user?.userId;
          if (!userId || !messageId) {
            return socket.emit("error", { message: "messageId is required" });
          }

          // Find the message
          const message = await ChatMessage.findById(messageId);
          if (!message) {
            return socket.emit("error", { message: "Message not found" });
          }

          // Check if user is the sender (for delete for everyone)
          const isSender = message.sender?.toString() === userId;

          let deletedMessage;

          if (deleteForEveryone && isSender) {
            // Permanently delete for everyone (only sender can do this)
            deletedMessage = await ChatMessage.permanentDelete(messageId);

            // Notify all participants in the room
            io.to(message.chatRoom.toString()).emit(
              "messageDeletedForEveryone",
              {
                messageId,
                deletedBy: userId,
                timestamp: new Date().toISOString(),
              }
            );
          } else {
            // Delete for current user only
            deletedMessage = await ChatMessage.deleteForUser(
              messageId,
              userId,
              "MESSAGE_DELETE"
            );

            // Only notify the user who deleted it
            socket.emit("messageDeletedForMe", {
              messageId,
              deletedBy: userId,
              timestamp: new Date().toISOString(),
            });
          }

          // Update last message if this was the last message in the room
          const room = await ChatRoom.findById(message.chatRoom);
          if (room && room.lastMessage?.toString() === messageId) {
            // Find the latest non-deleted message for each user
            const latestMessage = await ChatMessage.findOne({
              chatRoom: message.chatRoom,
              $and: [
                { isDeleted: false },
                {
                  $or: [
                    { deleteBy: { $size: 0 } },
                    // At least one participant can see it
                    { "deleteBy.userId": { $nin: room.participants } },
                  ],
                },
              ],
            }).sort({ createdAt: -1 });

            await ChatRoom.findByIdAndUpdate(message.chatRoom, {
              lastMessage: latestMessage?._id || null,
            });

            // Notify room participants about room update
            const updatedRoom = await ChatRoom.findById(message.chatRoom)
              .populate("lastMessage")
              .populate("participants", "userName profileImage");

            if (updatedRoom) {
              await Promise.all(
                updatedRoom.participants.map(async (participant) => {
                  const participantId = participant._id?.toString();

                  // Calculate unread count for this participant
                  const unreadCount = await ChatMessage.countDocuments({
                    chatRoom: message.chatRoom,
                    seenBy: { $ne: toObjectId(participantId) },
                    sender: { $ne: toObjectId(participantId) },
                    $and: [
                      { isDeleted: false },
                      {
                        $or: [
                          { deleteBy: { $size: 0 } },
                          {
                            "deleteBy.userId": {
                              $ne: toObjectId(participantId),
                            },
                          },
                        ],
                      },
                    ],
                  });

                  const roomForParticipant = {
                    ...updatedRoom.toObject(),
                    participants: updatedRoom.participants.filter(
                      (p) => p._id?.toString() !== participantId
                    ),
                    unreadCount,
                  };

                  io.to(`user_${participantId}`).emit(
                    "roomUpdated",
                    roomForParticipant
                  );
                })
              );
            }
          }

          socket.emit("messageDeleted", {
            success: true,
            messageId,
            deleteForEveryone,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("❌ Error in deleteMessage:", error);
          socket.emit("error", { message: "Failed to delete message" });
        }
      }
    );

    // Delete entire chat room/conversation for the current user
    socket.on(
      "deleteRoom",
      async ({ roomId, otherUserId, clearHistory = true }) => {
        try {
          const userId = socket.user?.userId;
          if (!userId) return;

          let targetRoomId = roomId;

          // If roomId not provided, find room using otherUserId
          if (!targetRoomId && otherUserId) {
            const room = await ChatRoom.findOne({
              isGroup: false,
              participants: {
                $all: [toObjectId(userId), toObjectId(otherUserId)],
                $size: 2,
              },
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

            if (!room) {
              return socket.emit("error", { message: "Chat room not found" });
            }

            targetRoomId = room._id.toString();
          }

          if (!targetRoomId) {
            return socket.emit("error", {
              message: "roomId or otherUserId is required",
            });
          }

          // Delete room for user
          await ChatRoom.deleteForUser(targetRoomId, userId, clearHistory);

          if (clearHistory) {
            // Mark all messages in this room as deleted for this user
            await ChatMessage.updateMany(
              { chatRoom: toObjectId(targetRoomId) },
              {
                $addToSet: {
                  deleteBy: {
                    userId: toObjectId(userId),
                    deletedAt: new Date(),
                    deleteType: "ROOM_DELETE",
                  },
                },
              }
            );
          }

          // Remove user from room socket
          socket.leave(targetRoomId);

          socket.emit("roomDeleted", {
            success: true,
            roomId: targetRoomId,
            clearHistory,
            timestamp: new Date().toISOString(),
          });

          // Update total unread count
          await emitTotalUnreadCount(io, userId);
        } catch (error) {
          console.error("❌ Error in deleteRoom:", error);
          socket.emit("error", { message: "Failed to delete room" });
        }
      }
    );

    // Delete multiple chat rooms/conversations for the current user
    socket.on(
      "deleteMultipleRooms",
      async ({ roomIds = [], otherUserIds = [], clearHistory = true }) => {
        console.log("🗑️ deleteMultipleRooms called with:", {
          roomIds,
          otherUserIds,
          clearHistory,
        });
        try {
          const userId = socket.user?.userId;
          if (!userId) return;

          const targetRoomIds = [];
          const errors = [];
          const results = [];

          // Process roomIds if provided
          if (roomIds && roomIds.length > 0) {
            for (const roomId of roomIds) {
              try {
                // Verify room exists and user is a participant (check both active and deleted rooms)
                const room = await ChatRoom.findOne({
                  _id: toObjectId(roomId),
                  participants: toObjectId(userId),
                  isDeleted: false, // Only check if room is not permanently deleted
                });

                if (!room) {
                  errors.push({
                    roomId,
                    error: "Room not found or access denied",
                  });
                  continue;
                }

                // Check if room is already deleted for this user
                const isAlreadyDeleted = room.deleteBy.some(
                  (del) => del.userId.toString() === userId
                );
                if (isAlreadyDeleted) {
                  errors.push({
                    roomId,
                    error: "Room already deleted for this user",
                  });
                  continue;
                }

                targetRoomIds.push(roomId);
              } catch (error) {
                errors.push({ roomId, error: "Invalid room ID" });
              }
            }
          }

          // Process otherUserIds if provided
          if (otherUserIds && otherUserIds.length > 0) {
            for (const otherUserId of otherUserIds) {
              try {
                const room = await ChatRoom.findOne({
                  isGroup: false,
                  participants: {
                    $all: [toObjectId(userId), toObjectId(otherUserId)],
                    $size: 2,
                  },
                  isDeleted: false, // Only check if room is not permanently deleted
                });

                if (!room) {
                  errors.push({ otherUserId, error: "Chat room not found" });
                  continue;
                }

                // Check if room is already deleted for this user
                const isAlreadyDeleted = room.deleteBy.some(
                  (del) => del.userId.toString() === userId
                );
                if (isAlreadyDeleted) {
                  errors.push({
                    otherUserId,
                    error: "Room already deleted for this user",
                  });
                  continue;
                }

                targetRoomIds.push(room._id.toString());
              } catch (error) {
                errors.push({ otherUserId, error: "Invalid user ID" });
              }
            }
          }

          if (targetRoomIds.length === 0) {
            return socket.emit("error", {
              message: "No valid rooms found to delete",
              errors,
            });
          }

          // Use bulk operations for better performance
          try {
            // Bulk update rooms - delete for user
            const roomBulkOps = targetRoomIds.map((roomId) => ({
              updateOne: {
                filter: { _id: toObjectId(roomId) },
                update: {
                  $addToSet: {
                    deleteBy: {
                      userId: toObjectId(userId),
                      deletedAt: new Date(),
                      clearHistory: clearHistory,
                    },
                  },
                },
              },
            }));

            const roomBulkResult = await ChatRoom.bulkWrite(roomBulkOps);
            console.log(
              `✅ Bulk deleted ${roomBulkResult.modifiedCount} rooms for user ${userId}`
            );

            // Bulk update messages if clearHistory is true
            if (clearHistory && targetRoomIds.length > 0) {
              const messageBulkOps = targetRoomIds.map((roomId) => ({
                updateMany: {
                  filter: { chatRoom: toObjectId(roomId) },
                  update: {
                    $addToSet: {
                      deleteBy: {
                        userId: toObjectId(userId),
                        deletedAt: new Date(),
                        deleteType: "ROOM_DELETE",
                      },
                    },
                  },
                },
              }));

              const messageBulkResult = await ChatMessage.bulkWrite(
                messageBulkOps
              );
              console.log(
                `✅ Bulk deleted ${messageBulkResult.modifiedCount} messages for user ${userId}`
              );
            }

            // Remove user from all room sockets
            targetRoomIds.forEach((roomId) => {
              socket.leave(roomId);
            });

            // Prepare results
            results.push(
              ...targetRoomIds.map((roomId) => ({
                roomId,
                success: true,
                clearHistory,
              }))
            );
          } catch (bulkError) {
            console.error("❌ Bulk operation failed:", bulkError);

            // Fallback to individual operations
            console.log("🔄 Falling back to individual operations...");

            const deletePromises = targetRoomIds.map(async (roomId) => {
              try {
                // Delete room for user
                await ChatRoom.deleteForUser(roomId, userId, clearHistory);

                if (clearHistory) {
                  // Mark all messages in this room as deleted for this user
                  await ChatMessage.updateMany(
                    { chatRoom: toObjectId(roomId) },
                    {
                      $addToSet: {
                        deleteBy: {
                          userId: toObjectId(userId),
                          deletedAt: new Date(),
                          deleteType: "ROOM_DELETE",
                        },
                      },
                    }
                  );
                }

                // Remove user from room socket
                socket.leave(roomId);

                results.push({
                  roomId,
                  success: true,
                  clearHistory,
                });

                return { roomId, success: true };
              } catch (error) {
                console.error(`❌ Error deleting room ${roomId}:`, error);
                errors.push({ roomId, error: "Failed to delete room" });
                return { roomId, success: false, error: error.message };
              }
            });

            // Wait for all deletions to complete
            await Promise.all(deletePromises);
          }

          // Update total unread count
          await emitTotalUnreadCount(io, userId);

          socket.emit("multipleRoomsDeleted", {
            success: true,
            totalRooms: targetRoomIds.length,
            successfulDeletions: results.length,
            failedDeletions: errors.length,
            results,
            errors,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("❌ Error in deleteMultipleRooms:", error);
          socket.emit("error", { message: "Failed to delete multiple rooms" });
        }
      }
    );

    // Get deleted messages (for recovery or admin purposes)
    socket.on(
      "getDeletedMessages",
      async ({ roomId, pageNo = 1, size = 20 }) => {
        try {
          const userId = socket.user?.userId;
          if (!userId || !roomId) {
            return socket.emit("error", { message: "roomId is required" });
          }

          const page = Math.max(1, parseInt(pageNo));
          const limit = Math.min(100, parseInt(size));
          const skip = (page - 1) * limit;

          // Get messages deleted by this user
          const deletedMessages = await ChatMessage.find({
            chatRoom: toObjectId(roomId),
            "deleteBy.userId": toObjectId(userId),
          })
            .populate("sender", "userName profileImage")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

          const total = await ChatMessage.countDocuments({
            chatRoom: toObjectId(roomId),
            "deleteBy.userId": toObjectId(userId),
          });

          socket.emit("deletedMessagesList", {
            roomId,
            total,
            pageNo: page,
            size: limit,
            messages: deletedMessages.reverse(),
            hasMore: total > page * limit,
          });
        } catch (error) {
          console.error("❌ Error in getDeletedMessages:", error);
          socket.emit("error", { message: "Failed to get deleted messages" });
        }
      }
    );

    // Restore a deleted message for the current user
    socket.on("restoreMessage", async ({ messageId }) => {
      try {
        const userId = socket.user?.userId;
        if (!userId || !messageId) {
          return socket.emit("error", { message: "messageId is required" });
        }

        // Remove user from deleteBy array
        const restoredMessage = await ChatMessage.findByIdAndUpdate(
          messageId,
          {
            $pull: {
              deleteBy: { userId: toObjectId(userId) },
            },
          },
          { new: true }
        ).populate("sender", "userName profileImage");

        if (!restoredMessage) {
          return socket.emit("error", { message: "Message not found" });
        }

        socket.emit("messageRestored", {
          success: true,
          message: restoredMessage,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("❌ Error in restoreMessage:", error);
        socket.emit("error", { message: "Failed to restore message" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔴 User ${userId} disconnected`);
      delete connectedUsers[socket.id];
      if (userId) {
        liveStatusQueue.add({ userId, isLive: false });
        io.to(`user_${userId}`).emit("userLiveStatus", {
          userId,
          isLive: false,
        });
      }
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Socket connection error:", err.message, err);
    });
  });

  setInterval(async () => {
    try {
      for (const [socketId, userId] of Object.entries(connectedUsers)) {
        if (!userId) continue;
        await emitTotalUnreadCount(io, userId);
      }
    } catch (err) {
      console.error("Error while pushing unread counts:", err);
    }
  }, 30000); //

  // Send total unread count to user
  async function emitTotalUnreadCount(io, userId) {
    try {
      const [chatUnreadCount, notificationUnreadCount] = await Promise.all([
        calculateTotalChatUnreadCount(userId),
        calculateTotalNotificationUnreadCount(userId),
      ]);

      const totalUnreadCount = chatUnreadCount + notificationUnreadCount;

      io.to(`user_${userId}`).emit("totalUnreadCount", {
        chatUnreadCount,
        notificationUnreadCount,
        totalUnreadCount,
        timestamp: new Date().toISOString(),
      });

      return { chatUnreadCount, notificationUnreadCount, totalUnreadCount };
    } catch (error) {
      console.error("Error emitting total unread count:", error);
    }
  }

  // Auto-update chatRoomsList for a user (moves latest conversation to top)
  async function autoUpdateChatRoomsList(io, userId) {
    try {
      // console.log(`🔄 Auto-updating chatRoomsList for user ${userId}`);

      // Create a mock socket object that mimics the required socket structure
      const mockSocket = {
        emit: (event, data) => io.to(`user_${userId}`).emit(event, data),
        user: { userId }
      };

      // Trigger getChatRooms handler for the specific user with proper parameters
      await handleGetChatRooms(mockSocket, userId, {});

    } catch (error) {
      console.error(`Error auto-updating chatRoomsList for user ${userId}:`, error);
    }
  }

  // Helper function to emit room updates for all participants
  async function emitRoomUpdateToParticipants(
    io,
    roomId,
    eventType = "roomUpdated"
  ) {
    try {
      const room = await ChatRoom.findById(roomId)
        .populate("participants", "_id userName profileImage")
        .populate("lastMessage");

      if (!room) return;

      const roomObj = room.toObject();

      // Emit updates to all participants
      await Promise.all(
        room.participants.map(async (participant) => {
          const participantId = participant._id?.toString();

          // Calculate unread count for this participant
          const unreadCount = await ChatMessage.countDocuments({
            chatRoom: roomId,
            seenBy: { $ne: toObjectId(participantId) },
            sender: { $ne: toObjectId(participantId) },
            $and: [
              { isDeleted: false },
              {
                $or: [
                  { deleteBy: { $size: 0 } },
                  { "deleteBy.userId": { $ne: toObjectId(participantId) } },
                ],
              },
            ],
          });

          // Filter out the participant from their own participant list
          const roomForParticipant = {
            ...roomObj,
            participants: roomObj.participants.filter(
              (p) => p._id?.toString() !== participantId
            ),
            unreadCount,
          };

          io.to(`user_${participantId}`).emit(eventType, roomForParticipant);

          // Also emit updated total unread count
          await emitTotalUnreadCount(io, participantId);
        })
      );
    } catch (error) {
      console.error("Error emitting room updates to participants:", error);
    }
  }

  return io;
}

async function calculateTotalChatUnreadCount(userId) {
  try {
    // Get all chat rooms visible to this user
    const userRooms = await ChatRoom.find({
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
    }).select("_id");

    const roomIds = userRooms.map((room) => room._id);

    // Count all unread messages across all rooms (excluding deleted messages)
    const totalChatUnread = await ChatMessage.countDocuments({
      chatRoom: { $in: roomIds },
      seenBy: { $ne: toObjectId(userId) },
      sender: { $ne: toObjectId(userId) },
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

    return totalChatUnread;
  } catch (error) {
    console.error("Error calculating total chat unread:", error);
    return 0;
  }
}

// Calculate total unread notifications for a user
async function calculateTotalNotificationUnreadCount(userId) {
  try {
    const { Notification } = require("../db");
    const totalNotificationUnread = await Notification.countDocuments({
      userId: toObjectId(userId),
      read: false,
    });
    return totalNotificationUnread;
  } catch (error) {
    console.error("Error calculating notification unread:", error);
    return 0;
  }
}

// queue setup
const LIVE_STATUS_QUEUE = "live-status-queue";

const UPDATE_NOTIFICATION = "updateNotification";
const updateNotificationQueue = createQueue(UPDATE_NOTIFICATION);

processQueue(updateNotificationQueue, async (job) => {
  const { userId } = job.data;

  const { Notification } = require("../db");
  await Notification.updateMany(
    { userId: toObjectId(userId), read: false },
    { read: true }
  );

  // console.log(`Marked all notifications as read for user ${userId}`);
});

const liveStatusQueue = createQueue(LIVE_STATUS_QUEUE);
processQueue(liveStatusQueue, async (job) => {
  const { userId, isLive } = job.data;
  await User.findByIdAndUpdate(userId, { isLive });
  // console.log(`Updated live status for user ${userId} to ${isLive}`);
});

async function resetAllLiveStatuses() {
  try {
    await User.updateMany({ isLive: true }, { isLive: false });
    // console.log("✅ Reset all user live statuses on server start");
  } catch (err) {
    console.error("❌ Failed to reset live statuses:", err);
  }
}

module.exports = { setupSocket, resetAllLiveStatuses };
