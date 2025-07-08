const mongoose = require('mongoose');
const { SHIPPING_STATUS } = require('../../../utils/Role');
const Schema = mongoose.Schema;

// const SHIPPING_STATUS = {
//     NOT_DISPATCHED: 'not_dispatched',
//     IN_TRANSIT: 'in_transit',
//     DELIVERED: 'delivered',
//     RETURNED: 'returned'
// };


const ShippingSchema = new Schema({
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    addressId: { type: Schema.Types.ObjectId, ref: 'UserAddress', required: true }, // same as used in order
    trackingNumber: { type: String },
    carrier: { type: Schema.Types.ObjectId, ref: 'Carrier', required: true }, // e.g., BlueDart, Delhivery, etc.  
    // status: {
    //     type: String,
    //     enum: Object.values(SHIPPING_STATUS),
    //     default: SHIPPING_STATUS.NOT_DISPATCHED
    // },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

ShippingSchema.index({ orderId: 1 });
ShippingSchema.index({ addressId: 1 });
ShippingSchema.index({ status: 1 });

module.exports = mongoose.model('Shipping', ShippingSchema, 'Shipping');
