const mongoose = require("mongoose");

const ChatRoomSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatMessage',
    },
    isGroup: { type: Boolean, default: false },
    groupName: String,
    
    // Enhanced deletion tracking for rooms
    deleteBy: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        deletedAt: { type: Date, default: Date.now },
        // When user deletes room, all their messages in this room are also marked as deleted
        clearHistory: { type: Boolean, default: true }
    }],
    
    // Soft delete flag for complete room removal
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Index for efficient querying
ChatRoomSchema.index({ participants: 1 });
ChatRoomSchema.index({ 'deleteBy.userId': 1 });
ChatRoomSchema.index({ isDeleted: 1 });
ChatRoomSchema.index({ updatedAt: -1 });

// Instance method to check if room is deleted for a specific user
ChatRoomSchema.methods.isDeletedForUser = function(userId) {
    if (this.isDeleted) return true;
    return this.deleteBy.some(del => del.userId.toString() === userId.toString());
};

// Instance method to get delete info for a user
ChatRoomSchema.methods.getDeleteInfoForUser = function(userId) {
    return this.deleteBy.find(del => del.userId.toString() === userId.toString());
};

// Static method to get rooms visible to a specific user
ChatRoomSchema.statics.getVisibleRooms = function(query, userId) {
    return this.find({
        ...query,
        $and: [
            { isDeleted: false },
            {
                $or: [
                    { deleteBy: { $size: 0 } },
                    { 'deleteBy.userId': { $ne: userId } }
                ]
            }
        ]
    });
};

// Static method to delete room for specific user
ChatRoomSchema.statics.deleteForUser = function(roomId, userId, clearHistory = true) {
    return this.findByIdAndUpdate(
        roomId,
        {
            $addToSet: {
                deleteBy: {
                    userId: userId,
                    deletedAt: new Date(),
                    clearHistory: clearHistory
                }
            }
        },
        { new: true }
    );
};

// Static method to permanently delete room
ChatRoomSchema.statics.permanentDelete = function(roomId) {
    return this.findByIdAndUpdate(
        roomId,
        {
            isDeleted: true,
            deletedAt: new Date()
        },
        { new: true }
    );
};

ChatRoomSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};

module.exports = mongoose.model('ChatRoom', ChatRoomSchema, 'ChatRoom');

