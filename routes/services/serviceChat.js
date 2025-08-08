const { ChatRoom, ChatMessage } = require("../../db");
const { SERVER_ERROR } = require("../../utils/constants");
const { resultDb, toObjectId } = require("../../utils/globalFunction");


async function findOrCreateOneOnOneRoom(userId1, userId2) {
    try {
        if (!userId1 || !userId2) throw new Error('Both user IDs are required');
        let isNew = false;
        
        // First, try to find an existing room (including partially deleted ones)
        let room = await ChatRoom.findOne({
            isGroup: false,
            participants: { $all: [toObjectId(userId1), toObjectId(userId2)], $size: 2 },
            isDeleted: false  // Only check if room is not permanently deleted
        });

        if (room) {
            // Check if room is deleted for either user
            const isDeletedForUser1 = room.deleteBy.some(del => del.userId.toString() === userId1.toString());
            const isDeletedForUser2 = room.deleteBy.some(del => del.userId.toString() === userId2.toString());
            
            if (isDeletedForUser1 || isDeletedForUser2) {
                // Room exists but is deleted for one or both users - restore it
                await ChatRoom.findByIdAndUpdate(room._id, {
                    $pull: {
                        deleteBy: {
                            userId: { $in: [toObjectId(userId1), toObjectId(userId2)] }
                        }
                    },
                    updatedAt: new Date()
                });
                
                // DO NOT restore old messages - users should only see new messages after room restoration
                // Old messages remain deleted for users who deleted the room to maintain "fresh start" experience
                
                console.log(`✅ Restored room ${room._id} for users ${userId1} and ${userId2} (old messages remain hidden)`);
                
                // Fetch the updated room
                room = await ChatRoom.findById(room._id);
            }
            
            // Room exists and is accessible to both users
            return { room, isNew };
        }

        // No room found, create a new one
        room = await ChatRoom.create({
            participants: [userId1, userId2],
            isGroup: false
        });
        isNew = true;
        
        console.log(`✅ Created new room ${room._id} for users ${userId1} and ${userId2}`);

        return { room, isNew };
    } catch (err) {
        console.log('❌ Error in findOrCreateOneOnOneRoom:', err.message);
        return resultDb(SERVER_ERROR, err.message);
    }
}

module.exports = { findOrCreateOneOnOneRoom };
