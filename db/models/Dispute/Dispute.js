const mongoose = require('mongoose');
const { DISPUTE_STATUS, DISPUTE_DECISION, DISPUTE_RESPONSE_TYPE } = require('../../../utils/Role');

const Schema = mongoose.Schema;

const DisputeSchema = new Schema({
    disputeId: { type: String, unique: true }, // e.g., DSP-XXXX

    // Who raised the dispute (Buyer)
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Order and Seller info
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Buyer claim
    disputeType: { type: String, required: true }, // e.g., "Item Not Received", "Item Not as Described" , "Fake Item" , "Significant Damange"
    description: { type: String, required: true },
    evidence: [{ type: String }], // Buyer’s uploads (images/videos/documents)

    // Seller response
    sellerResponse: {
        responseType: {
            type: String,
            enum: Object.values(DISPUTE_RESPONSE_TYPE),
        },
        description: { type: String },
        attachments: [{ type: String }],
        respondedAt: { type: Date }
    },

    // Admin decision
    adminReview: {
        reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Admin ID
        decision: {
            type: String,
            enum: Object.values(DISPUTE_DECISION), // 'Buyer', 'Seller'
        },
        decisionNote: { type: String },
        resolvedAt: { type: Date }
    },

    status: {
        type: String,
        enum: Object.values(DISPUTE_STATUS), // e.g. 'PENDING', 'UNDER_REVIEW', 'RESOLVED'
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
