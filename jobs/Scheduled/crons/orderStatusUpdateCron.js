require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const moment = require('moment');

// Import models
const { 
    Order, 
    OrderStatusHistory, 
    Dispute, 
    FeeSetting, 
    WalletTnx, 
    User, 
    PlatformRevenue,
    ChatRoom,
    ChatMessage 
} = require('../../../db');

// Import constants
const { 
    ORDER_STATUS, 
    PAYMENT_STATUS, 
    DISPUTE_STATUS, 
    PRICING_TYPE, 
    TNX_TYPE,
    CHARGE_TYPE,
    NOTIFICATION_TYPES 
} = require('../../../utils/Role');

// Import notification service
const { saveNotification } = require('../../../routes/services/serviceNotification');

// Connect to MongoDB
mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("🟢 MongoDB connected for Order Status Update Cron");

    // Run every hour at minute 0 (0 0 * * * *)
    // For testing, you can use '*/5 * * * *' to run every 5 minutes
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 Starting Order Status Update Cron Job at:', new Date().toISOString());
        
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            // Get current time
            const now = moment();
            const threeDaysAgo = now.clone().subtract(process.env.DAY, 'days');
            
            console.log('📅 Processing orders older than:', threeDaysAgo.format('YYYY-MM-DD HH:mm:ss'));
            
            // STEP 1: Update SHIPPED to DELIVERED (after 3 days)
            await updateShippedToDelivered(threeDaysAgo, session);
            
            // STEP 2: Update DELIVERED to COMPLETED (after 3 days, checking disputes)
            await updateDeliveredToCompleted(threeDaysAgo, session);
            
            await session.commitTransaction();
            console.log('✅ Order Status Update Cron Job completed successfully');
            
        } catch (error) {
            await session.abortTransaction();
            console.error('❌ Error in Order Status Update Cron:', error);
        } finally {
            session.endSession();
        }
    });

}).catch((error) => {
    console.error("❌ MongoDB connection failed for Order Status Update Cron:", error);
});

/**
 * Update orders from SHIPPED to DELIVERED after 3 days
 */
async function updateShippedToDelivered(threeDaysAgo, session) {
    try {
        console.log('🚛 Processing SHIPPED → DELIVERED updates...');
        
        // Find orders that are currently SHIPPED
        const shippedOrders = await Order.find({
            status: ORDER_STATUS.SHIPPED,
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            isDeleted: false,
            isDisable: false
        }).session(session);

        console.log(`📦 Found ${shippedOrders.length} shipped orders to check`);

        for (const order of shippedOrders) {
            // Find when the order was marked as SHIPPED
            const shippedHistory = await OrderStatusHistory.findOne({
                orderId: order._id,
                newStatus: ORDER_STATUS.SHIPPED
            }).sort({ changedAt: -1 }).session(session);

            if (!shippedHistory) {
                console.log(`⚠️ No shipping history found for order ${order._id}`);
                continue;
            }

            const shippedDate = moment(shippedHistory.changedAt);
            
            // Check if 3 days have passed since shipped
            if (shippedDate.isBefore(threeDaysAgo)) {
                console.log(`📅 Order ${order._id} shipped on ${shippedDate.format('YYYY-MM-DD')}, updating to DELIVERED`);
                
                // Update order status
                await Order.findByIdAndUpdate(
                    order._id,
                    { 
                        status: ORDER_STATUS.DELIVERED,
                        updatedAt: new Date()
                    },
                    { session }
                );

                // Create status history entry
                await OrderStatusHistory.create([{
                    orderId: order._id,
                    oldStatus: ORDER_STATUS.SHIPPED,
                    newStatus: ORDER_STATUS.DELIVERED,
                    note: 'Auto-updated to delivered after 3 days',
                    changedAt: new Date()
                }], { session });

                // Send notification to buyer
                await sendStatusUpdateNotification(order, ORDER_STATUS.DELIVERED, 'Your order has been automatically marked as delivered after 3 days.');
                
                console.log(`✅ Order ${order._id} updated to DELIVERED`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error in updateShippedToDelivered:', error);
        throw error;
    }
}

/**
 * Update orders from DELIVERED to COMPLETED after 3 days (checking for disputes)
 */
async function updateDeliveredToCompleted(threeDaysAgo, session) {
    try {
        console.log('📋 Processing DELIVERED → COMPLETED updates...');
        
        // Find orders that are currently DELIVERED
        const deliveredOrders = await Order.find({
            status: ORDER_STATUS.DELIVERED,
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            isDeleted: false,
            isDisable: false
        }).session(session);

        console.log(`📦 Found ${deliveredOrders.length} delivered orders to check`);

        for (const order of deliveredOrders) {
            // Find when the order was marked as DELIVERED
            const deliveredHistory = await OrderStatusHistory.findOne({
                orderId: order._id,
                newStatus: ORDER_STATUS.DELIVERED
            }).sort({ changedAt: -1 }).session(session);

            if (!deliveredHistory) {
                console.log(`⚠️ No delivery history found for order ${order._id}`);
                continue;
            }

            const deliveredDate = moment(deliveredHistory.changedAt);
            
            // Check if 3 days have passed since delivered
            if (deliveredDate.isBefore(threeDaysAgo)) {
                console.log(`📅 Order ${order._id} delivered on ${deliveredDate.format('YYYY-MM-DD')}, checking for disputes...`);
                
                // Check if there's an active dispute
                const activeDispute = await Dispute.findOne({
                    orderId: order._id,
                    isDeleted: false,
                    isDisable: false,
                    status: { $in: [DISPUTE_STATUS.PENDING, DISPUTE_STATUS.UNDER_REVIEW] }
                }).session(session);

                if (activeDispute) {
                    console.log(`⚠️ Order ${order._id} has active dispute (${activeDispute.status}), skipping completion`);
                    continue;
                }

                // Check if there was a resolved dispute
                const resolvedDispute = await Dispute.findOne({
                    orderId: order._id,
                    isDeleted: false,
                    isDisable: false,
                    status: DISPUTE_STATUS.RESOLVED
                }).session(session);

                if (resolvedDispute) {
                    console.log(`✅ Order ${order._id} had resolved dispute, proceeding with completion`);
                }

                // No active disputes - proceed with completion
                console.log(`🎉 Completing order ${order._id} and processing seller payment...`);
                
                // Update order status to COMPLETED
                await Order.findByIdAndUpdate(
                    order._id,
                    { 
                        status: ORDER_STATUS.COMPLETED,
                        updatedAt: new Date()
                    },
                    { session }
                );

                // Create status history entry
                await OrderStatusHistory.create([{
                    orderId: order._id,
                    oldStatus: ORDER_STATUS.DELIVERED,
                    newStatus: ORDER_STATUS.COMPLETED,
                    note: 'Auto-completed after 3 days with no disputes',
                    changedAt: new Date()
                }], { session });

                // Process seller payment
                await processSellerPayment(order, session);
                
                // Send notifications
                await sendCompletionNotifications(order);
                
                console.log(`✅ Order ${order._id} completed and seller paid`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error in updateDeliveredToCompleted:', error);
        throw error;
    }
}

/**
 * Process seller payment when order is completed
 */
async function processSellerPayment(order, session) {
    try {
        console.log(`💰 Processing payment for seller ${order.sellerId} for order ${order._id}`);
        
        // ✅ Prevents duplicate payments
        const existingPayment = await WalletTnx.findOne({
            orderId: order._id,
            userId: order.sellerId,
            tnxType: TNX_TYPE.CREDIT,
            tnxStatus: PAYMENT_STATUS.COMPLETED
        }).session(session);

        if (existingPayment) {
            console.log(`⚠️ Seller already paid for order ${order._id}`);
            return;
        }

        // Get fee settings
        const feeSettings = await FeeSetting.find({
            name: { $in: ["SERVICE_CHARGE", "TAX"] },
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).session(session);

        const serviceChargeSetting = feeSettings.find(f => f.name === "SERVICE_CHARGE");
        const taxSetting = feeSettings.find(f => f.name === "TAX");

        // Calculate fees
        const productCost = order.totalAmount || 0;
        let serviceCharge = 0;
        let serviceType = PRICING_TYPE.FIXED;
        let taxAmount = 0;
        let taxType = PRICING_TYPE.FIXED;

        if (serviceChargeSetting) {
            serviceType = serviceChargeSetting.type;
            if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
                serviceCharge = (productCost * serviceChargeSetting.value) / 100;
            } else {
                serviceCharge = serviceChargeSetting.value;
            }
        }

        if (taxSetting) {
            taxType = taxSetting.type;
            if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
                taxAmount = (productCost * taxSetting.value) / 100;
            } else {
                taxAmount = taxSetting.value;
            }
        }

        const netAmount = productCost - serviceCharge - taxAmount;

        console.log(`💳 Payment calculation: Product: $${productCost}, Service: $${serviceCharge}, Tax: $${taxAmount}, Net: $${netAmount}`);

        // Create wallet transaction for seller
        const sellerWalletTnx = new WalletTnx({
            orderId: order._id,
            userId: order.sellerId,
            amount: productCost,
            netAmount: netAmount,
            serviceCharge,
            taxCharge: taxAmount,
            tnxType: TNX_TYPE.CREDIT,
            serviceType: serviceType,
            taxType: taxType,
            tnxStatus: PAYMENT_STATUS.COMPLETED,
            notes: 'Auto-payment on order completion'
        });
        
        await sellerWalletTnx.save({ session });

        // ✅ Credits seller wallet
        await User.findByIdAndUpdate(
            order.sellerId,
            {
                $inc: { walletBalance: netAmount }
            },
            { session }
        );

        // Track platform revenue
        await trackCompletionRevenue(order, serviceCharge, taxAmount, serviceType, taxType, session);

        console.log(`✅ Seller payment processed: $${netAmount} credited to wallet`);
        
    } catch (error) {
        console.error('❌ Error processing seller payment:', error);
        throw error;
    }
}

/**
 * Track platform revenue when order is completed
 */
async function trackCompletionRevenue(order, serviceCharge, taxAmount, serviceType, taxType, session) {
    try {
        const revenueEntries = [];

        // Track Service Charge
        if (serviceCharge > 0) {
            revenueEntries.push({
                orderId: order._id,
                revenueType: 'SERVICE_CHARGE',
                amount: serviceCharge,
                calculationType: serviceType,
                baseAmount: order.totalAmount,
                status: 'COMPLETED',
                completedAt: new Date(),
                description: `Service charge for completed order ${order._id}`,
                metadata: {
                    orderTotal: order.totalAmount,
                    sellerId: order.sellerId
                }
            });
        }

        // Track Tax
        if (taxAmount > 0) {
            revenueEntries.push({
                orderId: order._id,
                revenueType: 'TAX',
                amount: taxAmount,
                calculationType: taxType,
                baseAmount: order.totalAmount,
                status: 'COMPLETED',
                completedAt: new Date(),
                description: `Tax for completed order ${order._id}`,
                metadata: {
                    orderTotal: order.totalAmount,
                    sellerId: order.sellerId
                }
            });
        }

        if (revenueEntries.length > 0) {
            await PlatformRevenue.insertMany(revenueEntries, { session });
            console.log(`📊 Platform revenue tracked: ${revenueEntries.length} entries`);
        }
        
    } catch (error) {
        console.error('❌ Error tracking completion revenue:', error);
        throw error;
    }
}

/**
 * Send notification for status update
 */
async function sendStatusUpdateNotification(order, newStatus, message) {
    try {
        const notifications = [{
            recipientId: order.userId,
            userId: order.sellerId,
            orderId: order._id,
            productId: order.items[0]?.productId,
            type: NOTIFICATION_TYPES.ORDER,
            title: `Order ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
            message: message,
            meta: {
                orderNumber: order._id.toString(),
                newStatus: newStatus,
                autoUpdate: true
            },
            redirectUrl: `/order/${order._id}`
        }];

        await saveNotification(notifications);
    } catch (error) {
        console.error('❌ Error sending status update notification:', error);
    }
}

/**
 * Send notifications when order is completed
 */
async function sendCompletionNotifications(order) {
    try {
        const notifications = [
            // Notification to buyer
            {
                recipientId: order.userId,
                userId: order.sellerId,
                orderId: order._id,
                productId: order.items[0]?.productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Order Completed!",
                message: `Your order has been automatically completed after 3 days. Thank you for your purchase!`,
                meta: {
                    orderNumber: order._id.toString(),
                    status: ORDER_STATUS.COMPLETED,
                    autoCompleted: true
                },
                redirectUrl: `/order/${order._id}`
            },
            // Notification to seller
            {
                recipientId: order.sellerId,
                userId: order.userId,
                orderId: order._id,
                productId: order.items[0]?.productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Order Completed - Payment Received!",
                message: `Your order has been completed and payment has been credited to your wallet.`,
                meta: {
                    orderNumber: order._id.toString(),
                    status: ORDER_STATUS.COMPLETED,
                    paymentProcessed: true
                },
                redirectUrl: `/wallet/transactions`
            }
        ];

        await saveNotification(notifications);
    } catch (error) {
        console.error('❌ Error sending completion notifications:', error);
    }
}

console.log('📅 Order Status Update Cron Job initialized. Scheduled to run daily at midnight.'); 