const { Notification, User } = require("../../db");
const {
  DATA_NULL,
  SUCCESS,
  SERVER_ERROR_CODE,
  NOT_FOUND,
} = require("../../utils/constants");
const {
  sendFirebaseNotification,
} = require("../../utils/firebasePushNotification");
const {
  resultDb,
  momentValueFunc,
  objectId,
  toObjectId,
} = require("../../utils/globalFunction");
const { addJobToQueue, createQueue, processQueue } = require("./serviceBull");

// Socket instance holder
let socketInstance = null;

// Function to set socket instance
const setSocketInstance = (io) => {
  socketInstance = io;
};

// Function to emit total unread count (copied from socket.js)
const emitTotalUnreadCount = async (userId) => {

  if (!socketInstance) return;
 
  try {
    const [chatUnreadCount, notificationUnreadCount] = await Promise.all([
      calculateTotalChatUnreadCount(userId),
      calculateTotalNotificationUnreadCount(userId),
    ]);

    const totalUnreadCount = chatUnreadCount + notificationUnreadCount;
    console.log("totalUnreadCount",totalUnreadCount)

    socketInstance.to(`user_${userId}`).emit("totalUnreadCount", {
      chatUnreadCount,
      notificationUnreadCount,
      totalUnreadCount,
      timestamp: new Date().toISOString(),
    });

    return { chatUnreadCount, notificationUnreadCount, totalUnreadCount };
  } catch (error) {
    console.error("Error emitting total unread count:", error);
  }
};

// Helper functions for calculating unread counts
const calculateTotalChatUnreadCount = async (userId) => {
  try {
    const { ChatRoom, ChatMessage } = require("../../db");
    
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
};

const calculateTotalNotificationUnreadCount = async (userId) => {
  try {
    const totalNotificationUnread = await Notification.countDocuments({
      recipientId: toObjectId(userId),
      read: false,
    });
    // console.log("calculateTotalNotificationUnreadCount")
    return totalNotificationUnread;
  } catch (error) {
    console.error("Error calculating notification unread:", error);
    return 0;
  }
};

const notificationQueue = createQueue("notificationQueue");

const saveNotification = async (payload, data = false) => {
  try {
    if (!Array.isArray(payload) || payload.length === 0) {
      return resultDb(SERVER_ERROR_CODE, "Payload must be a non-empty array");
    }

    for (const notification of payload) {
      const notificationWithSkip = { ...notification, skip: data };
      // console.log(notificationWithSkip);
      await addJobToQueue(notificationQueue, notificationWithSkip);
    }

    return resultDb(SUCCESS, {
      message: "Notifications added to the queue for processing",
    });
  } catch (error) {
    console.error("Error saving notifications:", error);
    return resultDb(error.code || SERVER_ERROR_CODE, DATA_NULL);
  }
};

const notificationProcessor = async (job) => {
  try {
    const userNotification = job.data;

    // Validate required fields
    const { recipientId: userId, title, message, skip } = userNotification;
    if (!userId || !title || !message) {
      console.error("Invalid notification format in queue", userNotification);
      return;
    }

    // Fetch user info including language preference and FCM token
    const userInfo = await User.findById(userId).select("fcmToken language");

    // Get user's language preference (default to 'english' if not set)
    const userLanguage = userInfo?.language || 'english';

    // Import translation utilities
    const { translateNotification, extractNotificationVariables } = require('../../utils/notificationTranslations');

    // Extract variables from notification metadata for translation
    const variables = extractNotificationVariables(message, userNotification.meta || {});

    // Translate title and message based on user's language preference
    const translatedTitle = translateNotification(title, userLanguage, variables);
    const translatedMessage = translateNotification(message, userLanguage, variables);

    // Send Firebase notification if token exists
    if (userInfo?.fcmToken) {
      // console.log("userID", userId, "language", userLanguage);
      await sendFirebaseNotification({
        token: userInfo.fcmToken,
        title: translatedTitle,
        body: translatedMessage,
        imageUrl: userNotification.imageUrl || "",
        ...userNotification, // Pass the rest of the meta if needed
      });
    }

    // Save notification in DB with translated content
    if (!skip) {
      await Notification.create({
        recipientId: userNotification.recipientId,
        type: userNotification.type,
        userId: userNotification.userId,
        chatId: userNotification.chatId,
        orderId: userNotification.orderId,
        productId: userNotification.productId,
        title: translatedTitle,
        message: translatedMessage,
        meta: userNotification.meta || {},
        activityType: userNotification.activityType || null,
        redirectUrl: userNotification.redirectUrl || null,
      });
      
      // Emit updated total unread count after saving notification
      await emitTotalUnreadCount(userId);
    }
  } catch (error) {
    console.error("Error processing notification job:", error);
    throw error; // Let Bull handle retries if configured
  }
};

const getAllNotificationByUserId = async (userId) => {
  try {
    const saveData = await Notification.find({ userId });
    if (saveData) {
      return resultDb(SUCCESS, saveData);
    }
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  } catch (error) {
    if (error.code) return resultDb(error.code, DATA_NULL);
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

const getNotificationByUserIdListed = async (payload) => {
  try {
    let query = { userId: payload?.userId };
    if (payload?.fromDate && payload?.toDate) {
      const fromTime = momentValueFunc(new Date(payload.fromDate));
      const endTime =
        momentValueFunc(new Date(payload.toDate)) + 24 * 60 * 60 * 1000;
      query.createdAt = {
        $gte: fromTime,
        $lte: endTime,
      };
    } else if (payload?.fromDate) {
      const fromTime = momentValueFunc(new Date(payload.fromDate));
      query.createdAt = { $gte: fromTime };
    } else if (payload?.toDate) {
      const endTime =
        momentValueFunc(new Date(payload.toDate)) + 24 * 60 * 60 * 1000;
      query.createdAt = { $lte: endTime };
    }
    if (payload?.keyWord) {
      query.$or = [
        { title: { $regex: payload.keyWord, $options: "i" } },
        { message: { $regex: payload.keyWord, $options: "i" } },
        { notificationType: { $regex: payload.keyWord, $options: "i" } },
      ];
    }
    let sortBy = payload?.sortBy || "createdAt";
    let pageNo = payload?.pageNo || 1;
    let limit = payload.size || 10;
    let sort = { [sortBy]: payload.sortOrder === "asc" ? 1 : -1 };
    const total = await Notification.countDocuments(query);
    const list = await Notification.find(query)
      .select(
        "userId title message notificationType redirectUrl readAt createdAt read"
      )
      .skip((pageNo - 1) * limit)
      .limit(limit)
      .sort(sort)
      .lean();

    let totalUnread = await Notification.countDocuments({
      read: false,
      userId: payload?.userId,
    });
    return resultDb(SUCCESS, {
      total,
      list,
      totalUnread,
    });
  } catch (error) {
    if (error.code) return resultDb(error.code, DATA_NULL);
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

const getNotificationList = async (payload) => {
  try {
    let matchStage = {};
    if (payload?.userId) {
      matchStage.userId = payload?.userId;
    }
    if (payload?.fromDate && payload?.toDate) {
      const fromTime = momentValueFunc(new Date(payload.fromDate));
      const endTime =
        momentValueFunc(new Date(payload.toDate)) + 24 * 60 * 60 * 1000;
      matchStage.createdAt = {
        $gte: fromTime,
        $lte: endTime,
      };
    } else if (payload?.fromDate) {
      const fromTime = momentValueFunc(new Date(payload.fromDate));
      matchStage.createdAt = { $gte: fromTime };
    } else if (payload?.toDate) {
      const endTime =
        momentValueFunc(new Date(payload.toDate)) + 24 * 60 * 60 * 1000;
      matchStage.createdAt = { $lte: endTime };
    }

    if (payload?.keyWord) {
      matchStage.$or = [
        { title: { $regex: payload.keyWord, $options: "i" } },
        { message: { $regex: payload.keyWord, $options: "i" } },
        { notificationType: { $regex: payload.keyWord, $options: "i" } },
      ];
    }
    if (payload?.type && payload?.type != "") {
      matchStage.type = payload.type;
    }

    let sortBy = payload?.sortBy || "createdAt";
    let sortOrder = payload?.sortOrder === "asc" ? 1 : -1;
    let pageNo = Number(payload?.pageNo) || 1;
    let limit = Number(payload?.size) || 10;
    let skip = (pageNo - 1) * limit;

    const aggregationPipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$randomId",
          latestNotification: { $first: "$$ROOT" },
        },
      },
      {
        $replaceRoot: { newRoot: "$latestNotification" },
      },
      { $sort: { [sortBy]: sortOrder } },
      { $skip: skip },
      { $limit: limit },
    ];

    const groupedNotifications = await Notification.aggregate(
      aggregationPipeline
    );

    // Total count calculation, without skip and limit.
    const totalGroupsPipeline = [
      { $match: matchStage },
      { $group: { _id: "$randomId" } },
    ];

    const totalGroups = await Notification.aggregate(totalGroupsPipeline);
    const total = totalGroups.length;

    return resultDb(SUCCESS, {
      total,
      list: groupedNotifications,
    });
  } catch (error) {
    console.log(error);
    if (error.code) return resultDb(error.code, DATA_NULL);
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

const notificationStatusUpdateRead = async (id) => {
  try {
    const saveData = await Notification.findByIdAndUpdate(
      id,
      { $set: { read: true } },
      { new: true }
    );
    if (saveData) {
      return resultDb(SUCCESS, saveData);
    }
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  } catch (error) {
    if (error.code) return resultDb(error.code, DATA_NULL);
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

const notificationStatusUserIdUpdateReadAll = async (userId) => {
  try {
    const saveData = await Notification.updateMany(
      { userId: userId },
      { $set: { read: true } }
    );
    return resultDb(SUCCESS, saveData);
  } catch (error) {
    if (error.code) {
      return resultDb(error.code, DATA_NULL);
    }
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

// interface Data {

// }
const notifyUserOnEventNonSession = async (data) => {
  try {
    // Import translation utilities
    const { translateNotification, extractNotificationVariables } = require('../../utils/notificationTranslations');

    if (Array.isArray(data)) {
      let notifyDoc = await Promise.all(
        data?.filter(async (d) => {
          let userInfo = await User.findOne({ _id: d.userId }).select(
            "fcmToken notification language"
          );
          if (userInfo) {
            if (userInfo?.notification && userInfo?.fcmToken) {
              // Get user's language preference
              const userLanguage = userInfo?.language || 'english';
              
              // Extract variables and translate notification content
              const variables = extractNotificationVariables(d.message, d.meta || {});
              const translatedTitle = translateNotification(d.title, userLanguage, variables);
              const translatedMessage = translateNotification(d.message, userLanguage, variables);

              await sendFirebaseNotification({
                token: userInfo.fcmToken,
                title: translatedTitle,
                body: translatedMessage,
                imageUrl: d.imageUrl,
              });
              return d;
            }
          }
        })
      );
      // if(notifyDoc?.length === 0) {
      //     return resultDb(SUCCESS, null);
      // }
      // notify = await Notification.insertMany(notifyDoc);
      // if (notify?.length > 0) {
      //     return resultDb(SUCCESS, notify);
      // }
      return resultDb(SUCCESS, null);
      // return resultDb(NOT_FOUND, DATA_NULL);
    }
  } catch (error) {
    console.log(error);
  }
};

const notifyUserOnEvent = async (data, session) => {
  try {
    // Import translation utilities
    const { translateNotification, extractNotificationVariables } = require('../../utils/notificationTranslations');

    if (Array.isArray(data)) {
      let notifyDoc = await Promise.all(
        data?.filter(async (d) => {
          let userInfo = await User.findOne({ _id: d.userId }).select(
            "fcmToken notification language"
          );
          if (userInfo) {
            if (userInfo?.notification && userInfo?.fcmToken) {
              // Get user's language preference
              const userLanguage = userInfo?.language || 'english';
              
              // Extract variables and translate notification content
              const variables = extractNotificationVariables(d.message, d.meta || {});
              const translatedTitle = translateNotification(d.title, userLanguage, variables);
              const translatedMessage = translateNotification(d.message, userLanguage, variables);

              await sendFirebaseNotification({
                token: userInfo.fcmToken,
                title: translatedTitle,
                body: translatedMessage,
                imageUrl: d.imageUrl,
              });
              
              // Return notification data with translated content
              return {
                ...d,
                title: translatedTitle,
                message: translatedMessage
              };
            }
          }
        })
      );
      if (notifyDoc?.length === 0) {
        return resultDb(SUCCESS, null);
      }
      notify = await Notification.insertMany(notifyDoc, { session });
      if (notify?.length > 0) {
        return resultDb(SUCCESS, notify);
      }
      return resultDb(NOT_FOUND, DATA_NULL);
    }

    let notify = null;
    if (Array.isArray(data?.userId)) {
      if (data?.userId.length === 0) {
        return resultDb(SUCCESS, notify);
      }
      let ids = data?.userId;
      let notifyDoc = await Promise.all(
        ids?.map(async (id) => {
          let userInfo = await User.findOne({ _id: id }).select(
            "fcmToken notification language"
          );
          if (userInfo) {
            if (userInfo?.notification && userInfo?.fcmToken) {
              // Get user's language preference
              const userLanguage = userInfo?.language || 'english';
              
              // Extract variables and translate notification content
              const variables = extractNotificationVariables(data.message, data.meta || {});
              const translatedTitle = translateNotification(data.title, userLanguage, variables);
              const translatedMessage = translateNotification(data.message, userLanguage, variables);

              await sendFirebaseNotification({
                token: userInfo.fcmToken,
                title: translatedTitle,
                body: translatedMessage,
                imageUrl: data.imageUrl,
              });
              
              return {
                ...data,
                userId: id,
                title: translatedTitle,
                message: translatedMessage
              };
            }
          }
        })
      );
      if (notifyDoc?.length === 0) {
        return resultDb(SUCCESS, null);
      }
      notify = await Notification.insertMany(notifyDoc, { session });
    } else {
      notify = new Notification(data);
      notify = await notify.save({ session });
      if (notify) {
        return resultDb(SUCCESS, notify);
      }
    }
    if (notify?.length > 0) {
      return resultDb(SUCCESS, notify);
    }
    return resultDb(NOT_FOUND, DATA_NULL);
  } catch (error) {
    console.error(error);
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

const getUserNotification = async (payload) => {
  try {
    let query = {
      isDeleted: false,
    };
    if (payload?.userId) {
      query.userId = objectId(payload.userId);
    }
    const total = await Notification.countDocuments(query);
    let list = await Notification.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "User",
          localField: "sendBy",
          foreignField: "_id",
          as: "sender",
        },
      },
      { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
      {
        $project: {
          _id: 1,
          userId: 1,
          sendBy: 1,
          type: 1,
          title: 1,
          message: 1,
          status: 1,
          imageUrl: 1,
          read: 1,
          createdAt: 1,
          "sender._id": 1,
          "sender.fullName": 1,
          "sender.profile": 1,
          "sender.profileImage": 1,
        },
      },
    ]);
    return resultDb(SUCCESS, { total, list });
  } catch (error) {
    console.error(error);
    return resultDb(SERVER_ERROR_CODE, DATA_NULL);
  }
};

processQueue(notificationQueue, notificationProcessor);

module.exports = {
  saveNotification,
  setSocketInstance,
  getAllNotificationByUserId,
  getNotificationByUserIdListed,
  getNotificationList,
  notificationStatusUpdateRead,
  notificationStatusUserIdUpdateReadAll,
  notifyUserOnEvent,
  getUserNotification,
  notifyUserOnEventNonSession,
};
