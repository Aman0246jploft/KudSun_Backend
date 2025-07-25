const mongoose = require('mongoose');
const { PAYMENT_STATUS, PAYMENT_METHOD, TNX_TYPE } = require('../../../utils/Role');

const Schema = mongoose.Schema;

const sellerWithdrawlSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    withDrawMethodId: { type: Schema.Types.ObjectId, ref: 'SellerBank' },
    amount: { type: Number, required: true },
    withdrawfee: {
        type: Number,
    },
    withdrawfeeType: {
        type: String
    },

    status: { type: String, enum: ['pending', 'Approved', "Rejected"], default: "pending" }
}, {
    timestamps: true
});



// Set null for undefined optional fields in JSON
sellerWithdrawlSchema.set('toJSON', {
    transform: function (doc, ret) {
        const fieldsToCheck = ['withdrawfee', 'withdrawfeeType', 'withDrawMethodId'];

        for (const field of fieldsToCheck) {
            if (ret[field] === undefined) {
                ret[field] = null;
            }
        }

        return ret;
    }
});


sellerWithdrawlSchema.index({ orderId: 1 });
sellerWithdrawlSchema.index({ userId: 1 });

module.exports = mongoose.model('SellerWithdrawl', sellerWithdrawlSchema, 'SellerWithdrawl'); 