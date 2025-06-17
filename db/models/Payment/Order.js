const mongoose = require("mongoose");
const { PAYMENT_STATUS, PAYMENT_METHOD, ORDER_STATUS, SALE_TYPE } = require("../../../utils/Role");

// const ORDER_STATUS = {
//     PENDING: 'pending',
//     CONFIRMED: 'confirmed',
//     SHIPPED: 'shipped',
//     DELIVERED: 'delivered',
//     CANCELLED: 'cancelled',
//     RETURNED: 'returned',
//     FAILED: 'failed'
// };

// const PAYMENT_STATUS = {
//     PENDING: 'pending',
//     COMPLETED: 'completed',
//     FAILED: 'failed',
//     REFUNDED: 'refunded'
// };

// const PAYMENT_METHOD = {
//     COD: 'cash_on_delivery',
//     ONLINE: 'online_payment'
// };

const Schema = mongoose.Schema;

const OrderSchema = new Schema({
    orderId: { type: String, unique: true, }, // could be custom like ORD123456
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    addressId: { type: Schema.Types.ObjectId, ref: 'UserAddress', required: true }, // foreign key
    addressSnapshot: {
        fullName: String,
        phone: String,
        line1: String,
        line2: String,
        city: String,
        state: String,
        country: String,
        postalCode: String
    },

    items: [{
        productId: { type: Schema.Types.ObjectId, ref: 'SellProduct', required: true },
        quantity: { type: Number, default: 1 },
        saleType: { type: String, enum: Object.values(SALE_TYPE) },
        priceAtPurchase: { type: Number, required: true }
    }],

    totalAmount: { type: Number, required: true },
    platformFee: { type: Number },
    shippingCharge: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHOD), default: PAYMENT_METHOD.ONLINE },

    status: {
        type: String,
        enum: Object.values(ORDER_STATUS),
        default: ORDER_STATUS.PENDING
    },


    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

// Indexes for performance
OrderSchema.index({ userId: 1 });
OrderSchema.index({ status: 1 });

OrderSchema.pre('save', function (next) {
    if (!this.orderId) {
        const hexId = this._id.toString();
        const shortId = hexId.slice(-8).toUpperCase();
        this.orderId = `ORD-${shortId}`;
    }
    next();
});


module.exports = mongoose.model("Order", OrderSchema, "Order");
