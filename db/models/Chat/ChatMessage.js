const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema({
    chatRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', required: true },

    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Null for system messages
    messageType: {
        type: String,
        enum: ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'SYSTEM', 'ORDER'],
        required: true,
    },

    // For normal messages
    content: { type: String },

    // For media/file messages
    mediaUrl: { type: String },
    mediaType: { type: String }, // e.g., "image/jpeg", "audio/mpeg"

    // For system/order-related messages
    systemMeta: {
        actionType: { type: String }, // e.g., "ORDER_PLACED", "ORDER_CANCELLED"
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
        text: { type: String }, // "User A placed an order for Product X"
        redirectUrl: { type: String }, // e.g., `/order/12345`
    },

    // Read status
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    createdAt: { type: Date, default: Date.now },
});


ChatMessageSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};


module.exports = mongoose.model('ChatMessage', ChatMessageSchema, 'ChatMessage');
