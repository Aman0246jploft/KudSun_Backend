#!/usr/bin/env node

/**
 * Manual Test Script for Order Status Update Cron Job
 *
 * This script allows administrators to manually trigger and test
 * the order status update cron job functionality.
 *
 * Usage:
 *   node scripts/testOrderStatusCron.js [options]
 *
 * Options:
 *   --dry-run         Run without making actual changes
 *   --days=N          Override the processing day limit
 *   --limit=N         Limit number of orders to process
 *   --verbose         Enable verbose logging
 *   --skip-validation Skip system validation checks
 *
 * Examples:
 *   node scripts/testOrderStatusCron.js --dry-run --verbose
 *   node scripts/testOrderStatusCron.js --days=1 --limit=10
 */

require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment");

// Import required modules
const {
  Order,
  OrderStatusHistory,
  Dispute,
  FeeSetting,
  WalletTnx,
  User,
  PlatformRevenue,
} = require("../db");

const {
  ORDER_STATUS,
  PAYMENT_STATUS,
  DISPUTE_STATUS,
  PRICING_TYPE,
  TNX_TYPE,
  DISPUTE_DECISION,
} = require("../utils/Role");

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes("--dry-run"),
  verbose: args.includes("--verbose"),
  skipValidation: args.includes("--skip-validation"),
  days:
    parseInt(args.find((arg) => arg.startsWith("--days="))?.split("=")[1]) ||
    parseInt(process.env.DAY) ||
    3,
  limit:
    parseInt(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1]) ||
    100,
};

console.log("🧪 Order Status Update Cron Job Test Script");
console.log("===============================================");
console.log(`Options: ${JSON.stringify(options, null, 2)}`);
console.log("");

// Test statistics
let testStats = {
  startTime: new Date(),
  ordersChecked: 0,
  shippedToDelivered: 0,
  deliveredToCompleted: 0,
  paymentsProcessed: 0,
  disputesHandled: 0,
  errors: [],
  warnings: [],
};

/**
 * Main test function
 */
async function runTest() {
  try {
    // Connect to database
    console.log("🔌 Connecting to database...");
    await mongoose.connect(process.env.DB_STRING, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Database connected successfully");

    // Run system validation
    if (!options.skipValidation) {
      console.log("🔍 Running system validation...");
      await validateSystemState();
      console.log("✅ System validation passed");
    }

    // Calculate cutoff date
    const cutoffDate = moment().subtract(options.days, "days");
    console.log(
      `📅 Processing orders older than: ${cutoffDate.format(
        "YYYY-MM-DD HH:mm:ss"
      )}`
    );

    if (options.dryRun) {
      console.log("🔍 DRY RUN MODE - No actual changes will be made");
    }

    console.log("");

    // Test SHIPPED to DELIVERED updates
    console.log("📦 Testing SHIPPED → DELIVERED updates...");
    await testShippedToDelivered(cutoffDate);

    console.log("");

    // Test DELIVERED to COMPLETED updates
    console.log("🎯 Testing DELIVERED → COMPLETED updates...");
    await testDeliveredToCompleted(cutoffDate);

    // Print summary
    printTestSummary();
  } catch (error) {
    console.error("❌ Test failed with error:", error);
    testStats.errors.push(`Critical error: ${error.message}`);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  }
}

/**
 * Validate system state
 */
async function validateSystemState() {
  const requiredFeeSettings = ["SERVICE_CHARGE", "TAX", "WITHDRAWAL_FEE"];
  const feeSettings = await FeeSetting.find({
    name: { $in: requiredFeeSettings },
    isActive: true,
    isDisable: false,
    isDeleted: false,
  });

  const missingSettings = requiredFeeSettings.filter(
    (setting) => !feeSettings.find((f) => f.name === setting)
  );

  if (missingSettings.length > 0) {
    throw new Error(
      `Missing required fee settings: ${missingSettings.join(", ")}`
    );
  }

  if (options.verbose) {
    console.log("   Fee settings validation passed");
    feeSettings.forEach((setting) => {
      console.log(`   - ${setting.name}: ${setting.value} (${setting.type})`);
    });
  }
}

/**
 * Test SHIPPED to DELIVERED updates
 */
async function testShippedToDelivered(cutoffDate) {
  try {
    const shippedOrders = await Order.find({
      status: ORDER_STATUS.SHIPPED,
      paymentStatus: PAYMENT_STATUS.COMPLETED,
      isDeleted: false,
      isDisable: false,
    })
      .populate("sellerId userId", "userName email")
      .limit(options.limit);

    console.log(`   Found ${shippedOrders.length} shipped orders to check`);
    testStats.ordersChecked += shippedOrders.length;

    for (const order of shippedOrders) {
      try {
        const shippedHistory = await OrderStatusHistory.findOne({
          orderId: order._id,
          newStatus: ORDER_STATUS.SHIPPED,
        }).sort({ changedAt: -1 });

        if (!shippedHistory) {
          testStats.warnings.push(`No shipping history for order ${order._id}`);
          continue;
        }

        const shippedDate = moment(shippedHistory.changedAt);
        const daysSinceShipped = moment().diff(shippedDate, "days");

        if (options.verbose) {
          console.log(
            `   Order ${order._id}: shipped ${daysSinceShipped} days ago`
          );
        }

        if (shippedDate.isBefore(cutoffDate)) {
          // Check for active disputes
          const activeDispute = await Dispute.findOne({
            orderId: order._id,
            isDeleted: false,
            isDisable: false,
            status: {
              $in: [DISPUTE_STATUS.PENDING, DISPUTE_STATUS.UNDER_REVIEW],
            },
          });

          if (activeDispute) {
            testStats.warnings.push(
              `Order ${order._id} has active dispute, skipping`
            );
            continue;
          }

          console.log(`   ✅ Would update order ${order._id} to DELIVERED`);
          testStats.shippedToDelivered++;

          if (!options.dryRun) {
            await Order.findByIdAndUpdate(order._id, {
              status: ORDER_STATUS.DELIVERED,
              updatedAt: new Date(),
            });

            await OrderStatusHistory.create({
              orderId: order._id,
              oldStatus: ORDER_STATUS.SHIPPED,
              newStatus: ORDER_STATUS.DELIVERED,
              note: `Auto-updated to delivered after ${options.days} days (Test Script)`,
              changedAt: new Date(),
            });
          }
        }
      } catch (orderError) {
        const errorMsg = `Error processing shipped order ${order._id}: ${orderError.message}`;
        testStats.errors.push(errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }
  } catch (error) {
    console.error("❌ Error in testShippedToDelivered:", error);
    testStats.errors.push(`SHIPPED → DELIVERED test failed: ${error.message}`);
  }
}

/**
 * Test DELIVERED to COMPLETED updates
 */
async function testDeliveredToCompleted(cutoffDate) {
  try {
    const deliveredOrders = await Order.find({
      status: ORDER_STATUS.DELIVERED,
      paymentStatus: PAYMENT_STATUS.COMPLETED,
      isDeleted: false,
      isDisable: false,
    })
      .populate("sellerId userId", "userName email")
      .limit(options.limit);

    console.log(`   Found ${deliveredOrders.length} delivered orders to check`);

    for (const order of deliveredOrders) {
      try {
        const deliveredHistory = await OrderStatusHistory.findOne({
          orderId: order._id,
          newStatus: ORDER_STATUS.DELIVERED,
        }).sort({ changedAt: -1 });

        if (!deliveredHistory) {
          testStats.warnings.push(`No delivery history for order ${order._id}`);
          continue;
        }

        const deliveredDate = moment(deliveredHistory.changedAt);
        const daysSinceDelivered = moment().diff(deliveredDate, "days");

        if (options.verbose) {
          console.log(
            `   Order ${order._id}: delivered ${daysSinceDelivered} days ago`
          );
        }

        if (deliveredDate.isBefore(cutoffDate)) {
          // Check for disputes
          const disputeInfo = await checkDisputeStatus(order._id);

          if (disputeInfo.shouldSkip) {
            testStats.warnings.push(
              `Order ${order._id}: ${disputeInfo.reason}`
            );
            continue;
          }

          // Check for existing payment
          const existingPayment = await WalletTnx.findOne({
            orderId: order._id,
            userId: order.sellerId,
            tnxType: TNX_TYPE.CREDIT,
            tnxStatus: PAYMENT_STATUS.COMPLETED,
          });

          if (existingPayment) {
            testStats.warnings.push(`Order ${order._id}: Seller already paid`);
            continue;
          }

          console.log(
            `   ✅ Would complete order ${order._id} and process payment`
          );
          if (disputeInfo.disputeData) {
            console.log(
              `      - Dispute resolved: ${disputeInfo.disputeData.decision} favour`
            );
            testStats.disputesHandled++;
          }

          testStats.deliveredToCompleted++;

          if (!options.dryRun) {
            await Order.findByIdAndUpdate(order._id, {
              status: ORDER_STATUS.COMPLETED,
              updatedAt: new Date(),
            });

            await OrderStatusHistory.create({
              orderId: order._id,
              oldStatus: ORDER_STATUS.DELIVERED,
              newStatus: ORDER_STATUS.COMPLETED,
              note: `Auto-completed after ${options.days} days (Test Script)`,
              changedAt: new Date(),
            });

            // Calculate and process payment
            const paymentResult = await calculateSellerPayment(
              order,
              disputeInfo.disputeData
            );
            if (paymentResult.success) {
              testStats.paymentsProcessed++;
              console.log(
                `      - Payment processed: ฿${paymentResult.netAmount.toFixed(
                  2
                )}`
              );
            } else {
              testStats.errors.push(
                `Payment calculation failed for order ${order._id}: ${paymentResult.error}`
              );
            }
          }
        }
      } catch (orderError) {
        const errorMsg = `Error processing delivered order ${order._id}: ${orderError.message}`;
        testStats.errors.push(errorMsg);
        console.error(`   ❌ ${errorMsg}`);
      }
    }
  } catch (error) {
    console.error("❌ Error in testDeliveredToCompleted:", error);
    testStats.errors.push(
      `DELIVERED → COMPLETED test failed: ${error.message}`
    );
  }
}

/**
 * Check dispute status for an order
 */
async function checkDisputeStatus(orderId) {
  try {
    const activeDispute = await Dispute.findOne({
      orderId: orderId,
      isDeleted: false,
      isDisable: false,
      status: { $in: [DISPUTE_STATUS.PENDING, DISPUTE_STATUS.UNDER_REVIEW] },
    });

    if (activeDispute) {
      return {
        shouldSkip: true,
        reason: `Has active dispute (${activeDispute.status})`,
        disputeData: null,
      };
    }

    const resolvedDispute = await Dispute.findOne({
      orderId: orderId,
      isDeleted: false,
      isDisable: false,
      status: DISPUTE_STATUS.RESOLVED,
    });

    if (resolvedDispute) {
      if (
        !resolvedDispute.adminReview ||
        !resolvedDispute.adminReview.decision
      ) {
        return {
          shouldSkip: true,
          reason: "Has resolved dispute but missing admin decision",
          disputeData: null,
        };
      }

      return {
        shouldSkip: false,
        reason: null,
        disputeData: {
          decision: resolvedDispute.adminReview.decision,
          disputeAmountPercent:
            resolvedDispute.adminReview.disputeAmountPercent || 0,
          decisionNote: resolvedDispute.adminReview.decisionNote,
          disputeId: resolvedDispute.disputeId,
        },
      };
    }

    return {
      shouldSkip: false,
      reason: null,
      disputeData: null,
    };
  } catch (error) {
    return {
      shouldSkip: true,
      reason: `Dispute validation error: ${error.message}`,
      disputeData: null,
    };
  }
}

/**
 * Calculate seller payment (simplified version for testing)
 */
async function calculateSellerPayment(order, disputeInfo = null) {
  try {
    const feeSettings = await FeeSetting.find({
      name: { $in: ["SERVICE_CHARGE", "TAX"] },
      isActive: true,
      isDisable: false,
      isDeleted: false,
    });

    const serviceChargeSetting = feeSettings.find(
      (f) => f.name === "SERVICE_CHARGE"
    );
    const taxSetting = feeSettings.find((f) => f.name === "TAX");

    const originalProductCost = Number(order.totalAmount) || 0;
    let adjustedProductCost = originalProductCost;

    // Apply dispute resolution
    if (disputeInfo) {
      if (disputeInfo.decision === DISPUTE_DECISION.BUYER) {
        adjustedProductCost =
          originalProductCost *
          ((100 - disputeInfo.disputeAmountPercent) / 100);
      }
    }

    // Calculate fees
    let serviceCharge = 0;
    let taxAmount = 0;

    if (serviceChargeSetting) {
      if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
        serviceCharge =
          (adjustedProductCost * Number(serviceChargeSetting.value)) / 100;
      } else {
        serviceCharge = Number(serviceChargeSetting.value);
      }
    }

    if (taxSetting) {
      if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
        taxAmount = (adjustedProductCost * Number(taxSetting.value)) / 100;
      } else {
        taxAmount = Number(taxSetting.value);
      }
    }

    const netAmount = adjustedProductCost - serviceCharge - taxAmount;

    if (options.verbose) {
      console.log(
        `      Payment breakdown: Original: ฿${originalProductCost}, Adjusted: ฿${adjustedProductCost.toFixed(
          2
        )}, Net: ฿${netAmount.toFixed(2)}`
      );
    }

    return {
      success: true,
      netAmount,
      originalAmount: originalProductCost,
      adjustedAmount: adjustedProductCost,
      serviceCharge,
      taxAmount,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Print test summary
 */
function printTestSummary() {
  const endTime = new Date();
  const duration = endTime - testStats.startTime;

  console.log("");
  console.log("📊 TEST SUMMARY");
  console.log("===============");
  console.log(`Duration: ${duration}ms`);
  console.log(`Orders Checked: ${testStats.ordersChecked}`);
  console.log(`SHIPPED → DELIVERED: ${testStats.shippedToDelivered}`);
  console.log(`DELIVERED → COMPLETED: ${testStats.deliveredToCompleted}`);
  console.log(`Payments Processed: ${testStats.paymentsProcessed}`);
  console.log(`Disputes Handled: ${testStats.disputesHandled}`);
  console.log(`Errors: ${testStats.errors.length}`);
  console.log(`Warnings: ${testStats.warnings.length}`);

  if (testStats.errors.length > 0) {
    console.log("");
    console.log("❌ ERRORS:");
    testStats.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error}`);
    });
  }

  if (testStats.warnings.length > 0 && options.verbose) {
    console.log("");
    console.log("⚠️ WARNINGS:");
    testStats.warnings.forEach((warning, index) => {
      console.log(`   ${index + 1}. ${warning}`);
    });
  }

  if (options.dryRun) {
    console.log("");
    console.log("🔍 This was a DRY RUN - no actual changes were made");
  }

  const success = testStats.errors.length === 0;
  console.log("");
  console.log(
    success
      ? "✅ Test completed successfully!"
      : "❌ Test completed with errors!"
  );
}

// Run the test
runTest().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
