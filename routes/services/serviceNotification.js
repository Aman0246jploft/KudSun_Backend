const { Notification, User } = require('../../db');
const { DATA_NULL, SUCCESS, SERVER_ERROR_CODE, NOT_FOUND } = require('../../utils/constants');
const { sendFirebaseNotification } = require('../../utils/FireNotification');
const { resultDb, momentValueFunc, objectId } = require('../../utils/globalFunction');
const { addJobToQueue, createQueue, processQueue } = require('./serviceBull');



const saveNotification = async (payload) => {
    try {
        if (!Array.isArray(payload) || payload.length === 0) {
            return resultDb(SERVER_ERROR_CODE, "Payload must be a non-empty array");
        }
        const notificationQueue = createQueue('notificationQueue');
        payload.forEach(userNotification => {
            addJobToQueue(notificationQueue, userNotification)
        });
        processQueue(notificationQueue, notificationProcessor);
        return resultDb(SUCCESS, { message: "Notifications added to the queue for saving one by one" });
    } catch (error) {
        console.error("Error saving notifications:", error);
        if (error.code) {
            return resultDb(error.code, DATA_NULL);
        }
        return resultDb(SERVER_ERROR_CODE, DATA_NULL);
    }
};

const notificationProcessor = async (job) => {
    try {
        console.log("1111111111", 111111111);
        const userNotification = job.data;
        if (userNotification && userNotification.userId && userNotification.title && userNotification.message) {
            await sendFirebaseNotification({ token: userNotification.deviceId, title: userNotification.title, body: userNotification.message, imageUrl: "" })
            const savedNotification = await Notification.create(userNotification);
            console.log("savedNotification", savedNotification, userNotification);
        } else {
            console.error("Invalid notification format in queue", userNotification);
        }
    } catch (error) {
        console.error("Error processing notification job:", error);
        throw error;
    }
};

const getAllNotificationByUserId = async (userId) => {
    try {
        const saveData = await Notification.find({ userId })
        if (saveData) {
            return resultDb(SUCCESS, saveData)
        }
        return resultDb(SERVER_ERROR_CODE, DATA_NULL)
    } catch (error) {
        if (error.code)
            return resultDb(error.code, DATA_NULL)
        return resultDb(SERVER_ERROR_CODE, DATA_NULL);
    }
}

const getNotificationByUserIdListed = async (payload) => {
    try {
        let query = { userId: payload?.userId };
        if (payload?.fromDate && payload?.toDate) {
            const fromTime = momentValueFunc(new Date(payload.fromDate))
            const endTime = momentValueFunc(new Date(payload.toDate)) + (24 * 60 * 60 * 1000)
            query.createdAt = {
                $gte: fromTime,
                $lte: endTime
            };
        } else if (payload?.fromDate) {
            const fromTime = momentValueFunc(new Date(payload.fromDate))
            query.createdAt = { $gte: fromTime };
        } else if (payload?.toDate) {
            const endTime = momentValueFunc(new Date(payload.toDate)) + (24 * 60 * 60 * 1000)
            query.createdAt = { $lte: endTime };
        }
        if (payload?.keyWord) {
            query.$or = [
                { 'title': { $regex: payload.keyWord, $options: 'i' } },
                { 'message': { $regex: payload.keyWord, $options: 'i' } },
                { 'notificationType': { $regex: payload.keyWord, $options: 'i' } }
            ];
        }
        let sortBy = payload?.sortBy || "createdAt";
        let pageNo = payload?.pageNo || 1;
        let limit = payload.size || 10;
        let sort = { [sortBy]: payload.sortOrder === "asc" ? 1 : -1 };
        const total = await Notification.countDocuments(query);
        const list = await Notification.find(query)
            .select("userId title message notificationType redirectUrl readAt createdAt isRead")
            .skip((pageNo - 1) * limit)
            .limit(limit)
            .sort(sort)
            .lean();

        let totalUnread = await Notification.countDocuments({ isRead: false, userId: payload?.userId });
        return resultDb(SUCCESS, {
            total,
            list,
            totalUnread
        });

    } catch (error) {
        if (error.code)
            return resultDb(error.code, DATA_NULL);
        return resultDb(SERVER_ERROR_CODE, DATA_NULL);
    }
}

const getNotificationList = async (payload) => {
    try {
        let matchStage = {};
        if (payload?.userId) {
            matchStage.userId = payload?.userId;
        }
        if (payload?.fromDate && payload?.toDate) {
            const fromTime = momentValueFunc(new Date(payload.fromDate));
            const endTime = momentValueFunc(new Date(payload.toDate)) + (24 * 60 * 60 * 1000);
            matchStage.createdAt = {
                $gte: fromTime,
                $lte: endTime
            };
        } else if (payload?.fromDate) {
            const fromTime = momentValueFunc(new Date(payload.fromDate));
            matchStage.createdAt = { $gte: fromTime };
        } else if (payload?.toDate) {
            const endTime = momentValueFunc(new Date(payload.toDate)) + (24 * 60 * 60 * 1000);
            matchStage.createdAt = { $lte: endTime };
        }

        if (payload?.keyWord) {
            matchStage.$or = [
                { 'title': { $regex: payload.keyWord, $options: 'i' } },
                { 'message': { $regex: payload.keyWord, $options: 'i' } },
                { 'notificationType': { $regex: payload.keyWord, $options: 'i' } }
            ];
        }
        if (payload?.type && payload?.type != "") {
            matchStage.type = payload.type
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
                    latestNotification: { $first: "$$ROOT" }
                }
            },
            {
                $replaceRoot: { newRoot: "$latestNotification" }
            },
            { $sort: { [sortBy]: sortOrder } },
            { $skip: skip },
            { $limit: limit }
        ];

        const groupedNotifications = await Notification.aggregate(aggregationPipeline);

        // Total count calculation, without skip and limit.
        const totalGroupsPipeline = [
            { $match: matchStage },
            { $group: { _id: "$randomId" } }
        ];

        const totalGroups = await Notification.aggregate(totalGroupsPipeline);
        const total = totalGroups.length;

        return resultDb(SUCCESS, {
            total,
            list: groupedNotifications
        });

    } catch (error) {
        console.log(error)
        if (error.code)
            return resultDb(error.code, DATA_NULL);
        return resultDb(SERVER_ERROR_CODE, DATA_NULL);
    }
};




const notificationStatusUpdateRead = async (id) => {
    try {
        const saveData = await Notification.findByIdAndUpdate(id, { $set: { isRead: true } }, { new: true })
        if (saveData) {
            return resultDb(SUCCESS, saveData)
        }
        return resultDb(SERVER_ERROR_CODE, DATA_NULL)
    } catch (error) {
        if (error.code)
            return resultDb(error.code, DATA_NULL)
        return resultDb(SERVER_ERROR_CODE, DATA_NULL);
    }
}


const notificationStatusUserIdUpdateReadAll = async (userId) => {
    try {
        const saveData = await Notification.updateMany(
            { userId: userId },
            { $set: { isRead: true } }
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
        if (Array.isArray(data)) {
            let notifyDoc = await Promise.all(
                data?.filter(async (d) => {
                    let deviceId = await User.findOne({ _id: d.userId }).select("deviceId notification");
                    if (deviceId) {
                        if (deviceId?.notification) {
                            await sendFirebaseNotification({ token: deviceId.deviceId, title: d.title, body: d?.message, imageUrl: d.imageUrl })
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
}

const notifyUserOnEvent = async (data, session) => {
    try {
        if (Array.isArray(data)) {
            let notifyDoc = await Promise.all(
                data?.filter(async (d) => {
                    let deviceId = await User.findOne({ _id: d.userId }).select("deviceId notification");
                    if (deviceId) {
                        if (deviceId?.notification) {
                            await sendFirebaseNotification({ token: deviceId.deviceId, title: d.title, body: d?.message, imageUrl: d.imageUrl })
                            return d;
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
                    let deviceId = await User.findOne({ _id: id }).select("deviceId notification");
                    if (deviceId) {
                        if (deviceId?.notification) {
                            await sendFirebaseNotification({ token: deviceId.deviceId, title: data.title, body: data?.message, imageUrl: data.imageUrl })
                            return {
                                ...data,
                                userId: id
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
}

const getUserNotification = async (payload) => {
    try {
        let query = {
            isDeleted: false
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
                    as: "sender"
                }
            },
            { $unwind: { path: "$sender", preserveNullAndEmptyArrays: true } },
            { $sort: { createdAt: -1 } },
            {
                $project: {
                    "_id": 1,
                    "userId": 1,
                    "sendBy": 1,
                    "type": 1,
                    "title": 1,
                    "message": 1,
                    "status": 1,
                    "imageUrl": 1,
                    "isRead": 1,
                    "createdAt": 1,
                    "sender._id": 1,
                    "sender.fullName": 1,
                    "sender.profile": 1,
                    "sender.profileImage": 1,
                }
            }
        ]);
        return resultDb(SUCCESS, { total, list });
    } catch (error) {
        console.error(error);
        return resultDb(SERVER_ERROR_CODE, DATA_NULL);
    }
}

module.exports = {
    saveNotification,
    getAllNotificationByUserId,
    getNotificationByUserIdListed,
    getNotificationList,
    notificationStatusUpdateRead,
    notificationStatusUserIdUpdateReadAll,
    notifyUserOnEvent,
    getUserNotification,
    notifyUserOnEventNonSession
}