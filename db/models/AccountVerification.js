const mongoose = require('mongoose');
const { SELLER_PAYOUT_METHOD } = require('../../utils/Role');

const Schema = mongoose.Schema;

const AccountVerificationSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },  // Reference user

    legalFullName: { type: String, required: true },
    idNumber: { type: String, required: true },

    idDocumentFrontUrl: { type: String, required: true }, // URL of ID front image
    idDocumentBackUrl: { type: String, required: true }, // URL of ID back image
    selfieWithIdUrl: { type: String, required: true },    // URL of selfie with ID image

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

module.exports = mongoose.model('AccountVerification', AccountVerificationSchema, 'AccountVerification');
