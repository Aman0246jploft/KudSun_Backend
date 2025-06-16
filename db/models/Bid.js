const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const BidSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    productId: {
        type: Schema.Types.ObjectId,
        ref: 'SellProduct',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    isWinningBid: {
        type: Boolean,
        default: false
    },
    isReserveMet: {
        type: Boolean,
        default: false
    },
    currentlyWinning: {
        type: Boolean,
        default: false
    },
    placedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("Bid", BidSchema, "Bid");
