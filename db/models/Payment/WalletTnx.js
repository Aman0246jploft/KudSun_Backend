const mongoose = require('mongoose');
const { PAYMENT_STATUS, PAYMENT_METHOD, TNX_TYPE } = require('../../../utils/Role');

const Schema = mongoose.Schema;

const sellerWalletTnxSchema = new Schema({
    orderId: {
        type: Schema.Types.ObjectId,
        ref: 'Order'
    },
    sellerWithdrawlId: {
        type: Schema.Types.ObjectId,
        ref: 'SellerWithdrawl'
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    netAmount: {
        type: Number
    },
    amount: {
        type: Number,
        required: true
    },
    tnxType: {
        type: String,
        enum: Object.values(TNX_TYPE),
        required: true
    },
    serviceCharge: {
        type: String,
    },
    serviceType: {
        type: String,

    },
    taxCharge: {
        type: String,
    },
    taxType: {
        type: String,

    },

    withdrawfee: {
        type: Number,
    },
    withdrawfeeType: {
        type: String,
        default: ''


    },
    notes: {
        type: String,
        default: ''
    },

    tnxStatus: {
        type: String,
        enum: Object.values(PAYMENT_STATUS),
        required: true
    }
}, {
    timestamps: true
});

// Conditional validation
sellerWalletTnxSchema.pre('validate', function (next) {
    if (this.tnxType === TNX_TYPE.CREDIT && !this.orderId) {
        return next(new Error('orderId is required for credit transactions'));
    }

    if (this.tnxType === TNX_TYPE.WITHDRAWL && !this.sellerWithdrawlId) {
        return next(new Error('sellerWithdrawlId is required for withdrawal transactions'));
    }

    next();
});


// Ensure null values are included in JSON output for optional fields
sellerWalletTnxSchema.set('toJSON', {
    transform: function (doc, ret) {
        const fieldsToCheck = [
            'serviceCharge', 'serviceType',
            'taxCharge', 'taxType',
            'withdrawfee', 'withdrawfeeType'
        ];

        for (const field of fieldsToCheck) {
            if (ret[field] === undefined) {
                ret[field] = null;
            }
        }

        return ret;
    }
});

sellerWalletTnxSchema.index({ orderId: 1 });
sellerWalletTnxSchema.index({ userId: 1 });

module.exports = mongoose.model('sellerWalletTnx', sellerWalletTnxSchema, 'sellerWalletTnx');
