const mongoose = require("mongoose");

const ChatRoomSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatMessage',
    },
    isGroup: { type: Boolean, default: false },
    groupName: String,
    createdAt: { type: Date, default: Date.now },
});

ChatRoomSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};

module.exports = mongoose.model('ChatRoom', ChatRoomSchema, 'ChatRoom');

