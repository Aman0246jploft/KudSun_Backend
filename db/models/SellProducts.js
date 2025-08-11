const { object } = require("joi");
const mongoose = require("mongoose");
const moment = require('moment')
const { conditions, SALE_TYPE, DeliveryType } = require("../../utils/Role");
const Schema = mongoose.Schema;



const SellProductsSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    subCategoryId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    title: {
        type: String,
        required: true,
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
    specifics: {
        type: [{
            parameterId: { type: mongoose.Schema.Types.ObjectId },
            parameterName: { type: String },
            valueId: { type: mongoose.Schema.Types.ObjectId },
            valueName: { type: String }
        }],
        default: null
    },
    condition: {
        type: String,
        required: true
    },
    saleType: {
        type: String,
        enum: Object.values(SALE_TYPE),
        required: true
    },
    fixedPrice: {
        type: Number
        // only required if saleType is 'fixed'
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
        enum: Object.values(DeliveryType),
        required: true
    },
    shippingCharge: {
        type: Number
        // only required if deliveryType is 'shipping'
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
    viewCount: {
        type: Number,
        default: 0
    },
    isSold: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

SellProductsSchema.index({ saleType: 1, isDeleted: 1, isDisable: 1 });
SellProductsSchema.index({ categoryId: 1, subCategoryId: 1 });
SellProductsSchema.index({ tags: 1 });
SellProductsSchema.index({ _id: 1, isSold: 1 });
SellProductsSchema.index({ title: "text", description: "text", tags: "text" });
SellProductsSchema.pre('save', function (next) {



    if (this.saleType === SALE_TYPE.FIXED && !this.fixedPrice) {
        // if (this.auctionSettings && Object.keys(this.auctionSettings).some(key => this.auctionSettings[key] != null)) {
        //     return next(new Error("Auction settings should be empty when saleType is 'fixed'"));
        // }

        return next(new Error("Fixed price is required when saleType is 'fixed'"));
    }

    if (this.saleType === SALE_TYPE.AUCTION) {
        const auction = this.auctionSettings || {};
        const { startingPrice, reservePrice, endDate, duration } = auction;

        if (
            startingPrice == null ||
            reservePrice == null ||
            (duration == null && !endDate)
        ) {
            return next(new Error("Auction settings must include startingPrice, reservePrice, and either duration or endDate when saleType is 'auction'"));
        }
    }

    // const { endDate, endTime } = this.auctionSettings || {};
    // if (endDate && endTime) {
    //     const [hours, minutes] = endTime.split(':').map(Number);
    //     const fullEnd = new Date(endDate);
    //     fullEnd.setHours(hours || 0, minutes || 0, 0, 0);
    //     this.auctionSettings.biddingEndsAt = fullEnd;
    //     this.auctionSettings.isBiddingOpen = new Date() < fullEnd;
    // }
    // if (endDate && endTime) {
    //     const fullEnd = moment(`${moment(endDate).format("YYYY-MM-DD")} ${endTime}`, "YYYY-MM-DD HH:mm");
    //     if (!fullEnd.isValid()) {
    //         return next(new Error("Invalid bidding end time format"));
    //     }
    //     this.auctionSettings.biddingEndsAt = fullEnd.toDate();
    //     this.auctionSettings.isBiddingOpen = moment().isBefore(fullEnd);
    // }

    if (this.deliveryType === DeliveryType.CHARGE_SHIPPING && this.shippingCharge == null) {
        return next(new Error("Shipping charge is required when delivery type is 'shipping'"));
    }

    next();
});

module.exports = mongoose.model("SellProduct", SellProductsSchema, "SellProduct"); 
