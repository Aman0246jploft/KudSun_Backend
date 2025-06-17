const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ReviewSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'SellProduct', required: true },
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
        required: true,
        minlength: 50
    },
    reviewImages: [{
        type: String // URL to Cloudinary or other storage
    }],
    isDisabled: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

module.exports = mongoose.model('Review', ReviewSchema, 'Review');
