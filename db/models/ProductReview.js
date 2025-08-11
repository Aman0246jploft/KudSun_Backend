const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ReviewSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    otheruserId:{type: Schema.Types.ObjectId, ref: 'User', required: true},
    productId: { type: Schema.Types.ObjectId, ref: 'SellProduct', required: true },
    // orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    raterRole: {
        type: String,
        enum: ['buyer', 'seller'],
        required: true
    }, // 'buyer' = buyer rates seller, 'seller' = seller rates buyer
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    ratingText: { // e.g., "Fair", "Good"
        type: String
    },
    reviewText: {
        type: String,

    },
    reviewImages: [{
        type: String // URL to Cloudinary or other storage
    }],
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

module.exports = mongoose.model('Review', ReviewSchema, 'Review');
