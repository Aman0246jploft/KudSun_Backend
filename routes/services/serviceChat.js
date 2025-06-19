const { ChatRoom } = require("../../db");
const { SERVER_ERROR } = require("../../utils/constants");
const { resultDb } = require("../../utils/globalFunction");


async function findOrCreateOneOnOneRoom(userId1, userId2) {
    try {
        if (!userId1 || !userId2) throw new Error('Both user IDs are required');

        // Try find existing room with exactly these two participants
        let room = await ChatRoom.findOne({
            isGroup: false,
            participants: { $all: [userId1, userId2], $size: 2 }
        });

        if (!room) {
            // Create new room if none found
            room = await ChatRoom.create({
                participants: [userId1, userId2],
                isGroup: false
            });
        }

        return room;
    } catch (err) {
        console.log(err.message)
        return resultDb(SERVER_ERROR, err.message);
    }
}

module.exports = { findOrCreateOneOnOneRoom };
