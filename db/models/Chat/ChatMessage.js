const mongoose = require("mongoose");
const { ORDER_STATUS, PAYMENT_STATUS, SHIPPING_STATUS } = require("../../../utils/Role");

const ChatMessageSchema = new mongoose.Schema({
    chatRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', required: true },

    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Null for system messages
    messageType: {
        type: String,
        enum: ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'SYSTEM', 'ORDER_STATUS', 'PAYMENT_STATUS', 'SHIPPING_STATUS', 'PRODUCT'],
        required: true,
    },

    // For normal messages
    content: { type: String },

    // For media/file messages
    mediaUrl: { type: String },
    mediaType: { type: String }, // e.g., "image/jpeg", "audio/mpeg"
    fileName: { type: String }, // Original file name

    // For system/order-related messages
    systemMeta: {
        // Type of status update
        statusType: {
            type: String,
            enum: ['ORDER', 'PAYMENT', 'SHIPPING', 'SYSTEM', 'PRODUCT'],
        },

        // The actual status value
        status: {
            type: String,
            // Will contain values from ORDER_STATUS, PAYMENT_STATUS, or SHIPPING_STATUS
            // depending on statusType
        },

        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'SellProduct' },
        
        // Product specific fields
        productName: { type: String },
        productImage: { type: String },
        price: { type: Number },

        // Additional metadata specific to the status
        meta: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },

        // Action buttons or links
        actions: [{
            label: { type: String },
            url: { type: String },
            type: { type: String }
        }],

        // Icon or image to show with the status
        icon: { type: String },

        // Color theme for the status message
        theme: {
            type: String,
            enum: ['success', 'warning', 'error', 'info', 'default'],
            default: 'default'
        }
    },

    // Read status
    seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Index for efficient querying
ChatMessageSchema.index({ chatRoom: 1, createdAt: -1 });
ChatMessageSchema.index({ 'systemMeta.orderId': 1 });
ChatMessageSchema.index({ 'systemMeta.productId': 1 });

ChatMessageSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};

module.exports = mongoose.model('ChatMessage', ChatMessageSchema, 'ChatMessage');
