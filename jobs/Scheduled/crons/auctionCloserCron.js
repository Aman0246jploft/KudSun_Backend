// require('dotenv').config();
// const mongoose = require('mongoose');
// const cron = require('node-cron');
// const moment = require('moment');
// const { SellProduct } = require('../../../db');

// console.log("🟢 Starting auctionCloserCron...");

// mongoose.connect(process.env.DB_STRING, {
//     useNewUrlParser: true,
//     useUnifiedTopology: true
// }).then(async () => {
//     console.log("🟢 MongoDB connected for cron job");


//     cron.schedule('* * * * *', async () => {


//     try {
//         const now = new Date();
//         const offsetMinutes = now.getTimezoneOffset();
//         const localNow = new Date(now.getTime() - offsetMinutes * 60 * 1000);
//         const query = {
//             saleType: 'auction',
//             "auctionSettings.biddingEndsAt": { $lte: localNow },
//             "auctionSettings.isBiddingOpen": true
//         };
//         console.log("Query to find expired auctions:", JSON.stringify(query, null, 2));

//         const update = {
//             $set: { "auctionSettings.isBiddingOpen": false }
//         };
//         console.log("Update to apply:", JSON.stringify(update, null, 2));

//         const result = await SellProduct.updateMany(query, update);

//         console.log(`[${moment().format()}] Bidding closed for ${result.modifiedCount} product(s)`);

//     } catch (error) {
//         console.error("❌ Cron job error:", error);
//     }
//     });

// }).catch(err => {
//     console.error("❌ MongoDB connection failed for cron job:", err);
// });






























require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const moment = require('moment');
const { SellProduct, Bid, UserAddress } = require('../../../db');
const { SALE_TYPE, DEFAULT_AMOUNT, PAYMENT_STATUS, PAYMENT_METHOD, ORDER_STATUS } = require('../../../utils/Role');
const { toObjectId } = require('../../../utils/globalFunction');


mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log("🟢 MongoDB connected for cron job");

    cron.schedule('* * * * *', async () => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const now = new Date();
            const offsetMinutes = now.getTimezoneOffset();
            const localNow = new Date(now.getTime() - offsetMinutes * 60 * 1000);

            const expiredAuctions = await SellProduct.find({
                saleType: SALE_TYPE.AUCTION,
                "auctionSettings.biddingEndsAt": { $lte: localNow },
                "auctionSettings.isBiddingOpen": true,
                isDeleted: false,
                isDisable: false
            });

            console.log(`[${moment().format()}] Checking ${expiredAuctions.length} expired auctions...`);

            for (const product of expiredAuctions) {
                const highestBid = await Bid.findOne({
                    productId: product._id,
                    amount: { $gte: product.auctionSettings.reservePrice }
                }).sort({ amount: -1 }).lean()


                if (highestBid) {
                    let userAddressInfo = await UserAddress.findOne({ userId: toObjectId(highestBid.userId), isActive: true })
                    const plateFormFee = Number(DEFAULT_AMOUNT.PLATFORM_FEE)
                    const shippingCharge = Number(DEFAULT_AMOUNT.SHIPPING_CHARGE)
                    // Create order only if reserve is met
                    const orderPayload = {
                        userId: highestBid.userId,
                        addressId: userAddressInfo ? userAddressInfo._id : null, // Fill this based on business logic (default address or request manually)
                        addressSnapshot: userAddressInfo ? {
                            fullName: userAddressInfo?.fullName,
                            phone: userAddressInfo?.phone,
                            line1: userAddressInfo?.line1,
                            line2: userAddressInfo?.line2,
                            city: userAddressInfo?.city,
                            state: userAddressInfo?.state,
                            country: userAddressInfo?.country,
                            postalCode: userAddressInfo?.postalCode,
                        } : {}, // optional snapshot logic, like storing default shipping address
                        items: [{
                            productId: product._id,
                            quantity: 1,
                            saleType: SALE_TYPE.AUCTION,
                            priceAtPurchase: highestBid.amount
                        }],
                        totalAmount: highestBid.amount,
                        platformFee: plateFormFee, // add logic if you charge fees
                        shippingCharge: product.shippingCharge || shippingCharge,
                        grandTotal: highestBid.amount + (product.shippingCharge || 0) + plateFormFee,
                        paymentStatus: PAYMENT_STATUS.PENDING,
                        paymentMethod: PAYMENT_METHOD.ONLINE,
                        status: ORDER_STATUS.PENDING
                    };

                    // Optional validation: skip if an order already exists for this product & user
                    const existingOrder = await Order.findOne({
                        userId: highestBid.userId,
                        "items.productId": product._id
                    });

                    if (!existingOrder) {
                        const newOrder = new Order(orderPayload);
                        await newOrder.save({ session });
                        console.log(`✅ Order created for product: ${product._id} (Bid: ${highestBid.amount})`);

                        // Mark bid as winning
                        await Bid.updateMany({ productId: product._id }, {
                            $set: { currentlyWinning: false }
                        }, { session });
                        await Bid.findByIdAndUpdate(highestBid._id, {
                            $set: { isWinningBid: true, currentlyWinning: true }
                        }, { session });

                    } else {
                        console.log(`⚠️ Order already exists for product: ${product._id}`);
                    }
                } else {
                    console.log(`❌ No valid bid for product: ${product._id} (reserve not met)`);
                }

                // Update product to close bidding
                product.auctionSettings.isBiddingOpen = false;
                await product.save({ session });
            }
            await session.commitTransaction();
            session.endSession();
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("❌ Cron job error:", error);
        }
    });

}).catch(err => {
    console.error("❌ MongoDB connection failed for cron job:", err);
});
