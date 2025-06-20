const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../../utils/Role');
const { Schema } = mongoose;

const NotificationSchema = new Schema({
    // The recipient user of this notification
    recipientId: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },

    // The category/type of the notification (user, chat, etc)
    type: {
        type: String,
        required: true,
        enum: Object.values(NOTIFICATION_TYPES)
    },
    // Conditional related fields depending on type
    userId: {  // For type === 'user'
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    chatId: {  // For type === 'chat'
        type: Schema.Types.ObjectId,
        ref: 'Chat',
    },
    orderId: { // For type === 'order'
        type: Schema.Types.ObjectId,
        ref: 'Order',
    },

    title: {
        type: String,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },

    read: {
        type: Boolean,
        default: false,
        index: true,
    },

    meta: {
        type: Schema.Types.Mixed,
    },

    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },

    updatedAt: {
        type: Date,
        default: Date.now,
    }
});

// Pre-save hook to update updatedAt
NotificationSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Notification', NotificationSchema);
