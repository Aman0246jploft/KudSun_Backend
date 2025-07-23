const mongoose = require('mongoose');
const cron = require('node-cron');
require('dotenv').config();
const { updateAllThreadTrendingStatus } = require('../../../routes/services/serviceThreadTrending');

// Health check variables
let cronStats = {
    lastRun: null,
    lastSuccessfulRun: null,
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    threadsUpdated: 0
};

// Environment variables with defaults
const CRON_SCHEDULE = process.env.THREAD_TRENDING_CRON_SCHEDULE || '* * * * *'; // Every minute by default

// Connect to MongoDB
mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {

    // Run the cron job
    cron.schedule(CRON_SCHEDULE, async () => {
        const runStartTime = new Date();
        cronStats.lastRun = runStartTime;
        cronStats.totalRuns++;

        try {
            // Update trending status for all threads
            const result = await updateAllThreadTrendingStatus();
            
            // Update stats
            cronStats.threadsUpdated += result.updatedCount;
            cronStats.lastSuccessfulRun = new Date();
            cronStats.successfulRuns++;

            const runEndTime = new Date();
            const duration = runEndTime - runStartTime;

        } catch (error) {
            cronStats.failedRuns++;
            console.error('❌ Critical Error in Thread Trending Update Cron:', error);
        }
    });

    // Health check endpoint
    if (typeof global.app !== 'undefined') {
        global.app.get('/cron/health/thread-trending-update', (req, res) => {
            res.json({
                status: 'running',
                schedule: CRON_SCHEDULE,
                stats: cronStats,
                uptime: process.uptime()
            });
        });
    }

}).catch((error) => {
    console.error("❌ MongoDB connection failed for Thread Trending Update Cron:", error);
}); 