const { ChatRoom } = require("../../db");
const { SERVER_ERROR } = require("../../utils/constants");
const { resultDb } = require("../../utils/globalFunction");


async function findOrCreateOneOnOneRoom(userId1, userId2) {
    try {
        if (!userId1 || !userId2) throw new Error('Both user IDs are required');
        let isNew = false;
        // Try find existing room with exactly these two participants (excluding deleted rooms)
        let room = await ChatRoom.findOne({
            isGroup: false,
            participants: { $all: [userId1, userId2], $size: 2 },
            $and: [
                { isDeleted: false },
                {
                    $or: [
                        { deleteBy: { $size: 0 } },
                        { 
                            $and: [
                                { 'deleteBy.userId': { $ne: userId1 } },
                                { 'deleteBy.userId': { $ne: userId2 } }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!room) {
            // Create new room if none found
            room = await ChatRoom.create({
                participants: [userId1, userId2],
                isGroup: false
            });
             isNew = true;
        }

        return {room,isNew};
    } catch (err) {
        console.log(err.message)
        return resultDb(SERVER_ERROR, err.message);
    }
}

module.exports = { findOrCreateOneOnOneRoom };
