require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const moment = require('moment');
const { SellProduct } = require('../../../db');

console.log("🟢 Starting auctionCloserCron...");

mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log("🟢 MongoDB connected for cron job");


    cron.schedule('* * * * *', async () => {


    try {
        const now = new Date();
        console.log(`Current time: ${now.toISOString()}`);
        const offsetMinutes = now.getTimezoneOffset();
        const localNow = new Date(now.getTime() - offsetMinutes * 60 * 1000);
        console.log('Local adjusted time:', localNow.toISOString());
        const query = {
            saleType: 'auction',
            "auctionSettings.biddingEndsAt": { $lte: localNow },
            "auctionSettings.isBiddingOpen": true
        };
        console.log("Query to find expired auctions:", JSON.stringify(query, null, 2));

        const update = {
            $set: { "auctionSettings.isBiddingOpen": false }
        };
        console.log("Update to apply:", JSON.stringify(update, null, 2));

        const result = await SellProduct.updateMany(query, update);

        console.log(`[${moment().format()}] Bidding closed for ${result.modifiedCount} product(s)`);

    } catch (error) {
        console.error("❌ Cron job error:", error);
    }
    });

}).catch(err => {
    console.error("❌ MongoDB connection failed for cron job:", err);
});
