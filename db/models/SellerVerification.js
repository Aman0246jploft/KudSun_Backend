const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const SellerVerificationSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },  // Reference user

    legalFullName: { type: String, required: true },
    idNumber: { type: String, required: true },

    idDocumentFrontUrl: { type: String, required: true }, // URL of ID front image
    selfieWithIdUrl: { type: String, required: true },    // URL of selfie with ID image

    paymentPayoutMethod: {
        type: String,
        enum: ['PromptPay', 'BankTransfer'],
        required: true,
    },

    // For Bank Transfer method
    bankDetails: {
        bankName: { type: String },         // e.g. Bangkok Bank
        accountNumber: { type: String },
        accountHolderName: { type: String },
        bankBookUrl: { type: String },      // URL for uploaded bank book image
    },

    // For PromptPay method
    promptPayId: { type: String },        // Mobile number, Citizen ID, or Tax ID
    linkedBankName: { type: String },     // e.g. Krungthai Bank
    linkedBankLast4Digits: { type: String },  // e.g. '1234'

    isAuthorized: { type: Boolean, required: true },  // checkbox to authorize access/verification

    verificationStatus: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending',
    },

    isDisabled: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

module.exports = mongoose.model('SellerVerification', SellerVerificationSchema, 'SellerVerification');
