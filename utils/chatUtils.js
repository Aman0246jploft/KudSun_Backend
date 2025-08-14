const { toObjectId } = require('./globalFunction');

function getVisibleMessagesFilter(userId) {
    return {
        $and: [
            { isDeleted: false },
            {
                $or: [
                    { deleteBy: { $size: 0 } },
                    { 'deleteBy.userId': { $ne: toObjectId(userId) } }
                ]
            }
        ]
    };
}


function getVisibleRoomsFilter(userId) {
    return {
        $and: [
            { isDeleted: false },
            {
                $or: [
                    { deleteBy: { $size: 0 } },
                    { 'deleteBy.userId': { $ne: toObjectId(userId) } }
                ]
            }
        ]
    };
}


async function getUnreadCountForRoom(ChatMessage, roomId, userId) {
    return await ChatMessage.countDocuments({
        chatRoom: toObjectId(roomId),
        seenBy: { $ne: toObjectId(userId) },
        sender: { $ne: toObjectId(userId) },
        ...getVisibleMessagesFilter(userId)
    });
}

async function getTotalUnreadCount(ChatRoom, ChatMessage, userId) {
    // Get all chat rooms visible to this user
    const userRooms = await ChatRoom.find({
        participants: toObjectId(userId),
        ...getVisibleRoomsFilter(userId)
    }).select('_id');

    const roomIds = userRooms.map(room => room._id);

    // Count all unread messages across all rooms (excluding deleted messages)
    return await ChatMessage.countDocuments({
        chatRoom: { $in: roomIds },
        seenBy: { $ne: toObjectId(userId) },
        sender: { $ne: toObjectId(userId) },
        ...getVisibleMessagesFilter(userId)
    });
}


async function getLatestVisibleMessage(ChatMessage, roomId, participants = []) {
    return await ChatMessage.findOne({
        chatRoom: toObjectId(roomId),
        $and: [
            { isDeleted: false },
            {
                $or: [
                    { deleteBy: { $size: 0 } },
                    // At least one participant can see it
                    { 'deleteBy.userId': { $nin: participants.map(p => toObjectId(p)) } }
                ]
            }
        ]
    }).sort({ createdAt: -1 });
}


function isMessageDeletedForUser(message, userId) {
    if (message.isDeleted) return true;
    return message.deleteBy.some(del => del.userId.toString() === userId.toString());
}


function isRoomDeletedForUser(room, userId) {
    if (room.isDeleted) return true;
    return room.deleteBy.some(del => del.userId.toString() === userId.toString());
}


function getDeleteInfoForUser(item, userId) {
    return item.deleteBy.find(del => del.userId.toString() === userId.toString()) || null;
}

module.exports = {
    getVisibleMessagesFilter,
    getVisibleRoomsFilter,
    getUnreadCountForRoom,
    getTotalUnreadCount,
    getLatestVisibleMessage,
    isMessageDeletedForUser,
    isRoomDeletedForUser,
    getDeleteInfoForUser
}; 