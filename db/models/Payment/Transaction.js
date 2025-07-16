const mongoose = require('mongoose');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../../utils/Role');

const Schema = mongoose.Schema;

const TransactionSchema = new Schema({
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHOD), required: true },
    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), required: true },
    type: { type: String, enum: ['PAYMENT', 'REFUND'], default: 'PAYMENT' },
    paymentGatewayId: { type: String, required: true }, // e.g., Stripe/PayPal txn id
    cardType: { type: String }, // e.g., 'Visa', 'Mastercard'
    cardLast4: { type: String }, // last 4 digits only
    // Optionally, add refund info, currency, etc.
}, {
    timestamps: true
});

TransactionSchema.index({ orderId: 1 });
TransactionSchema.index({ userId: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema, 'Transaction'); 