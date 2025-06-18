// auctionCloserCron.js
require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const moment = require('moment');
const { SellProduct } = require('../../../db');


// Connect to MongoDB
mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("🟢 MongoDB connected for cron job");

    // Cron job: runs every minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const result = await SellProduct.updateMany({
                saleType: 'auction',
                "auctionSettings.biddingEndsAt": { $lte: now },
                "auctionSettings.isBiddingOpen": true
            }, {
                $set: { "auctionSettings.isBiddingOpen": false }
            });

            console.log(`[${moment().format()}] Bidding closed for ${result.modifiedCount} products`);
        } catch (error) {
            console.error("Cron job error:", error);
        }
    });

}).catch(err => {
    console.error("MongoDB connection failed for cron job:", err);
});
