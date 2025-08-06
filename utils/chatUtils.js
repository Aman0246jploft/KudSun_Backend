const { toObjectId } = require('./globalFunction');

/**
 * Get filter for messages visible to a specific user
 * @param {string} userId - The user ID to filter for
 * @returns {Object} MongoDB filter object
 */
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

/**
 * Get filter for chat rooms visible to a specific user
 * @param {string} userId - The user ID to filter for
 * @returns {Object} MongoDB filter object
 */
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

/**
 * Get unread messages count for a user in a specific room
 * @param {Object} ChatMessage - ChatMessage model
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCountForRoom(ChatMessage, roomId, userId) {
    return await ChatMessage.countDocuments({
        chatRoom: toObjectId(roomId),
        seenBy: { $ne: toObjectId(userId) },
        sender: { $ne: toObjectId(userId) },
        ...getVisibleMessagesFilter(userId)
    });
}

/**
 * Get total unread messages count across all rooms for a user
 * @param {Object} ChatRoom - ChatRoom model
 * @param {Object} ChatMessage - ChatMessage model
 * @param {string} userId - User ID
 * @returns {Promise<number>} Total unread count
 */
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

/**
 * Get the latest visible message in a room for updating lastMessage
 * @param {Object} ChatMessage - ChatMessage model
 * @param {string} roomId - Room ID
 * @param {Array} participants - Array of participant IDs
 * @returns {Promise<Object|null>} Latest message or null
 */
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

/**
 * Check if a message is deleted for a specific user
 * @param {Object} message - Message object
 * @param {string} userId - User ID
 * @returns {boolean} True if deleted for user
 */
function isMessageDeletedForUser(message, userId) {
    if (message.isDeleted) return true;
    return message.deleteBy.some(del => del.userId.toString() === userId.toString());
}

/**
 * Check if a room is deleted for a specific user
 * @param {Object} room - Room object
 * @param {string} userId - User ID
 * @returns {boolean} True if deleted for user
 */
function isRoomDeletedForUser(room, userId) {
    if (room.isDeleted) return true;
    return room.deleteBy.some(del => del.userId.toString() === userId.toString());
}

/**
 * Get deletion info for a user from message or room
 * @param {Object} item - Message or room object
 * @param {string} userId - User ID
 * @returns {Object|null} Delete info or null
 */
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