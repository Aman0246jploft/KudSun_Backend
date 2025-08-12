const mongoose = require("mongoose");
const { ORDER_STATUS, PAYMENT_STATUS, SHIPPING_STATUS } = require("../../../utils/Role");

const ChatMessageSchema = new mongoose.Schema({
    chatRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', required: true },

    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Null for system messages
    messageType: {
        type: String,
        enum: ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'SYSTEM', 'ORDER_STATUS', 'PAYMENT_STATUS', 'SHIPPING_STATUS', 'PRODUCT','REVIEW_STATUS'],
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
        title: { type: String },
        // Type of status update
        statusType: {
            type: String,
            enum: ['ORDER', 'PAYMENT', 'SHIPPING', 'SYSTEM', 'PRODUCT', 'DISPUTE', 'REVIEW'],
        },
        disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute' },
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

    // Enhanced deletion tracking
    deleteBy: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        deletedAt: { type: Date, default: Date.now },
        deleteType: { 
            type: String, 
            enum: ['MESSAGE_DELETE', 'ROOM_DELETE'], 
            default: 'MESSAGE_DELETE' 
        }
    }],

    // Soft delete flag for complete message removal
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

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
ChatMessageSchema.index({ 'deleteBy.userId': 1 });
ChatMessageSchema.index({ isDeleted: 1 });

// Instance method to check if message is deleted for a specific user
ChatMessageSchema.methods.isDeletedForUser = function(userId) {
    if (this.isDeleted) return true;
    return this.deleteBy.some(del => del.userId.toString() === userId.toString());
};

// Instance method to get delete info for a user
ChatMessageSchema.methods.getDeleteInfoForUser = function(userId) {
    return this.deleteBy.find(del => del.userId.toString() === userId.toString());
};

// Static method to get messages visible to a specific user
ChatMessageSchema.statics.getVisibleMessages = function(query, userId) {
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

// Static method to delete message for specific user
ChatMessageSchema.statics.deleteForUser = function(messageId, userId, deleteType = 'MESSAGE_DELETE') {
    return this.findByIdAndUpdate(
        messageId,
        {
            $addToSet: {
                deleteBy: {
                    userId: userId,
                    deletedAt: new Date(),
                    deleteType: deleteType
                }
            }
        },
        { new: true }
    );
};

// Static method to permanently delete message
ChatMessageSchema.statics.permanentDelete = function(messageId) {
    return this.findByIdAndUpdate(
        messageId,
        {
            isDeleted: true,
            deletedAt: new Date()
        },
        { new: true }
    );
};

ChatMessageSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};

module.exports = mongoose.model('ChatMessage', ChatMessageSchema, 'ChatMessage');
