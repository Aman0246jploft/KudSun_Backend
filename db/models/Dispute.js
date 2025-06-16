const mongoose = require('mongoose');
const { DISPUTE_STATUS } = require('../../utils/Role');


const Schema = mongoose.Schema;

const DisputeSchema = new Schema({
    disputeId: { type: String, unique: true }, // e.g., DSP-XXXX

    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },

    reason: { type: String },

    description: { type: String, required: true },

    evidence: [{ type: String }], // URLs to uploaded images/videos/documents

    status: {
        type: String,
        enum: Object.values(DISPUTE_STATUS),
        default: DISPUTE_STATUS.PENDING
    },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

// Auto-generate disputeId like DSP-XXXX
DisputeSchema.pre('save', function (next) {
    if (!this.disputeId) {
        const shortId = this._id.toString().slice(-6).toUpperCase();
        this.disputeId = `DSP-${shortId}`;
    }
    next();
});

module.exports = mongoose.model('Dispute', DisputeSchema, 'Dispute');
