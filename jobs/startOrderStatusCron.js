#!/usr/bin/env node

/**
 * Startup script for Order Status Update Cron Job
 * This script starts the automated order status update process
 * 
 * Usage:
 * node jobs/startOrderStatusCron.js
 * 
 * Or add to package.json scripts:
 * "cron:orders": "node jobs/startOrderStatusCron.js"
 */

console.log('🚀 Starting Order Status Update Cron Job...');
console.log('📅 Schedule: Daily at midnight (0 0 * * *)');
console.log('🔄 Functions:');
console.log('   - Update SHIPPED → DELIVERED after 3 days');
console.log('   - Update DELIVERED → COMPLETED after 3 days (with dispute checking)');
console.log('   - Process seller payments on completion');
console.log('');

// Start the cron job
require('./Scheduled/crons/orderStatusUpdateCron');

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⏹️  Order Status Update Cron Job stopped gracefully');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n⏹️  Order Status Update Cron Job terminated gracefully');
    process.exit(0);
});

// Keep the process alive
console.log('✅ Order Status Update Cron Job is now running...');
console.log('   Press Ctrl+C to stop'); 