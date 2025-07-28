#!/usr/bin/env node

/**
 * Notification Testing Script
 * Usage: node scripts/testNotification.js <userId> [notificationType]
 * 
 * Examples:
 * - node scripts/testNotification.js 507f1f77bcf86cd799439011
 * - node scripts/testNotification.js 507f1f77bcf86cd799439011 user
 * - node scripts/testNotification.js 507f1f77bcf86cd799439011 order
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { User, Notification } = require('../db');
const { saveNotification } = require('../routes/services/serviceNotification');
const { sendFirebaseNotification } = require('../utils/firebasePushNotification');
const { NOTIFICATION_TYPES } = require('../utils/Role');
const { SUCCESS } = require('../utils/constants');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    header: (msg) => console.log(`${colors.cyan}${colors.bright}🚀 ${msg}${colors.reset}`),
    divider: () => console.log(`${colors.magenta}${'='.repeat(60)}${colors.reset}`)
};

// Sample notification data for different types
const notificationTemplates = {
    user: {
        type: NOTIFICATION_TYPES.USER,
        title: "Welcome to Kudsun! 👋",
        message: "Thanks for joining our community. Start exploring amazing products!",
        meta: {
            welcomeBonus: true,
            onboardingStep: 1
        }
    },
    chat: {
        type: NOTIFICATION_TYPES.CHAT,
        title: "New Message 💬",
        message: "You have received a new message from a buyer interested in your product.",
        meta: {
            messagePreview: "Hi, is this item still available?"
        }
    },
    order: {
        type: NOTIFICATION_TYPES.ORDER,
        title: "Order Confirmed 📦",
        message: "Your order #12345 has been confirmed and will be shipped soon!",
        meta: {
            orderNumber: "12345",
            estimatedDelivery: "3-5 business days"
        }
    },
    deal_chat: {
        type: NOTIFICATION_TYPES.DEAL_CHAT,
        title: "Deal Discussion 💰",
        message: "Someone is interested in negotiating the price for your item.",
        meta: {
            originalPrice: 299,
            proposedPrice: 250
        }
    },
    system: {
        type: NOTIFICATION_TYPES.SYSTEM,
        title: "System Maintenance 🔧",
        message: "Scheduled maintenance will occur tonight from 2:00 AM to 4:00 AM.",
        meta: {
            maintenanceType: "database_optimization",
            affectedServices: ["search", "notifications"]
        }
    },
    activity: {
        type: NOTIFICATION_TYPES.ACTIVITY,
        title: "Someone liked your product! ❤️",
        message: "Your iPhone 13 Pro listing received a new like.",
        activityType: "like",
        meta: {
            productName: "iPhone 13 Pro",
            totalLikes: 15
        }
    },
    alert: {
        type: NOTIFICATION_TYPES.ALERT,
        title: "Price Alert 🔔",
        message: "The iPhone 14 you're watching has dropped in price!",
        meta: {
            originalPrice: 999,
            newPrice: 899,
            priceDropPercentage: 10
        }
    }
};

/**
 * Validate if user exists in database
 */
async function validateUser(userId) {
    try {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error('Invalid user ID format');
        }

        const user = await User.findById(userId).select('userName email fcmToken notification');
        if (!user) {
            throw new Error('User not found');
        }

        log.info(`Found user: ${user.userName || user.email || 'Unknown'}`);
        log.info(`FCM Token: ${user.fcmToken ? '✅ Available' : '❌ Not set'}`);
        log.info(`Notifications enabled: ${user.notification !== false ? '✅ Yes' : '❌ No'}`);
        
        return user;
    } catch (error) {
        throw error;
    }
}

/**
 * Test Firebase push notification directly
 */
async function testFirebasePushNotification(user, notificationData) {
    try {
        log.header('Testing Firebase Push Notification');
        
        if (!user.fcmToken) {
            log.warning('No FCM token available for this user. Push notification will be skipped.');
            return false;
        }

        await sendFirebaseNotification({
            token: user.fcmToken,
            title: notificationData.title,
            body: notificationData.message,
            imageUrl: notificationData.imageUrl || '',
            ...notificationData.meta
        });

        log.success('Firebase push notification sent successfully!');
        return true;
    } catch (error) {
        log.error(`Firebase push notification failed: ${error.message}`);
        return false;
    }
}

/**
 * Test notification via service (includes queue processing)
 */
async function testNotificationService(userId, notificationData) {
    try {
        log.header('Testing Notification Service (with Queue)');

        const payload = [{
            userId: userId,
            recipientId: userId,
            ...notificationData
        }];

        const result = await saveNotification(payload);
        log.info('saveNotification result:', result);
        if (result && result.status === SUCCESS) {
            log.success('Notification added to queue successfully!');
            log.info('The notification will be processed by the background queue worker.');
            return true;
        } else {
            log.error(`Notification service failed. Full result: ${JSON.stringify(result)}`);
            return false;
        }
    } catch (error) {
        log.error(`Notification service failed: ${error.message}`);
        return false;
    }
}

/**
 * Test direct database insertion
 */
async function testDirectDatabaseInsertion(userId, notificationData) {
    try {
        log.header('Testing Direct Database Insertion');

        const notification = await Notification.create({
            recipientId: userId,
            userId: userId,
            ...notificationData
        });

        log.success(`Notification saved to database with ID: ${notification._id}`);
        return notification;
    } catch (error) {
        log.error(`Database insertion failed: ${error.message}`);
        return null;
    }
}

/**
 * Get notification statistics for user
 */
async function getNotificationStats(userId) {
    try {
        log.header('Notification Statistics');
        const recipientObjectId = new mongoose.Types.ObjectId(userId);
        const [total, unread, byType] = await Promise.all([
            Notification.countDocuments({ recipientId: recipientObjectId }),
            Notification.countDocuments({ recipientId: recipientObjectId, read: false }),
            Notification.aggregate([
                { $match: { recipientId: recipientObjectId } },
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);

        log.info(`Total notifications: ${total}`);
        log.info(`Unread notifications: ${unread}`);
        
        if (byType.length > 0) {
            log.info('Notifications by type:');
            byType.forEach(stat => {
                console.log(`  ${stat._id}: ${stat.count}`);
            });
        }

        return { total, unread, byType };
    } catch (error) {
        log.error(`Failed to get notification stats: ${error.message}`);
        return null;
    }
}

/**
 * Show available notification types
 */
function showAvailableTypes() {
    log.header('Available Notification Types');
    console.log(Object.values(NOTIFICATION_TYPES).map(type => `  • ${type}`).join('\n'));
    log.divider();
}

/**
 * Main testing function
 */
async function runNotificationTest(userId, testType = 'user') {
    try {
        log.divider();
        log.header(`Kudsun Notification Testing Script`);
        log.info(`Testing for User ID: ${userId}`);
        log.info(`Notification Type: ${testType}`);
        log.divider();

        // Validate user
        const user = await validateUser(userId);
        
        // Get notification template
        const notificationData = notificationTemplates[testType];
        if (!notificationData) {
            log.error(`Invalid notification type: ${testType}`);
            showAvailableTypes();
            return;
        }

        log.info(`Testing notification: "${notificationData.title}"`);
        log.divider();

        // Test 1: Firebase Push Notification
        const pushSuccess = await testFirebasePushNotification(user, notificationData);
        
        // Test 2: Notification Service (Queue)
        const serviceSuccess = await testNotificationService(userId, notificationData);
        
        // Test 3: Direct Database Insertion
        const dbNotification = await testDirectDatabaseInsertion(userId, notificationData);
        
        // Test 4: Get Statistics
        await getNotificationStats(userId);

        log.divider();
        log.header('Test Summary');
        log.info(`Firebase Push: ${pushSuccess ? '✅' : '❌'}`);
        log.info(`Queue Service: ${serviceSuccess ? '✅' : '❌'}`);
        log.info(`Database Insert: ${dbNotification ? '✅' : '❌'}`);
        log.divider();

        // Wait a moment for queue processing
        log.info('Waiting 3 seconds for queue processing...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Final stats
        await getNotificationStats(userId);

    } catch (error) {
        log.error(`Test failed: ${error.message}`);
        console.error(error);
    }
}

/**
 * Script entry point
 */
async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            log.error('Usage: node scripts/testNotification.js <userId> [notificationType]');
            log.info('Example: node scripts/testNotification.js 507f1f77bcf86cd799439011 user');
            showAvailableTypes();
            process.exit(1);
        }

        const userId = args[0];
        const notificationType = args[1] || 'user';

        // Connect to database (already connected via db/index.js import)
        log.info('Database connection ready');

        // Run the test
        await runNotificationTest(userId, notificationType);

    } catch (error) {
        log.error(`Script failed: ${error.message}`);
        console.error(error);
    } finally {
        // Close database connection
        await mongoose.connection.close();
        log.info('Database connection closed');
        process.exit(0);
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    log.warning('Received SIGINT, closing database connection...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log.warning('Received SIGTERM, closing database connection...');
    await mongoose.connection.close();
    process.exit(0);
});

// Run the script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    runNotificationTest,
    validateUser,
    testFirebasePushNotification,
    testNotificationService,
    testDirectDatabaseInsertion,
    notificationTemplates
}; 