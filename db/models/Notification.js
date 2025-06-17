import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
    {
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        key: {
            type: String,
            enum: [
                'like',
                'comment',
                'reply',
                'follow',
                'mention',
                'bid',
                'dispute',
                'verification',
                'system',
                'custom',
            ],
            required: true,
        },
        targetId: {
            type: mongoose.Schema.Types.ObjectId,
            required: false, // optional for system/custom messages
        },
        title: {
            type: String,
            default: '',
        },
        message: {
            type: String,
            required: true,
        },
        redirectUrl: {
            type: String, // e.g., `/thread/${threadId}` or `/dispute/${disputeId}`
            required: false,
        },
        image: {
            type: String, // optional: for user avatar, item image, etc.
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model('Notification', notificationSchema, "Notification");
