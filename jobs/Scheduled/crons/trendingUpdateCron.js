const mongoose = require('mongoose');
const cron = require('node-cron');
require('dotenv').config();
const { updateAllTrendingStatus } = require('../../../routes/services/serviceTrending');

// Health check variables
let cronStats = {
    lastRun: null,
    lastSuccessfulRun: null,
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    productsUpdated: 0
};

// Environment variables with defaults
const CRON_SCHEDULE = process.env.TRENDING_CRON_SCHEDULE || '* * * * *'; // Every 6 hours by default


// Connect to MongoDB
mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("🟢 MongoDB connected for Trending Update Cron");
    console.log(`📅 Trending cron scheduled to run: ${CRON_SCHEDULE}`);

    // Run the cron job
    cron.schedule(CRON_SCHEDULE, async () => {
        const runStartTime = new Date();
        console.log('🔄 Starting Trending Update Cron Job at:', runStartTime.toISOString());

        cronStats.lastRun = runStartTime;
        cronStats.totalRuns++;

        try {
            // Update trending status for all products
            const result = await updateAllTrendingStatus();
            
            // Update stats
            cronStats.productsUpdated += result.updatedCount;
            cronStats.lastSuccessfulRun = new Date();
            cronStats.successfulRuns++;

            const runEndTime = new Date();
            const duration = runEndTime - runStartTime;

            console.log('✅ Trending Update Cron Job completed successfully');
            console.log(`📊 Processing Summary:
            - Duration: ${duration}ms
            - Products Updated: ${result.updatedCount}
            - Currently Trending: ${result.trendingCount}`);

        } catch (error) {
            cronStats.failedRuns++;
            console.error('❌ Critical Error in Trending Update Cron:', error)
        }
    });

    // Health check endpoint
    if (typeof global.app !== 'undefined') {
        global.app.get('/cron/health/trending-update', (req, res) => {
            res.json({
                status: 'running',
                schedule: CRON_SCHEDULE,
                stats: cronStats,
                uptime: process.uptime()
            });
        });
    }

}).catch((error) => {
    console.error("❌ MongoDB connection failed for Trending Update Cron:", error);
});

