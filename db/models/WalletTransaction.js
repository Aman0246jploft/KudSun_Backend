const mongoose = require('mongoose');
const { PRICING_TYPE } = require('../../utils/Role');

const WalletTransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: false, // optional, since not all wallet transactions may relate to an order
    },

    amount: {
        type: Number,  // Final credited/debited amount       //amount + shippingCharge -(ServiceChange+Tax)
        required: true,
    },

    grossAmount: {
        type: Number, // Original amount before deductions
        required: true,
    },
    deductions: {
        serviceCharge: { type: Number, default: 0 },
        serviceChargeType: {
            type: String,
            enum: Object.values(PRICING_TYPE),
            default: PRICING_TYPE.FIXED
        },
        tax: { type: Number, default: 0 },
        taxType: {
            type: String,
            enum: Object.values(PRICING_TYPE),
            default: PRICING_TYPE.FIXED
        },
        shippingCharge: { type: Number, default: 0 } // optional, can omit if not impacting wallet
    },

    type: {
        type: String,
        enum: ['CREDIT', 'DEBIT'],
        required: true,
    },
    reason: {
        type: String,
        default: '',
    },
    balanceBefore: {
        type: Number,
        required: false,
    },
    balanceAfter: {
        type: Number,
        required: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('WalletTransaction', WalletTransactionSchema, 'WalletTransaction');
