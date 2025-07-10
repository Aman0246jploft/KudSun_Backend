const mongoose = require("mongoose");
const moment = require("moment");
const { conditions, SALE_TYPE, DeliveryType } = require("../../utils/Role");
const Schema = mongoose.Schema;

const SellProductDraftSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    },
    subCategoryId: {
        type: mongoose.Schema.Types.ObjectId
    },
    title: {
        type: String,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    productImages: [{
        type: String
    }],
    tags: [{
        type: String,
        trim: true
    }],
    specifics: [{
        parameterId: { type: mongoose.Schema.Types.ObjectId },
        parameterName: { type: String },
        valueId: { type: mongoose.Schema.Types.ObjectId },
        valueName: { type: String }
    }],
    condition: {
        type: String,

    },
    saleType: {
        type: String,
        enum: Object.values(SALE_TYPE)
    },
    fixedPrice: {
        type: Number
    },
    originPriceView: {
        type: Boolean,
        default: false
    },
    originPrice: {
        type: Number
    },
  auctionSettings: {
        startingPrice: { type: Number },
        reservePrice: { type: Number },
        biddingIncrementPrice: { type: Number },
        duration: { type: Number },
        endDate: { type: String },//YYYY-MM-DD
        endTime: { type: String },//hh-mm
        biddingEndsAt: { type: Date },
        isBiddingOpen: { type: Boolean },// ✅ Add this
        timeZone: { type: String },
    },
    deliveryType: {
        type: String,
        enum: Object.values(DeliveryType)
    },
    shippingCharge: {
        type: Number
    },
    isDisable: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    isTrending: {
        type: Boolean,
        default: false
    },
    isSold: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

SellProductDraftSchema.index({ saleType: 1, isDeleted: 1, isDisable: 1 });
SellProductDraftSchema.index({ categoryId: 1, subCategoryId: 1 });
SellProductDraftSchema.index({ "specifics.valueId": 1 });
SellProductDraftSchema.index({ tags: 1 });
SellProductDraftSchema.index({ title: "text", description: "text", tags: "text" });

// Keep bidding time calculation, but make it optional
SellProductDraftSchema.pre('save', function (next) {
    const { endDate, endTime } = this.auctionSettings || {};

    if (endDate && endTime) {
        const [hours, minutes] = endTime.split(':').map(Number);
        const fullEnd = new Date(endDate);
        fullEnd.setHours(hours || 0, minutes || 0, 0, 0);
        this.auctionSettings.biddingEndsAt = fullEnd;
        this.auctionSettings.isBiddingOpen = new Date() < fullEnd;
    }

    next();
});

module.exports = mongoose.model("SellProductDraft", SellProductDraftSchema, "SellProductDraft");
