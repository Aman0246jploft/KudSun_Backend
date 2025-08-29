const mongoose = require("mongoose");
const {
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ORDER_STATUS,
  SALE_TYPE,
  PRICING_TYPE,
} = require("../../../utils/Role");

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

const OrderSchema = new Schema(
  {
    orderId: { type: String, unique: true }, // could be custom like ORD123456
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sellerId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    addressId: { type: Schema.Types.ObjectId, ref: "UserAddress" }, // foreign key
    items: [
      {
        productId: {
          type: Schema.Types.ObjectId,
          ref: "SellProduct",
          required: true,
        },
        quantity: { type: Number, default: 1 },
        saleType: { type: String, enum: Object.values(SALE_TYPE) },
        priceAtPurchase: { type: Number, required: true },
      },
    ],

    totalAmount: { type: Number, required: true },

    BuyerProtectionFee: { type: Number },
    BuyerProtectionFeeType: {
      type: String,
      enum: Object.values(PRICING_TYPE),
      default: PRICING_TYPE.FIXED,
    },
    TaxType: {
      type: String,
      enum: Object.values(PRICING_TYPE),
      default: PRICING_TYPE.FIXED,
    },
    Tax: { type: Number },

    shippingCharge: { type: Number, default: 0 },
    shippingId: {
      type: Schema.Types.ObjectId,
      ref: "Shipping",
    },
    grandTotal: { type: Number, required: true },
    paymentId: { type: String },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHOD),
      default: PAYMENT_METHOD.ONLINE,
    },

    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    disputeId: {
      type: Schema.Types.ObjectId,
      ref: "Dispute",
    },

    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User" }, // Who cancelled (buyer/seller)
    cancellationReason: { type: String }, // Reason for cancellation
    cancelledAt: { type: Date }, // When it was cancelled
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
OrderSchema.index({ userId: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ _id: 1, status: 1 });

OrderSchema.pre("save", async function (next) {
  if (!this.orderId) {
    const hexId = this._id.toString();
    const shortId = hexId.slice(-8).toUpperCase();
    this.orderId = `ORD-${shortId}`;
  }

  // if (this.isNew && this.items && this.items.length > 0) {
  //     const productIds = this.items.map(item => item.productId);
  //     await mongoose.model('SellProduct').updateMany(
  //         { _id: { $in: productIds } },
  //         { $set: { isSold: true } }
  //     );
  // }

  const cancelStatuses = [
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.RETURNED,
    ORDER_STATUS.FAILED,
    PAYMENT_STATUS.FAILED,
  ];
  if (
    !this.isNew &&
    this.isModified("status") &&
    cancelStatuses.includes(this.status)
  ) {
    const productIds = this.items?.map((item) => item.productId);
    if (productIds?.length) {
      await mongoose
        .model("SellProduct")
        .updateMany({ _id: { $in: productIds } }, { $set: { isSold: false } });
    }
  }

  // ✅ If payment is completed, mark products as sold
  if (
    !this.isNew &&
    this.isModified("paymentStatus") &&
    this.paymentStatus === PAYMENT_STATUS.COMPLETED
  ) {
    const productIds = this.items?.map((item) => item.productId);
    if (productIds?.length) {
      await mongoose
        .model("SellProduct")
        .updateMany({ _id: { $in: productIds } }, { $set: { isSold: true } });
    }
  }

  next();
});

OrderSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const update = this.getUpdate();
    const status = update?.status;

    // Only react when order status is being updated to one of the listed statuses
    const cancelStatuses = [
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.RETURNED,
      ORDER_STATUS.FAILED,
      PAYMENT_STATUS.FAILED,
    ];
    if (status && cancelStatuses.includes(status)) {
      // Get the current order to access its items
      const order = await this.model.findOne(this.getQuery()).lean();

      if (order && order.items?.length) {
        const productIds = order.items.map((item) => item.productId);
        await mongoose
          .model("SellProduct")
          .updateMany(
            { _id: { $in: productIds } },
            { $set: { isSold: false } }
          );
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Order", OrderSchema, "Order");
