const mongoose = require('mongoose');
const { ORDER_STATUS } = require('../../../utils/Role');

const Schema = mongoose.Schema;

const OrderStatusHistorySchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  oldStatus: { type: String, enum: Object.values(ORDER_STATUS) },
  newStatus: { type: String, enum: Object.values(ORDER_STATUS), required: true },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // optional: who made the change
  changedAt: { type: Date, default: Date.now },
  note: { type: String }, // optional: reason or note
});

module.exports = mongoose.model('OrderStatusHistory', OrderStatusHistorySchema, 'OrderStatusHistory'); 