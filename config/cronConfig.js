/**
 * Configuration for Order Status Update Cron Job
 * 
 * This file contains all the configuration options for the enhanced
 * order status update cron job with dispute handling.
 */

module.exports = {
    // Number of days to wait before auto-updating order statuses
    PROCESSING_DAY_LIMIT: parseInt(process.env.DAY) || 3,
    
    // Cron schedule (default: daily at midnight)
    // Format: second minute hour day-of-month month day-of-week
    // Examples:
    //   '0 0 * * *' - Daily at midnight
    //   '0 0 */2 * *' - Every 2 days at midnight  
    //   '0 2 * * *' - Daily at 2 AM
    //   '*/5 * * * *' - Every 5 minutes (for testing)
    CRON_SCHEDULE: process.env.CRON_SCHEDULE || '0 0 * * *',
    
    // Whether to send email notifications to admins
    ENABLE_EMAIL_NOTIFICATIONS: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
    
    // Email settings (if notifications are enabled)
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@example.com',
    FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@example.com',
    
    // Database connection settings
    MONGO_URI: process.env.DB_STRING,
    
    // Logging configuration
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_TO_FILE: process.env.LOG_TO_FILE === 'true',
    LOG_FILE_PATH: process.env.LOG_FILE_PATH || './logs/cron.log',
    
    // Safety limits
    MAX_ORDERS_PER_RUN: parseInt(process.env.MAX_ORDERS_PER_RUN) || 1000,
    MAX_PROCESSING_TIME_MINUTES: parseInt(process.env.MAX_PROCESSING_TIME_MINUTES) || 30,
    
    // Dispute handling
    ALLOW_DISPUTED_ORDER_COMPLETION: process.env.ALLOW_DISPUTED_ORDER_COMPLETION === 'true',
    REQUIRE_ADMIN_REVIEW_FOR_DISPUTES: process.env.REQUIRE_ADMIN_REVIEW_FOR_DISPUTES !== 'false',
    
    // Validation rules
    VALIDATION_RULES: {
        // Minimum order age before processing (in hours)
        MIN_ORDER_AGE_HOURS: parseInt(process.env.MIN_ORDER_AGE_HOURS) || 1,
        
        // Minimum amount for processing
        MIN_ORDER_AMOUNT: parseFloat(process.env.MIN_ORDER_AMOUNT) || 0,
        
        // Skip orders with these statuses
        SKIP_ORDER_STATUSES: process.env.SKIP_ORDER_STATUSES ? 
            process.env.SKIP_ORDER_STATUSES.split(',') : 
            ['cancelled', 'returned', 'failed'],
            
        // Required payment statuses for processing
        REQUIRED_PAYMENT_STATUSES: process.env.REQUIRED_PAYMENT_STATUSES ? 
            process.env.REQUIRED_PAYMENT_STATUSES.split(',') : 
            ['completed']
    },
    
    // Retry configuration
    RETRY_CONFIG: {
        MAX_RETRIES: parseInt(process.env.CRON_MAX_RETRIES) || 3,
        RETRY_DELAY_MINUTES: parseInt(process.env.CRON_RETRY_DELAY_MINUTES) || 5,
        BACKOFF_MULTIPLIER: parseFloat(process.env.CRON_BACKOFF_MULTIPLIER) || 2
    },
    
    // Performance monitoring
    PERFORMANCE_MONITORING: {
        ENABLE_METRICS: process.env.ENABLE_CRON_METRICS === 'true',
        METRICS_ENDPOINT: process.env.METRICS_ENDPOINT || '/metrics/cron',
        ALERT_SLOW_EXECUTION_SECONDS: parseInt(process.env.ALERT_SLOW_EXECUTION_SECONDS) || 300
    }
};

/**
 * Environment Variables Documentation:
 * 
 * Required:
 * - DB_STRING: MongoDB connection string
 * 
 * Optional Cron Settings:
 * - DAY: Number of days to wait before processing (default: 3)
 * - CRON_SCHEDULE: Cron schedule expression (default: '0 0 * * *')
 * - ENABLE_EMAIL_NOTIFICATIONS: Enable admin email notifications (default: false)
 * 
 * Optional Email Settings (only if ENABLE_EMAIL_NOTIFICATIONS=true):
 * - ADMIN_EMAIL: Admin email address for notifications
 * - FROM_EMAIL: From email address for notifications
 * 
 * Optional Safety & Performance:
 * - MAX_ORDERS_PER_RUN: Maximum orders to process per run (default: 1000)
 * - MAX_PROCESSING_TIME_MINUTES: Maximum processing time (default: 30)
 * - MIN_ORDER_AGE_HOURS: Minimum order age before processing (default: 1)
 * - MIN_ORDER_AMOUNT: Minimum order amount for processing (default: 0)
 * 
 * Optional Logging:
 * - LOG_LEVEL: Logging level (default: 'info')
 * - LOG_TO_FILE: Whether to log to file (default: false)
 * - LOG_FILE_PATH: Log file path (default: './logs/cron.log')
 * 
 * Optional Monitoring:
 * - ENABLE_CRON_METRICS: Enable performance metrics (default: false)
 * - METRICS_ENDPOINT: Metrics endpoint path (default: '/metrics/cron')
 * - ALERT_SLOW_EXECUTION_SECONDS: Alert threshold for slow execution (default: 300)
 * 
 * Example .env configuration:
 * 
 * # Basic settings
 * DAY=3
 * CRON_SCHEDULE=0 2 * * *
 * 
 * # Email notifications
 * ENABLE_EMAIL_NOTIFICATIONS=true
 * ADMIN_EMAIL=admin@yourcompany.com
 * FROM_EMAIL=system@yourcompany.com
 * 
 * # Safety settings
 * MAX_ORDERS_PER_RUN=500
 * MIN_ORDER_AGE_HOURS=2
 * 
 * # Monitoring
 * ENABLE_CRON_METRICS=true
 * LOG_TO_FILE=true
 */ 