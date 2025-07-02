const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const SellerBankSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId, ref: 'User',
        lowercase: true,
    },
    bankName: { type: String },         // e.g. Bangkok Bank
    accountNumber: { type: String },
    accountHolderName: { type: String },
    isActive: {
        type: Boolean, default: false
    },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
})
module.exports = mongoose.model('SellerBank', SellerBankSchema, 'SellerBank');
