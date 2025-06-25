const moment = require('moment');
const mongoose = require("mongoose");
const { PRICING_TYPE, CHARGE_TYPE } = require('../../utils/Role');
const Schema = mongoose.Schema;



const feeSettingSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        enum: Object.values(CHARGE_TYPE), // 'SERVICE_CHARGE', 'BUYER_PROTECTION_FEE', 'TAX'
    },
    displayName: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: Object.values(PRICING_TYPE),//FIXED , PERCENTAGE
        required: true,
    },
    value: {
        type: Number,
        required: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    isDisable: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
}, {
    timestamps: true
});


feeSettingSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};
module.exports = mongoose.model("FeeSetting", feeSettingSchema, "FeeSetting");
