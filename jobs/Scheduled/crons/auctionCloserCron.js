require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const { DateTime } = require('luxon');  // add this if not already
const moment = require('moment');
const { SellProduct, Bid, UserAddress, Order, FeeSetting } = require('../../../db');
const { SALE_TYPE, DEFAULT_AMOUNT, PAYMENT_STATUS, PAYMENT_METHOD, ORDER_STATUS, CHARGE_TYPE, PRICING_TYPE } = require('../../../utils/Role');
const { toObjectId } = require('../../../utils/globalFunction');

mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("🟢 MongoDB connected for cron job");

    cron.schedule('* * * * *', async () => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            // Use current time in UTC (no offset correction)
            const nowUTC = DateTime.now().toUTC().toJSDate();

            const feeSettings = await FeeSetting.find({
                isActive: true,
                isDisable: false,
                isDeleted: false
            }).lean();

            const feeMap = {};
            feeSettings.forEach(fee => {
                feeMap[fee.name] = fee;
            });



            // Find auctions that ended (biddingEndsAt <= nowUTC) and still open
            const expiredAuctions = await SellProduct.find({
                saleType: SALE_TYPE.AUCTION,
                "auctionSettings.biddingEndsAt": { $lte: nowUTC },
                "auctionSettings.isBiddingOpen": true,
                isDeleted: false,
                isDisable: false
            });


            for (const product of expiredAuctions) {
                const highestBid = await Bid.findOne({
                    productId: product._id,
                    amount: { $gte: product.auctionSettings.reservePrice }
                }).sort({ amount: -1 }).lean();

                if (highestBid) {
                    const userAddressInfo = await UserAddress.findOne({ userId: toObjectId(highestBid.userId), isActive: true });

                    const buyerProtectionFeeSetting = feeMap[CHARGE_TYPE.BUYER_PROTECTION_FEE];
                    let buyerProtectionFee = 0;
                    let buyerProtectionFeeType = PRICING_TYPE.FIXED;

                    if (buyerProtectionFeeSetting) {
                        buyerProtectionFeeType = buyerProtectionFeeSetting.type;
                        buyerProtectionFee = buyerProtectionFeeType === PRICING_TYPE.PERCENTAGE
                            ? (highestBid.amount * buyerProtectionFeeSetting.value / 100)
                            : buyerProtectionFeeSetting.value;
                    }

                    const taxSetting = feeMap[CHARGE_TYPE.TAX];
                    let tax = 0;
                    let taxType = PRICING_TYPE.FIXED;
                    if (taxSetting) {
                        taxType = taxSetting.type;
                        tax = taxType === PRICING_TYPE.PERCENTAGE
                            ? (highestBid.amount * taxSetting.value / 100)
                            : taxSetting.value;
                    }



                    const shippingCharge = product.shippingCharge || 0;
                    const grandTotal = highestBid.amount + shippingCharge + buyerProtectionFee + tax;

                    const orderPayload = {
                        userId: highestBid.userId,
                        items: [{
                            productId: product._id,
                            quantity: 1,
                            saleType: SALE_TYPE.AUCTION,
                            priceAtPurchase: highestBid.amount
                        }],
                        totalAmount: highestBid.amount,
                        BuyerProtectionFee: buyerProtectionFee,
                        BuyerProtectionFeeType: buyerProtectionFeeType,
                        Tax: tax,
                        TaxType: taxType,
                        shippingCharge,
                        grandTotal,
                        paymentStatus: PAYMENT_STATUS.PENDING,
                        paymentMethod: PAYMENT_METHOD.ONLINE,
                        status: ORDER_STATUS.PENDING
                    };
                    if (userAddressInfo && userAddressInfo !== "") {
                        orderPayload["addressId"] = userAddressInfo?._id;
                 
                    }
                    const existingOrder = await Order.findOne({
                        userId: highestBid.userId,
                        "items.productId": product._id
                    });

                    if (!existingOrder) {
                        const newOrder = new Order(orderPayload);
                        await newOrder.save({ session });
                        console.log(`✅ Order created for product: ${product._id} (Bid: ${highestBid.amount})`);

                        // Update bids
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

                // Close auction bidding
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

