const mongoose = require('mongoose');

const platformRevenueSchema = new mongoose.Schema({
    // Transaction Reference
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        sparse: true
    },
    withdrawalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellerWithdrawl',
        sparse: true
    },

    // Revenue Type
    revenueType: {
        type: String,
        enum: ['BUYER_PROTECTION_FEE', 'SERVICE_CHARGE', 'TAX', 'WITHDRAWAL_FEE'],
        required: true
    },

    // Amount Details
    amount: {
        type: Number,
        required: true
    },
    calculationType: {
        type: String,
        enum: ['PERCENTAGE', 'FIXED'],
        required: true
    },
    calculationValue: {
        type: Number,
        required: true // The percentage or fixed value used
    },
    baseAmount: {
        type: Number,
        required: true // The amount on which calculation was done
    },

    // Status
    status: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'REFUNDED', 'CANCELLED'],
        default: 'PENDING'
    },

    // Metadata
    description: String,
    metadata: {
        type: mongoose.Schema.Types.Mixed
    },

    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,

    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Indexes
platformRevenueSchema.index({ orderId: 1 });
platformRevenueSchema.index({ withdrawalId: 1 });
platformRevenueSchema.index({ revenueType: 1 });
platformRevenueSchema.index({ status: 1 });
platformRevenueSchema.index({ createdAt: 1 });

module.exports = mongoose.model('PlatformRevenue', platformRevenueSchema); 