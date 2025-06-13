const { object } = require("joi");
const mongoose = require("mongoose");
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
    specifics: [{
        parameterId: { type: mongoose.Schema.Types.ObjectId, required: true },
        parameterName: { type: String, required: true },
        valueId: { type: mongoose.Schema.Types.ObjectId, required: true },
        valueName: { type: String, required: true }
    }],
    condition: {
        type: String,
        enum: Object.values(conditions),
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
        endDate: { type: Date },
        endTime: { type: String }
        // only required if saleType is 'auction'
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
    }
}, {
    timestamps: true
});
SellProductsSchema.pre('save', function (next) {
    if (this.saleType === SALE_TYPE.FIXED && !this.fixedPrice) {
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

    if (this.deliveryType === DeliveryType.CHARGE_SHIPPING && this.shippingCharge == null) {
        return next(new Error("Shipping charge is required when delivery type is 'shipping'"));
    }

    next();
});

module.exports = mongoose.model("SellProduct", SellProductsSchema, "SellProduct"); 
