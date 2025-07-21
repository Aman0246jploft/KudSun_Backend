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
    NOTIFICATION_TYPES,
    DISPUTE_DECISION,
    createStandardizedChatMeta,
    createStandardizedNotificationMeta,
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
    cron.schedule('*/2 0 * * *', async () => {
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

                let disputeInfo = null;
                if (resolvedDispute) {
                    // Check if the dispute has been resolved by admin
                    if (!resolvedDispute.adminReview || !resolvedDispute.adminReview.decision) {
                        console.log(`⚠️ Order ${order._id} has resolved dispute but no admin review decision, skipping completion`);
                        continue;
                    }

                    disputeInfo = {
                        decision: resolvedDispute.adminReview.decision,
                        disputeAmountPercent: resolvedDispute.adminReview.disputeAmountPercent || 0,
                        decisionNote: resolvedDispute.adminReview.decisionNote,
                        disputeId: resolvedDispute.disputeId
                    };

                    console.log(`✅ Order ${order._id} had resolved dispute - Decision: ${disputeInfo.decision}, Amount%: ${disputeInfo.disputeAmountPercent}%`);
                }

                // Proceed with completion
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
                const statusNote = disputeInfo 
                    ? `Auto-completed after 3 days with resolved dispute (${disputeInfo.decision} favor, ${disputeInfo.disputeAmountPercent}% dispute amount)`
                    : 'Auto-completed after 3 days with no disputes';

                await OrderStatusHistory.create([{
                    orderId: order._id,
                    oldStatus: ORDER_STATUS.DELIVERED,
                    newStatus: ORDER_STATUS.COMPLETED,
                    note: statusNote,
                    changedAt: new Date()
                }], { session });

                // Process seller payment with dispute information
                await processSellerPayment(order, session, disputeInfo);
                
                // Send notifications
                await sendCompletionNotifications(order, disputeInfo);
                
                console.log(`✅ Order ${order._id} completed and seller paid`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error in updateDeliveredToCompleted:', error);
        throw error;
    }
}

/**
 * Process seller payment for completed order, handling dispute resolutions
 */
async function processSellerPayment(order, session, disputeInfo = null) {
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

        // Calculate original product cost
        const originalProductCost = order.totalAmount || 0;
        let adjustedProductCost = originalProductCost;
        let disputeAdjustmentNote = '';

        // Apply dispute resolution if present
        if (disputeInfo) {
            const { decision, disputeAmountPercent } = disputeInfo;
            
            if (decision === DISPUTE_DECISION.SELLER) {
                // Seller wins - gets full amount (100%), disputeAmountPercent is ignored
                adjustedProductCost = originalProductCost; // No deduction
                disputeAdjustmentNote = `Dispute resolved in seller favor. Seller receives full amount (100%).`;
            } else if (decision === DISPUTE_DECISION.BUYER) {
                // Buyer wins - seller gets (100 - disputeAmountPercent)%, buyer gets disputeAmountPercent% refund
                adjustedProductCost = originalProductCost * ((100 - disputeAmountPercent) / 100);
                disputeAdjustmentNote = `Dispute resolved in buyer favor. Seller receives ${100 - disputeAmountPercent}% of original amount. Buyer gets ${disputeAmountPercent}% refund.`;
            }
            
            console.log(`⚖️ Dispute adjustment: Original $${originalProductCost} → Adjusted $${adjustedProductCost.toFixed(2)} (${disputeAdjustmentNote})`);
        }

        // Calculate fees based on adjusted amount
        let serviceCharge = 0;
        let serviceType = PRICING_TYPE.FIXED;
        let taxAmount = 0;
        let taxType = PRICING_TYPE.FIXED;

        if (serviceChargeSetting) {
            serviceType = serviceChargeSetting.type;
            if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
                serviceCharge = (adjustedProductCost * serviceChargeSetting.value) / 100;
            } else {
                serviceCharge = serviceChargeSetting.value;
            }
        }

        if (taxSetting) {
            taxType = taxSetting.type;
            if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
                taxAmount = (adjustedProductCost * taxSetting.value) / 100;
            } else {
                taxAmount = taxSetting.value;
            }
        }

        const netAmount = adjustedProductCost - serviceCharge - taxAmount;

        console.log(`💳 Payment calculation: Original: $${originalProductCost}, Adjusted: $${adjustedProductCost.toFixed(2)}, Service: $${serviceCharge.toFixed(2)}, Tax: $${taxAmount.toFixed(2)}, Net: $${netAmount.toFixed(2)}`);

        // Create wallet transaction for seller
        const transactionNotes = disputeInfo 
            ? `Auto-payment on order completion with dispute resolution. ${disputeAdjustmentNote}`
            : 'Auto-payment on order completion';

        const sellerWalletTnx = new WalletTnx({
            orderId: order._id,
            userId: order.sellerId,
            amount: adjustedProductCost,
            netAmount: netAmount,
            serviceCharge,
            taxCharge: taxAmount,
            tnxType: TNX_TYPE.CREDIT,
            serviceType: serviceType,
            taxType: taxType,
            tnxStatus: PAYMENT_STATUS.COMPLETED,
            notes: transactionNotes,
            // Add dispute info to transaction metadata if present
            ...(disputeInfo && {
                disputeInfo: {
                    disputeId: disputeInfo.disputeId,
                    decision: disputeInfo.decision,
                    disputeAmountPercent: disputeInfo.disputeAmountPercent,
                    originalAmount: originalProductCost,
                    adjustedAmount: adjustedProductCost
                }
            })
        });
        
        await sellerWalletTnx.save({ session });

        // ✅ Credits seller wallet with adjusted amount
        await User.findByIdAndUpdate(
            order.sellerId,
            {
                $inc: { walletBalance: netAmount }
            },
            { session }
        );

        // Track platform revenue based on adjusted amount
        await trackCompletionRevenue(order, serviceCharge, taxAmount, serviceType, taxType, session);

        console.log(`✅ Seller payment processed: $${netAmount.toFixed(2)} credited to wallet${disputeInfo ? ' (dispute-adjusted)' : ''}`);
        
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
            meta: createStandardizedNotificationMeta({
                orderNumber: order._id.toString(),
                orderId: order._id.toString(),
                itemCount: order.items?.length || 0,
                totalAmount: order.totalAmount,
                amount: order.grandTotal,
                oldStatus: order.status,
                newStatus: newStatus,
                paymentMethod: order.paymentMethod,
                paymentId: order.paymentId,
                productId: order.items[0]?.productId,
                productTitle: order.items[0]?.productTitle,
                sellerId: order.sellerId,
                buyerId: order.userId,
                status: newStatus,
                autoUpdate: true,
                actionBy: 'system'
            }),
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
async function sendCompletionNotifications(order, disputeInfo = null) {
    try {
        // Buyer notification
        const buyerMessage = disputeInfo 
            ? `Your order has been automatically completed after 3 days. A dispute was resolved in ${disputeInfo.decision === DISPUTE_DECISION.BUYER ? 'your' : 'seller'} favor. Thank you for your purchase!`
            : `Your order has been automatically completed after 3 days. Thank you for your purchase!`;

        // Seller notification
        let sellerTitle = "Order Completed - Payment Received!";
        let sellerMessage = `Your order has been completed and payment has been credited to your wallet.`;
        
        if (disputeInfo) {
            if (disputeInfo.decision === DISPUTE_DECISION.SELLER) {
                sellerTitle = "Order Completed - Dispute Resolved in Your Favor!";
                sellerMessage = `Your order has been completed and full payment has been credited to your wallet. Dispute was resolved in your favor. ${disputeInfo.decisionNote || ''}`;
            } else {
                sellerTitle = "Order Completed - Partial Payment Due to Dispute";
                sellerMessage = `Your order has been completed with partial payment (${100 - disputeInfo.disputeAmountPercent}% of order value) credited to your wallet. Dispute was resolved in buyer favor. ${disputeInfo.decisionNote || ''}`;
            }
        }

        const notifications = [
            // Notification to buyer
            {
                recipientId: order.userId,
                userId: order.sellerId,
                orderId: order._id,
                productId: order.items[0]?.productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Order Completed!",
                message: buyerMessage,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    itemCount: order.items?.length || 0,
                    totalAmount: order.totalAmount,
                    amount: order.grandTotal,
                    oldStatus: ORDER_STATUS.DELIVERED,
                    newStatus: ORDER_STATUS.COMPLETED,
                    paymentMethod: order.paymentMethod,
                    paymentId: order.paymentId,
                    productId: order.items[0]?.productId,
                    productTitle: order.items[0]?.productTitle,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    status: ORDER_STATUS.COMPLETED,
                    actionBy: 'system',
                    processedBy: 'auto-completion',
                    autoCompleted: true,
                    ...(disputeInfo && {
                        disputeId: disputeInfo.disputeId,
                        disputeStatus: 'RESOLVED',
                        disputeDecision: disputeInfo.decision,
                        disputeAmountPercent: disputeInfo.disputeAmountPercent,
                        refundAmount: disputeInfo.decision === DISPUTE_DECISION.BUYER ? 
                            (order.grandTotal * disputeInfo.disputeAmountPercent / 100) : 0
                    })
                }),
                redirectUrl: `/order/${order._id}`
            },
            // Notification to seller
            {
                recipientId: order.sellerId,
                userId: order.userId,
                orderId: order._id,
                productId: order.items[0]?.productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: sellerTitle,
                message: sellerMessage,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    itemCount: order.items?.length || 0,
                    totalAmount: order.totalAmount,
                    amount: order.grandTotal,
                    oldStatus: ORDER_STATUS.DELIVERED,
                    newStatus: ORDER_STATUS.COMPLETED,
                    paymentMethod: order.paymentMethod,
                    paymentId: order.paymentId,
                    productId: order.items[0]?.productId,
                    productTitle: order.items[0]?.productTitle,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    status: ORDER_STATUS.COMPLETED,
                    actionBy: 'system',
                    processedBy: 'auto-completion',
                    paymentProcessed: true,
                    ...(disputeInfo && {
                        disputeId: disputeInfo.disputeId,
                        disputeStatus: 'RESOLVED',
                        disputeDecision: disputeInfo.decision,
                        disputeAmountPercent: disputeInfo.disputeAmountPercent,
                        netAmountPaid: disputeInfo.decision === DISPUTE_DECISION.SELLER ? 
                            order.totalAmount : (order.totalAmount * (100 - disputeInfo.disputeAmountPercent) / 100),
                        refundAmount: disputeInfo.decision === DISPUTE_DECISION.BUYER ? 
                            (order.grandTotal * disputeInfo.disputeAmountPercent / 100) : 0
                    })
                }),
                redirectUrl: `/wallet/transactions`
            }
        ];

        await saveNotification(notifications);
    } catch (error) {
        console.error('❌ Error sending completion notifications:', error);
    }
}

console.log('📅 Order Status Update Cron Job initialized. Scheduled to run daily at midnight.'); 