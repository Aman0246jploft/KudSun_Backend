require("dotenv").config();
const mongoose = require("mongoose");
const cron = require("node-cron");
const moment = require("moment");

// Import models
const { Order, OrderStatusHistory, User } = require("../../../db");

// Import constants
const {
  ORDER_STATUS,
  PAYMENT_STATUS,
  NOTIFICATION_TYPES,
  createStandardizedNotificationMeta,
} = require("../../../utils/Role");

// Import notification service
const {
  saveNotification,
} = require("../../../routes/services/serviceNotification");

// Health check variables
let cronStats = {
  lastRun: null,
  lastSuccessfulRun: null,
  totalRuns: 0,
  successfulRuns: 0,
  failedRuns: 0,
  ordersCancelled: 0,
};

// Environment variables with defaults
// const CRON_SCHEDULE = process.env.PENDING_ORDER_CANCEL_CRON_SCHEDULE || "0 0 * * *"; // Daily at midnight
const CRON_SCHEDULE = process.env.PENDING_ORDER_CANCEL_CRON_SCHEDULE || "* * * * *"; 

const HOURS_THRESHOLD = parseInt(process.env.PENDING_ORDER_HOURS_THRESHOLD) || 5||24;

console.log(`🟡 Pending Order Cancel Cron initialized with schedule: ${CRON_SCHEDULE}`);
console.log(`🟡 Cancelling orders older than ${HOURS_THRESHOLD} hours`);

// Connect to MongoDB
mongoose
  .connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("🟢 MongoDB connected for Pending Order Cancel cron job");

    // Schedule the cron job
    cron.schedule(CRON_SCHEDULE, async () => {
      const session = await mongoose.startSession();
      
      try {
        session.startTransaction();
        cronStats.lastRun = new Date();
        cronStats.totalRuns++;
        
        console.log(`🔄 Starting Pending Order Cancel cron job at ${moment().format('YYYY-MM-DD HH:mm:ss')}`);

        // Calculate cutoff time (24 hours ago)
        // const cutoffTime = moment().subtract(HOURS_THRESHOLD, 'hours').toDate();
        const cutoffTime = moment().subtract(HOURS_THRESHOLD, 'minutes').toDate();

        console.log(`📅 Cutoff time: ${moment(cutoffTime).format('YYYY-MM-DD HH:mm:ss')}`);

        // Find orders that meet cancellation criteria:
        // 1. Order status is PENDING
        // 2. Payment status is PENDING
        // 3. Created more than 24 hours ago
        // 4. Not already deleted or disabled
        const ordersToCancel = await Order.find({
          status: ORDER_STATUS.PENDING,
          paymentStatus: PAYMENT_STATUS.PENDING,
          createdAt: { $lt: cutoffTime },
          isDeleted: { $ne: true },
          isDisable: { $ne: true }
        }).populate('userId', 'userName email')
          .populate('sellerId', 'userName email')
          .session(session);

        console.log(`📊 Found ${ordersToCancel.length} orders to cancel`);

        if (ordersToCancel.length === 0) {
          console.log("✅ No pending orders found to cancel");
          await session.commitTransaction();
          session.endSession();
          cronStats.successfulRuns++;
          cronStats.lastSuccessfulRun = new Date();
          return;
        }

        // Process each order for cancellation
        for (const order of ordersToCancel) {
          try {
            console.log(`🔄 Processing order: ${order.orderId} (Created: ${moment(order.createdAt).format('YYYY-MM-DD HH:mm:ss')})`);

            // Update order status
            await Order.findByIdAndUpdate(
              order._id,
              {
                $set: {
                  status: ORDER_STATUS.CANCELLED,
                  cancelledBy: null, // System cancellation
                  cancellationReason: `Auto-cancelled due to pending payment for more than ${HOURS_THRESHOLD} hours`,
                  cancelledAt: new Date()
                }
              },
              { session, new: true }
            );

            // Manually update isSold status for products since hooks might not work in transactions
            const productIds = order.items?.map((item) => item.productId);
            if (productIds?.length) {
              await mongoose
                .model("SellProduct")
                .updateMany(
                  { _id: { $in: productIds } },
                  { $set: { isSold: false } },
                  { session }
                );
              console.log(`🔄 Updated isSold=false for ${productIds.length} products`);
            }

            // Create order status history entry
            await OrderStatusHistory.create([{
              orderId: order._id,
              oldStatus: order.status,
              newStatus: ORDER_STATUS.CANCELLED,
              changedBy: null, // System change
              note: `Auto-cancelled due to pending payment for more than ${HOURS_THRESHOLD} minutes`,
              changedAt: new Date()
            }], { session });

            // Send notification to buyer
            if (order.userId) {
              const buyerNotificationMeta = createStandardizedNotificationMeta({
                type: NOTIFICATION_TYPES.ORDER,
                orderId: order._id,
                orderNumber: order.orderId,
                title: "Order Cancelled",
                message: `Your order ${order.orderId} has been automatically cancelled due to pending payment for more than ${HOURS_THRESHOLD} hours.`,
              });

              const buyerNotificationPayload = [{
                recipientId: order.userId._id,
                // userId: order.userId._id,
                type: NOTIFICATION_TYPES.ORDER,
                orderId: order._id,
                title: "Order Cancelled",
                message: `Your order ${order.orderId} has been automatically cancelled due to pending payment.`,
                meta: buyerNotificationMeta
              }];

              await saveNotification(buyerNotificationPayload);
            }

            // Send notification to seller
            if (order.sellerId) {
              const sellerNotificationMeta = createStandardizedNotificationMeta({
                type: NOTIFICATION_TYPES.ORDER,
                orderId: order._id,
                orderNumber: order.orderId,
                title: "Order Cancelled",
                message: `Order ${order.orderId} has been automatically cancelled due to buyer's pending payment for more than ${HOURS_THRESHOLD} hours.`,
              });

              const sellerNotificationPayload = [{
                recipientId: order.sellerId._id,
                // userId: order.sellerId._id,
                type: NOTIFICATION_TYPES.ORDER,
                orderId: order._id,
                title: "Order Cancelled",
                message: `Order ${order.orderId} has been automatically cancelled due to pending payment.`,
                meta: sellerNotificationMeta
              }];

              await saveNotification(sellerNotificationPayload);
            }

            cronStats.ordersCancelled++;
            console.log(`✅ Successfully cancelled order: ${order.orderId}`);

          } catch (orderError) {
            console.error(`❌ Error processing order ${order.orderId}:`, orderError);
            // Continue with next order instead of failing entire batch
          }
        }

        // Only commit transaction if it's still active
        if (session.inTransaction()) {
          await session.commitTransaction();
        }
        session.endSession();

        cronStats.successfulRuns++;
        cronStats.lastSuccessfulRun = new Date();
        
        console.log(`✅ Pending Order Cancel cron completed successfully`);
        console.log(`📊 Total orders cancelled: ${cronStats.ordersCancelled}`);
        console.log(`📊 Cron stats: ${cronStats.successfulRuns}/${cronStats.totalRuns} successful runs`);

      } catch (error) {
        // Only abort transaction if it's still active
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        session.endSession();
        
        cronStats.failedRuns++;
        console.error("❌ Pending Order Cancel cron job error:", error);
        console.error("❌ Stack trace:", error.stack);
      }
    });

    // Health check endpoint data
    global.pendingOrderCancelCronStats = cronStats;
    console.log("🟢 Pending Order Cancel cron job scheduled successfully");

  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed for Pending Order Cancel cron job:", err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🟡 Received SIGINT. Graceful shutdown...');
  mongoose.connection.close(() => {
    console.log('🔴 MongoDB connection closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('🟡 Received SIGTERM. Graceful shutdown...');
  mongoose.connection.close(() => {
    console.log('🔴 MongoDB connection closed.');
    process.exit(0);
  });
});

module.exports = {
  getCronStats: () => cronStats
};
