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

// Health check variables
let cronStats = {
    lastRun: null,
    lastSuccessfulRun: null,
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    ordersProcessed: 0,
    paymentsProcessed: 0,
    disputesHandled: 0
};

// Environment variables with defaults
const PROCESSING_DAY_LIMIT = parseInt(process.env.DAY);
const CRON_SCHEDULE =  '* * * * *'; // Daily at midnight by default
const ENABLE_EMAIL_NOTIFICATIONS = process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true';
const CONFIRM_RECEIPT_TO_COMPLETED_DAY_LIMIT = PROCESSING_DAY_LIMIT;

// Connect to MongoDB
mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("🟢 MongoDB connected for Order Status Update Cron");
    console.log(`📅 Cron scheduled to run: ${CRON_SCHEDULE}`);
    console.log(`⏱️ Processing orders older than: ${PROCESSING_DAY_LIMIT} days`);

    // Run the cron job
    cron.schedule(CRON_SCHEDULE, async () => {
        const runStartTime = new Date();
        console.log('🔄 Starting Order Status Update Cron Job at:', runStartTime.toISOString());

        cronStats.lastRun = runStartTime;
        cronStats.totalRuns++;

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Validate environment and settings before processing
            await validateSystemState();

            // Get current time
            const now = moment();
            const cutoffDate = now.clone().subtract(PROCESSING_DAY_LIMIT, 'days');

            console.log('📅 Processing orders older than:', cutoffDate.format('YYYY-MM-DD HH:mm:ss'));

            // Track processing stats
            let processedStats = {
                shippedToDelivered: 0,
                deliveredToCompleted: 0,
                paymentsProcessed: 0,
                disputesHandled: 0,
                errors: []
            };

            // STEP 1: Update SHIPPED to DELIVERED (after N days)
            const shippedStats = await updateShippedToDelivered(cutoffDate, session);
            processedStats.shippedToDelivered = shippedStats.updated;
            processedStats.errors.push(...shippedStats.errors);

            // STEP 2: Update DELIVERED to COMPLETED (after N days, checking disputes)
            const completedStats = await updateDeliveredToCompleted(cutoffDate, session);
            processedStats.deliveredToCompleted = completedStats.updated;
            processedStats.paymentsProcessed = completedStats.paymentsProcessed;
            processedStats.disputesHandled = completedStats.disputesHandled;
            processedStats.errors.push(...completedStats.errors);

            // STEP 3: Update CONFIRM_RECEIPT to COMPLETED (after N days, checking disputes)
            const confirmReceiptStats = await updateConfirmReceiptToCompleted(now.clone().subtract(CONFIRM_RECEIPT_TO_COMPLETED_DAY_LIMIT, 'days'), session);
            processedStats.confirmReceiptToCompleted = confirmReceiptStats.updated;
            processedStats.paymentsProcessed += confirmReceiptStats.paymentsProcessed;
            processedStats.disputesHandled += confirmReceiptStats.disputesHandled;
            processedStats.errors.push(...confirmReceiptStats.errors);

            // STEP 4: Update DISPUTE to COMPLETED (if dispute is resolved)
            const disputedStats = await updateDisputedToCompleted(session);
            processedStats.disputedToCompleted = disputedStats.updated;
            processedStats.paymentsProcessed += disputedStats.paymentsProcessed;
            processedStats.disputesHandled += disputedStats.disputesHandled;
            processedStats.errors.push(...disputedStats.errors);

            // Update global stats
            cronStats.ordersProcessed += (processedStats.shippedToDelivered + processedStats.deliveredToCompleted + processedStats.confirmReceiptToCompleted + processedStats.disputedToCompleted);
            cronStats.paymentsProcessed += processedStats.paymentsProcessed;
            cronStats.disputesHandled += processedStats.disputesHandled;

            await session.commitTransaction();

            const runEndTime = new Date();
            const duration = runEndTime - runStartTime;

            cronStats.lastSuccessfulRun = runEndTime;
            cronStats.successfulRuns++;

            console.log('✅ Order Status Update Cron Job completed successfully');
            console.log(`📊 Processing Summary:
            - Duration: ${duration}ms
            - Shipped → Delivered: ${processedStats.shippedToDelivered}
            - Delivered → Completed: ${processedStats.deliveredToCompleted}
            - Confirm Receipt → Completed: ${processedStats.confirmReceiptToCompleted}
            - Disputed → Completed: ${processedStats.disputedToCompleted}
            - Payments Processed: ${processedStats.paymentsProcessed}
            - Disputes Handled: ${processedStats.disputesHandled}
            - Errors: ${processedStats.errors.length}`);

            if (processedStats.errors.length > 0) {
                console.log('⚠️ Errors during processing:', processedStats.errors);
            }

            // Send summary notification if enabled
            if (ENABLE_EMAIL_NOTIFICATIONS) {
                await sendCronSummaryNotification(processedStats, duration);
            }

        } catch (error) {
            await session.abortTransaction();
            cronStats.failedRuns++;

            console.error('❌ Critical Error in Order Status Update Cron:', error);

            // Send error notification
            if (ENABLE_EMAIL_NOTIFICATIONS) {
                await sendCronErrorNotification(error);
            }
        } finally {
            session.endSession();
        }
    });

    // Health check endpoint (if using Express)
    if (typeof global.app !== 'undefined') {
        global.app.get('/cron/health/order-status-update', (req, res) => {
            res.json({
                status: 'running',
                schedule: CRON_SCHEDULE,
                processingDayLimit: PROCESSING_DAY_LIMIT,
                stats: cronStats,
                uptime: process.uptime()
            });
        });
    }

}).catch((error) => {
    console.error("❌ MongoDB connection failed for Order Status Update Cron:", error);
});

/**
 * Validate system state before processing orders
 */
async function validateSystemState() {
    console.log('🔍 Validating system state...');

    // Check if required fee settings exist
    const requiredFeeSettings = ['SERVICE_CHARGE', 'WITHDRAWAL_FEE'];

    // const requiredFeeSettings = ['SERVICE_CHARGE', 'TAX', 'WITHDRAWAL_FEE'];
    const feeSettings = await FeeSetting.find({
        name: { $in: requiredFeeSettings },
        isActive: true,
        isDisable: false,
        isDeleted: false
    });

    const missingSettings = requiredFeeSettings.filter(
        setting => !feeSettings.find(f => f.name === setting)
    );

    if (missingSettings.length > 0) {
        throw new Error(`Missing required fee settings: ${missingSettings.join(', ')}`);
    }

    // Check database connectivity
    if (mongoose.connection.readyState !== 1) {
        throw new Error('Database not connected');
    }

    console.log('✅ System state validation passed');
}

/**
 * Update orders from SHIPPED to DELIVERED after N days
 */
async function updateShippedToDelivered(cutoffDate, session) {
    try {
        console.log('🚛 Processing SHIPPED → DELIVERED updates...');

        let stats = { updated: 0, errors: [] };

        // Find orders that are currently SHIPPED with proper validation
        const shippedOrders = await Order.find({
            status: ORDER_STATUS.SHIPPED,
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            isDeleted: false,
            isDisable: false,
            // Add safety check for order age
            // createdAt: { $lt: moment().subtract(1, 'hour').toDate() } // At least 1 hour old
        }).populate('sellerId userId', 'userName email').session(session);

        console.log(`📦 Found ${shippedOrders.length} shipped orders to check`);

        for (const order of shippedOrders) {
            try {
                // Find when the order was marked as SHIPPED
                const shippedHistory = await OrderStatusHistory.findOne({
                    orderId: order._id,
                    newStatus: ORDER_STATUS.SHIPPED
                }).sort({ changedAt: -1 }).session(session);

                if (!shippedHistory) {
                    stats.errors.push(`No shipping history found for order ${order._id}`);
                    continue;
                }

                const shippedDate = moment(shippedHistory.changedAt);

                // Check if N days have passed since shipped
                if (shippedDate.isBefore(cutoffDate)) {
                    console.log(`📅 Order ${order._id} shipped on ${shippedDate.format('YYYY-MM-DD')}, updating to DELIVERED`);

                    // Additional validation - check if order is not in dispute
                    const activeDispute = await Dispute.findOne({
                        orderId: order._id,
                        isDeleted: false,
                        isDisable: false,
                        status: { $in: [DISPUTE_STATUS.PENDING, DISPUTE_STATUS.UNDER_REVIEW] }
                    }).session(session);

                    if (activeDispute) {
                        console.log(`⚠️ Order ${order._id} has active dispute, skipping auto-delivery`);
                        continue;
                    }


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
                        note: `Auto-updated to delivered after ${PROCESSING_DAY_LIMIT} days (Cron Job)`,
                        changedAt: new Date(),
                        changedBy: null // System update
                    }], { session });

                    // Send notification to buyer
                    await sendStatusUpdateNotification(
                        order,
                        ORDER_STATUS.DELIVERED,
                        `Your order has been automatically marked as delivered after ${PROCESSING_DAY_LIMIT} days. If you haven't received it, please contact the seller or start a dispute.`
                    );

                    stats.updated++;
                    console.log(`✅ Order ${order._id} updated to DELIVERED`);
                } else {
                    console.log(`⏳ Order ${order._id} not yet ready for delivery (shipped ${shippedDate.fromNow()})`);
                }
            } catch (orderError) {
                const errorMsg = `Error processing shipped order ${order._id}: ${orderError.message}`;
                stats.errors.push(errorMsg);
                console.error(`❌ ${errorMsg}`);
            }
        }

        console.log(`✅ SHIPPED → DELIVERED: ${stats.updated} orders updated, ${stats.errors.length} errors`);
        return stats;

    } catch (error) {
        console.error('❌ Error in updateShippedToDelivered:', error);
        throw error;
    }
}

/**
 * Update orders from DELIVERED to COMPLETED after N days (checking for disputes)
 */
async function updateDeliveredToCompleted(cutoffDate, session) {
    try {
        console.log('📋 Processing DELIVERED → COMPLETED updates...');

        let stats = { updated: 0, paymentsProcessed: 0, disputesHandled: 0, errors: [] };

        // Find orders that are currently DELIVERED with proper validation
        const deliveredOrders = await Order.find({
            status: ORDER_STATUS.DELIVERED,
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            isDeleted: false,
            isDisable: false,
            // Add safety check for minimum delivery time
            // updatedAt: { $lt: moment().subtract(1, 'hour').toDate() } // At least 1 hour since delivered
        }).populate('sellerId userId', 'userName email').session(session);

        console.log(`📦 Found ${deliveredOrders.length} delivered orders to check`);

        for (const order of deliveredOrders) {
            try {
                // Find when the order was marked as DELIVERED
                const deliveredHistory = await OrderStatusHistory.findOne({
                    orderId: order._id,
                    newStatus: ORDER_STATUS.DELIVERED
                }).sort({ changedAt: -1 }).session(session);

                if (!deliveredHistory) {
                    stats.errors.push(`No delivery history found for order ${order._id}`);
                    continue;
                }

                const deliveredDate = moment(deliveredHistory.changedAt);

                // Check if N days have passed since delivered
                if (deliveredDate.isBefore(cutoffDate)) {
                    console.log(`📅 Order ${order._id} delivered on ${deliveredDate.format('YYYY-MM-DD')}, checking for disputes...`);

                    // Check for disputes and validate dispute resolution
                    const disputeInfo = await validateAndProcessDispute(order._id, session);

                    if (disputeInfo.shouldSkip) {
                        stats.errors.push(`Order ${order._id}: ${disputeInfo.reason}`);
                        continue;
                    }

                    // Additional validation before completion
                    const validationResult = await validateOrderForCompletion(order, session);
                    if (!validationResult.isValid) {
                        stats.errors.push(`Order ${order._id}: ${validationResult.reason}`);
                        continue;
                    }

                    // Proceed with completion
                    console.log(`🎉 Completing order ${order._id} and processing seller payment...`);

                    // Update order status to COMPLETED
                    const updated = await Order.findByIdAndUpdate(
                        order._id,
                        {
                            status: ORDER_STATUS.COMPLETED,
                            updatedAt: new Date()
                        },
                        { session, new: true }
                    );

                    if (!updated || updated.status !== ORDER_STATUS.COMPLETED) {
                        stats.errors.push(`Order ${order._id}: status update to COMPLETED failed`);
                        continue;
                    }

                    // Create comprehensive status history entry
                    const statusNote = disputeInfo.disputeData
                        ? `Auto-completed after ${PROCESSING_DAY_LIMIT} days with resolved dispute (${disputeInfo.disputeData.decision} favor, ${disputeInfo.disputeData.disputeAmountPercent}% dispute amount)`
                        : `Auto-completed after ${PROCESSING_DAY_LIMIT} days with no disputes`;

                    await OrderStatusHistory.create([{
                        orderId: order._id,
                        oldStatus: ORDER_STATUS.DELIVERED,
                        newStatus: ORDER_STATUS.COMPLETED,
                        note: statusNote,
                        changedAt: new Date(),
                        changedBy: null // System update
                    }], { session });

                    // Process seller payment with enhanced error handling
                    const paymentResult = await processSellerPaymentEnhanced(order, session, disputeInfo.disputeData);
                    if (paymentResult.success) {
                        stats.paymentsProcessed++;
                    } else {
                        stats.errors.push(`Payment processing failed for order ${order._id}: ${paymentResult.error}`);
                    }

                    // Send comprehensive notifications
                    await sendCompletionNotifications(order, disputeInfo.disputeData);

                    if (disputeInfo.disputeData) {
                        stats.disputesHandled++;
                    }

                    stats.updated++;
                    console.log(`✅ Order ${order._id} completed${disputeInfo.disputeData ? ' (with dispute resolution)' : ''}`);
                } else {
                    console.log(`⏳ Order ${order._id} not yet ready for completion (delivered ${deliveredDate.fromNow()})`);
                }
            } catch (orderError) {
                const errorMsg = `Error processing delivered order ${order._id}: ${orderError.message}`;
                stats.errors.push(errorMsg);
                console.error(`❌ ${errorMsg}`);
            }
        }

        console.log(`✅ DELIVERED → COMPLETED: ${stats.updated} orders completed, ${stats.paymentsProcessed} payments processed, ${stats.disputesHandled} disputes handled, ${stats.errors.length} errors`);
        return stats;

    } catch (error) {
        console.error('❌ Error in updateDeliveredToCompleted:', error);
        throw error;
    }
}

/**
 * Update orders from CONFIRM_RECEIPT to COMPLETED after N days (checking for disputes)
 */
async function updateConfirmReceiptToCompleted(cutoffDate, session) {
    try {
        console.log('📋 Processing CONFIRM_RECEIPT → COMPLETED updates...');

        let stats = { updated: 0, paymentsProcessed: 0, disputesHandled: 0, errors: [] };

        // Find orders that are currently CONFIRM_RECEIPT with proper validation
        const confirmReceiptOrders = await Order.find({
            status: ORDER_STATUS.CONFIRM_RECEIPT,
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            isDeleted: false,
            isDisable: false,
        }).populate('sellerId userId', 'userName email').session(session);

        console.log(`📦 Found ${confirmReceiptOrders.length} confirm receipt orders to check`);

        for (const order of confirmReceiptOrders) {
            try {
                // Find when the order was marked as CONFIRM_RECEIPT
                const confirmReceiptHistory = await OrderStatusHistory.findOne({
                    orderId: order._id,
                    newStatus: ORDER_STATUS.DELIVERED
                }).sort({ changedAt: -1 }).session(session);

                if (!confirmReceiptHistory) {
                    stats.errors.push(`No confirm receipt history found for order ${order._id}`);
                    continue;
                }

                const confirmReceiptDate = moment(confirmReceiptHistory.changedAt);

                // Check if N days have passed since confirm receipt
                if (confirmReceiptDate.isBefore(cutoffDate)) {
                    console.log(`📅 Order ${order._id} confirm receipt on ${confirmReceiptDate.format('YYYY-MM-DD')}, checking for disputes...`);

                    // Check for disputes and validate dispute resolution
                    const disputeInfo = await validateAndProcessDispute(order._id, session);

                    if (disputeInfo.shouldSkip) {
                        stats.errors.push(`Order ${order._id}: ${disputeInfo.reason}`);
                        continue;
                    }

                    // Additional validation before completion
                    const validationResult = await validateOrderForCompletion(order, session);
                    if (!validationResult.isValid) {
                        stats.errors.push(`Order ${order._id}: ${validationResult.reason}`);
                        continue;
                    }

                    // Proceed with completion
                    console.log(`🎉 Completing order ${order._id} and processing seller payment...`);

                    // Update order status to COMPLETED
                    const updated = await Order.findByIdAndUpdate(
                        order._id,
                        {
                            status: ORDER_STATUS.COMPLETED,
                            updatedAt: new Date()
                        },
                        { session, new: true }
                    );

                    if (!updated || updated.status !== ORDER_STATUS.COMPLETED) {
                        stats.errors.push(`Order ${order._id}: status update to COMPLETED failed`);
                        continue;
                    }

                    // Create comprehensive status history entry
                    const statusNote = disputeInfo.disputeData
                        ? `Auto-completed after ${CONFIRM_RECEIPT_TO_COMPLETED_DAY_LIMIT} days with resolved dispute (${disputeInfo.disputeData.decision} favor, ${disputeInfo.disputeData.disputeAmountPercent}% dispute amount)`
                        : `Auto-completed after ${CONFIRM_RECEIPT_TO_COMPLETED_DAY_LIMIT} days with no disputes`;

                    await OrderStatusHistory.create([{
                        orderId: order._id,
                        oldStatus: ORDER_STATUS.CONFIRM_RECEIPT,
                        newStatus: ORDER_STATUS.COMPLETED,
                        note: statusNote,
                        changedAt: new Date(),
                        changedBy: null // System update
                    }], { session });

                    // Process seller payment with enhanced error handling
                    const paymentResult = await processSellerPaymentEnhanced(order, session, disputeInfo.disputeData);
                    if (paymentResult.success) {
                        stats.paymentsProcessed++;
                    } else {
                        stats.errors.push(`Payment processing failed for order ${order._id}: ${paymentResult.error}`);
                    }

                    // Send comprehensive notifications
                    await sendCompletionNotifications(order, disputeInfo.disputeData);

                    if (disputeInfo.disputeData) {
                        stats.disputesHandled++;
                    }

                    stats.updated++;
                    console.log(`✅ Order ${order._id} completed from CONFIRM_RECEIPT${disputeInfo.disputeData ? ' (with dispute resolution)' : ''}`);
                } else {
                    console.log(`⏳ Order ${order._id} not yet ready for completion (confirm receipt ${confirmReceiptDate.fromNow()})`);
                }
            } catch (orderError) {
                const errorMsg = `Error processing confirm receipt order ${order._id}: ${orderError.message}`;
                stats.errors.push(errorMsg);
                console.error(`❌ ${errorMsg}`);
            }
        }

        console.log(`✅ CONFIRM_RECEIPT → COMPLETED: ${stats.updated} orders completed, ${stats.paymentsProcessed} payments processed, ${stats.disputesHandled} disputes handled, ${stats.errors.length} errors`);
        return stats;

    } catch (error) {
        console.error('❌ Error in updateConfirmReceiptToCompleted:', error);
        throw error;
    }
}

/**
 * Update orders from DISPUTE to COMPLETED if dispute is resolved
 */
async function updateDisputedToCompleted(session) {
    try {
        console.log('⚖️ Processing DISPUTE → COMPLETED updates...');

        let stats = { updated: 0, paymentsProcessed: 0, disputesHandled: 0, errors: [] };

        // Find orders that are currently DISPUTE with proper validation
        const disputedOrders = await Order.find({
            status: ORDER_STATUS.DISPUTE,
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            isDeleted: false,
            isDisable: false,
        }).populate('sellerId userId', 'userName email').session(session);

        console.log(`⚖️ Found ${disputedOrders.length} disputed orders to check`);

        for (const order of disputedOrders) {
            try {
                console.log(`🔍 Checking dispute status for order ${order._id}...`);

                // Find the associated dispute and validate its resolution
                const dispute = await Dispute.findOne({
                    orderId: order._id,
                    isDeleted: false,
                    isDisable: false
                }).session(session);

                if (!dispute) {
                    stats.errors.push(`Order ${order._id} is DISPUTE but no dispute record found`);
                    continue;
                }

                // Check if dispute is resolved
                if (dispute.status !== DISPUTE_STATUS.RESOLVED) {
                    console.log(`⏳ Order ${order._id} dispute still ${dispute.status}, skipping...`);
                    continue;
                }

                // Validate dispute resolution details
                if (!dispute.adminReview || !dispute.adminReview.decision) {
                    stats.errors.push(`Order ${order._id} dispute resolved but missing admin review decision`);
                    continue;
                }

                const { decision, disputeAmountPercent = 0 } = dispute.adminReview;

                // Validate dispute amount percentage
                if (decision === DISPUTE_DECISION.BUYER && (disputeAmountPercent < 0 || disputeAmountPercent > 100)) {
                    stats.errors.push(`Order ${order._id} has invalid dispute amount percentage: ${disputeAmountPercent}%`);
                    continue;
                }

                console.log(`✅ Order ${order._id} dispute resolved - Decision: ${decision}, Amount%: ${disputeAmountPercent}%`);

                // Additional validation before completion
                const validationResult = await validateOrderForCompletion(order, session);
                if (!validationResult.isValid) {
                    stats.errors.push(`Order ${order._id}: ${validationResult.reason}`);
                    continue;
                }

                // Prepare dispute info for payment processing
                const disputeInfo = {
                    decision: dispute.adminReview.decision,
                    disputeAmountPercent: disputeAmountPercent,
                    decisionNote: dispute.adminReview.decisionNote,
                    disputeId: dispute.disputeId,
                    resolvedAt: dispute.adminReview.resolvedAt,
                    reviewedBy: dispute.adminReview.reviewedBy
                };

                // Proceed with completion
                console.log(`🎉 Completing disputed order ${order._id} and processing seller payment...`);

                // Update order status to COMPLETED
                const updated = await Order.findByIdAndUpdate(
                    order._id,
                    {
                        status: ORDER_STATUS.COMPLETED,
                        updatedAt: new Date()
                    },
                    { session, new: true }
                );

                if (!updated || updated.status !== ORDER_STATUS.COMPLETED) {
                    stats.errors.push(`Order ${order._id}: status update to COMPLETED failed`);
                    continue;
                }

                // Create comprehensive status history entry
                const statusNote = `Disputed order completed with resolved dispute (${disputeInfo.decision} favor, ${disputeInfo.disputeAmountPercent}% dispute amount) - Cron Job`;

                await OrderStatusHistory.create([{
                    orderId: order._id,
                    oldStatus: ORDER_STATUS.DISPUTE,
                    newStatus: ORDER_STATUS.COMPLETED,
                    note: statusNote,
                    changedAt: new Date(),
                    changedBy: null // System update
                }], { session });

                // Process seller payment with dispute resolution
                const paymentResult = await processSellerPaymentEnhanced(order, session, disputeInfo);
                if (paymentResult.success) {
                    stats.paymentsProcessed++;
                } else {
                    stats.errors.push(`Payment processing failed for disputed order ${order._id}: ${paymentResult.error}`);
                }

                // Send comprehensive notifications for dispute resolution completion
                await sendDisputeResolutionCompletionNotifications(order, disputeInfo);

                stats.disputesHandled++;
                stats.updated++;
                console.log(`✅ Disputed order ${order._id} completed with ${disputeInfo.decision} favor resolution`);

            } catch (orderError) {
                const errorMsg = `Error processing disputed order ${order._id}: ${orderError.message}`;
                stats.errors.push(errorMsg);
                console.error(`❌ ${errorMsg}`);
            }
        }

        console.log(`✅ DISPUTE → COMPLETED: ${stats.updated} orders completed, ${stats.paymentsProcessed} payments processed, ${stats.disputesHandled} disputes handled, ${stats.errors.length} errors`);
        return stats;

    } catch (error) {
        console.error('❌ Error in updateDisputedToCompleted:', error);
        throw error;
    }
}

/**
 * Validate and process dispute information for order completion
 */
async function validateAndProcessDispute(orderId, session) {
    try {
        // Check for active disputes
        const activeDispute = await Dispute.findOne({
            orderId: orderId,
            isDeleted: false,
            isDisable: false,
            status: { $in: [DISPUTE_STATUS.PENDING, DISPUTE_STATUS.UNDER_REVIEW] }
        }).session(session);

        if (activeDispute) {
            return {
                shouldSkip: true,
                reason: `Has active dispute (${activeDispute.status}) - ${activeDispute.disputeId}`,
                disputeData: null
            };
        }

        // Check for resolved disputes
        const resolvedDispute = await Dispute.findOne({
            orderId: orderId,
            isDeleted: false,
            isDisable: false,
            status: DISPUTE_STATUS.RESOLVED
        }).session(session);

        if (resolvedDispute) {
            // Validate dispute resolution
            if (!resolvedDispute.adminReview || !resolvedDispute.adminReview.decision) {
                return {
                    shouldSkip: true,
                    reason: `Has resolved dispute but missing admin review decision - ${resolvedDispute.disputeId}`,
                    disputeData: null
                };
            }

            // Validate dispute amount percentage
            const { decision, disputeAmountPercent = 0 } = resolvedDispute.adminReview;

            if (decision === DISPUTE_DECISION.BUYER && (disputeAmountPercent < 0 || disputeAmountPercent > 100)) {
                return {
                    shouldSkip: true,
                    reason: `Invalid dispute amount percentage (${disputeAmountPercent}%) - ${resolvedDispute.disputeId}`,
                    disputeData: null
                };
            }

            const disputeData = {
                decision: resolvedDispute.adminReview.decision,
                disputeAmountPercent: disputeAmountPercent,
                decisionNote: resolvedDispute.adminReview.decisionNote,
                disputeId: resolvedDispute.disputeId,
                resolvedAt: resolvedDispute.adminReview.resolvedAt,
                reviewedBy: resolvedDispute.adminReview.reviewedBy
            };

            console.log(`✅ Order ${orderId} had resolved dispute - Decision: ${disputeData.decision}, Amount%: ${disputeData.disputeAmountPercent}%`);

            return {
                shouldSkip: false,
                reason: null,
                disputeData: disputeData
            };
        }

        // No disputes found
        return {
            shouldSkip: false,
            reason: null,
            disputeData: null
        };

    } catch (error) {
        console.error(`Error validating dispute for order ${orderId}:`, error);
        return {
            shouldSkip: true,
            reason: `Dispute validation error: ${error.message}`,
            disputeData: null
        };
    }
}

/**
 * Additional validation before order completion
 */
async function validateOrderForCompletion(order, session) {
    try {
        // Check if seller still exists and is active
        const seller = await User.findById(order.sellerId).session(session);
        if (!seller || seller.isDeleted || seller.isDisable) {
            return {
                isValid: false,
                reason: 'Seller account is inactive or deleted'
            };
        }

        // Check if buyer still exists
        const buyer = await User.findById(order.userId).session(session);
        if (!buyer || buyer.isDeleted) {
            return {
                isValid: false,
                reason: 'Buyer account is deleted'
            };
        }

        // Validate order amounts
        if (!order.totalAmount || order.totalAmount <= 0) {
            return {
                isValid: false,
                reason: 'Invalid order total amount'
            };
        }

        // Check for existing payment to prevent duplicates
        const existingPayment = await WalletTnx.findOne({
            orderId: order._id,
            userId: order.sellerId,
            tnxType: TNX_TYPE.CREDIT,
            tnxStatus: PAYMENT_STATUS.COMPLETED
        }).session(session);

        if (existingPayment) {
            return {
                isValid: false,
                reason: 'Seller payment already processed'
            };
        }

        return {
            isValid: true,
            reason: null
        };

    } catch (error) {
        return {
            isValid: false,
            reason: `Validation error: ${error.message}`
        };
    }
}

/**
 * Enhanced seller payment processing with better error handling
 */
async function processSellerPaymentEnhanced(order, session, disputeInfo = null) {
    try {
        console.log(`💰 Processing payment for seller ${order.sellerId} for order ${order._id}`);

        // Get fee settings with validation
        const feeSettings = await FeeSetting.find({
            name: { $in: ["SERVICE_CHARGE", "TAX"] },
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).session(session);

        const serviceChargeSetting = feeSettings.find(f => f.name === "SERVICE_CHARGE");
        const taxSetting = feeSettings.find(f => f.name === "TAX");

        // Calculate amounts with enhanced validation
        const originalProductCost = Number(order.totalAmount) || 0;

        if (originalProductCost <= 0) {
            throw new Error(`Invalid product cost: ${originalProductCost}`);
        }

        let adjustedProductCost = originalProductCost;
        let disputeAdjustmentNote = '';

        // Apply dispute resolution if present
        if (disputeInfo) {
            const { decision, disputeAmountPercent = 0 } = disputeInfo;

            if (decision === DISPUTE_DECISION.SELLER) {
                adjustedProductCost = originalProductCost; // No deduction
                disputeAdjustmentNote = `Dispute resolved in seller favor. Seller receives full amount (100%).`;
            } else if (decision === DISPUTE_DECISION.BUYER) {
                if (disputeAmountPercent < 0 || disputeAmountPercent > 100) {
                    throw new Error(`Invalid dispute amount percentage: ${disputeAmountPercent}%`);
                }
                adjustedProductCost = originalProductCost * ((100 - disputeAmountPercent) / 100);
                disputeAdjustmentNote = `Dispute resolved in buyer favor. Seller receives ${100 - disputeAmountPercent}% of original amount. Buyer gets ${disputeAmountPercent}% refund.`;
            }

            console.log(`⚖️ Dispute adjustment: Original ฿${originalProductCost} → Adjusted ฿${adjustedProductCost.toFixed(2)} (${disputeAdjustmentNote})`);
        }

        // Calculate fees with validation
        let serviceCharge = 0;
        let serviceType = PRICING_TYPE.FIXED;
        let serviceChargeValue = 0;
        let taxAmount = 0;
        let taxType = PRICING_TYPE.FIXED;
        let taxValue = 0;

        if (serviceChargeSetting) {
            serviceType = serviceChargeSetting.type;
            serviceChargeValue = Number(serviceChargeSetting.value);
            if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
                serviceCharge = (adjustedProductCost * serviceChargeValue) / 100;
            } else {
                serviceCharge = serviceChargeValue;
            }
        }

        if (taxSetting) {
            taxType = taxSetting.type;
            taxValue = Number(taxSetting.value);
            if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
                taxAmount = (adjustedProductCost * taxValue) / 100;
            } else {
                taxAmount = taxValue;
            }
        }

        const netAmount = adjustedProductCost - serviceCharge - taxAmount;

        if (netAmount < 0) {
            throw new Error(`Calculated net amount is negative: ฿${netAmount.toFixed(2)}`);
        }

        console.log(`💳 Payment calculation: Original: ฿${originalProductCost}, Adjusted: ฿${adjustedProductCost.toFixed(2)}, Service: ฿${serviceCharge.toFixed(2)}, Tax: ฿${taxAmount.toFixed(2)}, Net: ฿${netAmount.toFixed(2)}`);

        // Create wallet transaction for seller with enhanced metadata
        const transactionNotes = disputeInfo
            ? `Auto-payment on order completion with dispute resolution. ${disputeAdjustmentNote}`
            : 'Auto-payment on order completion (Cron Job)';

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
            // Enhanced metadata
            metadata: {
                cronProcessed: true,
                processedAt: new Date(),
                processingDay: PROCESSING_DAY_LIMIT,
                originalAmount: originalProductCost,
                ...(disputeInfo && {
                    disputeInfo: {
                        disputeId: disputeInfo.disputeId,
                        decision: disputeInfo.decision,
                        disputeAmountPercent: disputeInfo.disputeAmountPercent,
                        resolvedAt: disputeInfo.resolvedAt,
                        reviewedBy: disputeInfo.reviewedBy
                    }
                })
            }
        });

        await sellerWalletTnx.save({ session });

        // Update seller wallet balance
        await User.findByIdAndUpdate(
            order.sellerId,
            {
                $inc: { walletBalance: netAmount }
            },
            { session }
        );

        // Track platform revenue
        await trackCompletionRevenue(order, serviceCharge, taxAmount, serviceType, taxType, session, serviceChargeValue, taxValue);

        console.log(`✅ Seller payment processed: ฿${netAmount.toFixed(2)} credited to wallet${disputeInfo ? ' (dispute-adjusted)' : ''}`);

        return { success: true, netAmount, disputeAdjusted: !!disputeInfo };

    } catch (error) {
        console.error('❌ Error processing seller payment:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Track platform revenue when order is completed
 */
async function trackCompletionRevenue(order, serviceCharge, taxAmount, serviceType, taxType, session, serviceChargeValue = 0, taxValue = 0) {
    try {
        const revenueEntries = [];

        // Track Service Charge
        if (serviceCharge > 0) {
            revenueEntries.push({
                orderId: order._id,
                revenueType: 'SERVICE_CHARGE',
                amount: serviceCharge,
                calculationType: serviceType,
                calculationValue: serviceChargeValue, // The actual percentage or fixed value used
                baseAmount: order.totalAmount,
                status: 'COMPLETED',
                completedAt: new Date(),
                description: `Service charge for completed order ${order._id}`,
                metadata: {
                    orderTotal: order.totalAmount,
                    sellerId: order.sellerId,
                    cronProcessed: true
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
                calculationValue: taxValue, // The actual percentage or fixed value used
                baseAmount: order.totalAmount,
                status: 'COMPLETED',
                completedAt: new Date(),
                description: `Tax for completed order ${order._id}`,
                metadata: {
                    orderTotal: order.totalAmount,
                    sellerId: order.sellerId,
                    cronProcessed: true
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
                actionBy: 'system',
                cronProcessed: true,
                processingDay: PROCESSING_DAY_LIMIT
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
            ? `Your order has been automatically completed after ${PROCESSING_DAY_LIMIT} days. A dispute was resolved in ${disputeInfo.decision === DISPUTE_DECISION.BUYER ? 'your' : 'seller'} favor. Thank you for your purchase!`
            : `Your order has been automatically completed after ${PROCESSING_DAY_LIMIT} days. Thank you for your purchase!`;

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
                    cronProcessed: true,
                    processingDay: PROCESSING_DAY_LIMIT,
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
                    cronProcessed: true,
                    processingDay: PROCESSING_DAY_LIMIT,
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

/**
 * Send notifications when a disputed order is completed after dispute resolution
 */
async function sendDisputeResolutionCompletionNotifications(order, disputeInfo) {
    try {
        console.log(`📧 Sending dispute resolution completion notifications for order ${order._id}`);

        // Buyer notification based on dispute decision
        let buyerTitle = "Disputed Order Completed";
        let buyerMessage = "";

        if (disputeInfo.decision === DISPUTE_DECISION.BUYER) {
            buyerTitle = "Dispute Resolved in Your Favor - Order Completed";
            buyerMessage = `Your disputed order has been completed with the dispute resolved in your favor. You received a ${disputeInfo.disputeAmountPercent}% refund of the order value. ${disputeInfo.decisionNote || ''}`;
        } else {
            buyerTitle = "Dispute Resolved - Order Completed";
            buyerMessage = `Your disputed order has been completed with the dispute resolved in the seller's favor. The full payment has been released to the seller. ${disputeInfo.decisionNote || ''}`;
        }

        // Seller notification based on dispute decision
        let sellerTitle = "Disputed Order Completed";
        let sellerMessage = "";
        let netAmountPaid = 0;

        if (disputeInfo.decision === DISPUTE_DECISION.SELLER) {
            sellerTitle = "Dispute Resolved in Your Favor - Payment Received!";
            sellerMessage = `Your disputed order has been completed with the dispute resolved in your favor. Full payment has been credited to your wallet. ${disputeInfo.decisionNote || ''}`;
            netAmountPaid = order.totalAmount;
        } else {
            sellerTitle = "Disputed Order Completed - Partial Payment";
            const sellerPercentage = 100 - disputeInfo.disputeAmountPercent;
            sellerMessage = `Your disputed order has been completed with the dispute resolved in the buyer's favor. ${sellerPercentage}% of the order value (₿${(order.totalAmount * sellerPercentage / 100).toFixed(2)}) has been credited to your wallet. ${disputeInfo.decisionNote || ''}`;
            netAmountPaid = order.totalAmount * sellerPercentage / 100;
        }

        const notifications = [
            // Notification to buyer
            {
                recipientId: order.userId,
                userId: order.sellerId,
                orderId: order._id,
                productId: order.items[0]?.productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: buyerTitle,
                message: buyerMessage,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    itemCount: order.items?.length || 0,
                    totalAmount: order.totalAmount,
                    amount: order.grandTotal,
                    oldStatus: ORDER_STATUS.DISPUTE,
                    newStatus: ORDER_STATUS.COMPLETED,
                    paymentMethod: order.paymentMethod,
                    paymentId: order.paymentId,
                    productId: order.items[0]?.productId,
                    productTitle: order.items[0]?.productTitle,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    status: ORDER_STATUS.COMPLETED,
                    actionBy: 'system',
                    processedBy: 'dispute-resolution-auto-completion',
                    autoCompleted: true,
                    cronProcessed: true,
                    disputeId: disputeInfo.disputeId,
                    disputeStatus: 'RESOLVED',
                    disputeDecision: disputeInfo.decision,
                    disputeAmountPercent: disputeInfo.disputeAmountPercent,
                    refundAmount: disputeInfo.decision === DISPUTE_DECISION.BUYER ?
                        (order.grandTotal * disputeInfo.disputeAmountPercent / 100) : 0,
                    resolvedAt: disputeInfo.resolvedAt,
                    reviewedBy: disputeInfo.reviewedBy,
                    decisionNote: disputeInfo.decisionNote
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
                    oldStatus: ORDER_STATUS.DISPUTE,
                    newStatus: ORDER_STATUS.COMPLETED,
                    paymentMethod: order.paymentMethod,
                    paymentId: order.paymentId,
                    productId: order.items[0]?.productId,
                    productTitle: order.items[0]?.productTitle,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    status: ORDER_STATUS.COMPLETED,
                    actionBy: 'system',
                    processedBy: 'dispute-resolution-auto-completion',
                    paymentProcessed: true,
                    cronProcessed: true,
                    disputeId: disputeInfo.disputeId,
                    disputeStatus: 'RESOLVED',
                    disputeDecision: disputeInfo.decision,
                    disputeAmountPercent: disputeInfo.disputeAmountPercent,
                    netAmountPaid: netAmountPaid,
                    refundAmount: disputeInfo.decision === DISPUTE_DECISION.BUYER ?
                        (order.grandTotal * disputeInfo.disputeAmountPercent / 100) : 0,
                    resolvedAt: disputeInfo.resolvedAt,
                    reviewedBy: disputeInfo.reviewedBy,
                    decisionNote: disputeInfo.decisionNote
                }),
                redirectUrl: `/wallet/transactions`
            }
        ];

        await saveNotification(notifications);
        console.log(`✅ Dispute resolution completion notifications sent for order ${order._id}`);
    } catch (error) {
        console.error('❌ Error sending dispute resolution completion notifications:', error);
    }
}

/**
 * Send cron job summary notification to admin
 */
async function sendCronSummaryNotification(stats, duration) {
    try {
        // This could be enhanced to send emails to admins
        console.log('📧 Sending cron summary notification (placeholder for email service)');

        // You can implement actual email sending here
        // const emailService = require('../../../services/emailService');
        // await emailService.sendAdminNotification({
        //     subject: 'Order Status Update Cron - Summary',
        //     body: `
        //         Cron Job Summary:
        //         - Duration: ${duration}ms
        //         - Orders processed: ${stats.shippedToDelivered + stats.deliveredToCompleted}
        //         - Payments processed: ${stats.paymentsProcessed}
        //         - Disputes handled: ${stats.disputesHandled}
        //         - Errors: ${stats.errors.length}
        //     `
        // });

    } catch (error) {
        console.error('❌ Error sending cron summary notification:', error);
    }
}

/**
 * Send cron error notification to admin
 */
async function sendCronErrorNotification(error) {
    try {
        console.log('🚨 Sending cron error notification (placeholder for email service)');

        // You can implement actual email sending here
        // const emailService = require('../../../services/emailService');
        // await emailService.sendAdminAlert({
        //     subject: 'URGENT: Order Status Update Cron Failed',
        //     body: `
        //         Critical Error in Order Status Update Cron:
        //         
        //         Error: ${error.message}
        //         Stack: ${error.stack}
        //         Time: ${new Date().toISOString()}
        //         
        //         Please investigate immediately.
        //     `
        // });

    } catch (notificationError) {
        console.error('❌ Error sending cron error notification:', notificationError);
    }
}

/**
 * Manual trigger endpoint for testing (optional)
 */
if (typeof global.app !== 'undefined') {
    global.app.post('/cron/trigger/order-status-update', async (req, res) => {
        try {
            console.log('🔄 Manual trigger for Order Status Update Cron');

            // Add authentication check here
            // if (!req.user || req.user.role !== 'admin') {
            //     return res.status(403).json({ error: 'Unauthorized' });
            // }

            const session = await mongoose.startSession();
            session.startTransaction();

            try {
                await validateSystemState();

                const now = moment();
                const cutoffDate = now.clone().subtract(PROCESSING_DAY_LIMIT, 'days');

                const shippedStats = await updateShippedToDelivered(cutoffDate, session);
                const completedStats = await updateDeliveredToCompleted(cutoffDate, session);
                const confirmReceiptStats = await updateConfirmReceiptToCompleted(now.clone().subtract(CONFIRM_RECEIPT_TO_COMPLETED_DAY_LIMIT, 'days'), session);
                const disputedStats = await updateDisputedToCompleted(session);

                await session.commitTransaction();

                res.json({
                    success: true,
                    message: 'Manual cron trigger completed',
                    stats: {
                        shippedToDelivered: shippedStats.updated,
                        deliveredToCompleted: completedStats.updated,
                        confirmReceiptToCompleted: confirmReceiptStats.updated,
                        disputedToCompleted: disputedStats.updated,
                        paymentsProcessed: completedStats.paymentsProcessed + confirmReceiptStats.paymentsProcessed + disputedStats.paymentsProcessed,
                        disputesHandled: completedStats.disputesHandled + confirmReceiptStats.disputesHandled + disputedStats.disputesHandled,
                        errors: [...shippedStats.errors, ...completedStats.errors, ...confirmReceiptStats.errors, ...disputedStats.errors]
                    }
                });

            } catch (error) {
                await session.abortTransaction();
                throw error;
            } finally {
                session.endSession();
            }

        } catch (error) {
            console.error('❌ Manual trigger error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}

console.log('📅 Order Status Update Cron Job initialized with enhanced monitoring and dispute handling.');
console.log(`⚙️ Configuration: ${PROCESSING_DAY_LIMIT} days processing limit, Schedule: ${CRON_SCHEDULE}`);
console.log('🔍 Health check available at: /cron/health/order-status-update');
console.log('🧪 Manual trigger available at: POST /cron/trigger/order-status-update'); 