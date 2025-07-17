const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../../utils/Role');
const { Schema } = mongoose;

const NotificationSchema = new Schema({
    // The recipient user of this notification
    //senderId
    recipientId: {
        type: Schema.Types.ObjectId,
        ref: 'User',

        index: true
    },

    // The category/type of the notification
    type: {
        type: String,
        required: true,
        enum: Object.values(NOTIFICATION_TYPES),
        index: true
    },

    // Related fields based on notification type
    //reciverId
    userId: {  // For type === 'user' or sender of any notification
        type: Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    },

    chatId: {  // For type === 'chat' or 'deal_chat'
        type: Schema.Types.ObjectId,
        ref: 'ChatRoom',
    },

    orderId: { // For type === 'order'
        type: Schema.Types.ObjectId,
        ref: 'Order',
    },
    productId: { // For deal_chat or activity related to products
        type: Schema.Types.ObjectId,
        ref: 'SellProduct',
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

    // Additional metadata for the notification
    meta: {
        type: Schema.Types.Mixed,
        default: {}
    },

    // For activity notifications
    activityType: {
        type: String,
        enum: ['like', 'comment', 'follow', 'bid', 'review', null],
        default: null
    },

    // URL to redirect when notification is clicked
    redirectUrl: {
        type: String,
        default: null
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
}, {
    timestamps: true,
    toJSON: {
        transform(doc, ret) {
            // Ensure all missing fields are set to null explicitly
            const fields = [
                'userId', 'chatId', 'orderId', 'productId',
                'activityType', 'redirectUrl', 'meta'
            ];

            for (const field of fields) {
                if (ret[field] === undefined) {
                    ret[field] = null;
                }
            }

            return ret;
        }
    }
});

// Pre-save hook to update updatedAt
NotificationSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Index for efficient querying
NotificationSchema.index({ recipientId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
