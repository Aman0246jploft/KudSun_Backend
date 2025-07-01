require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const {UserAddress, Order } = require('../../../db');
const { toObjectId } = require('../../../utils/globalFunction');

mongoose.connect(process.env.DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("🟢 MongoDB connected for cron jobs");
    // Cron 1: Update orders missing address info
    cron.schedule('* * * * *', async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const ordersWithoutAddress = await Order.find({
                $or: [
                    { addressId: { $exists: false } },
                    { addressId: null }
                ]
            });

            for (const order of ordersWithoutAddress) {
                const userAddress = await UserAddress.findOne({
                    userId: toObjectId(order.userId),
                    isActive: true
                }).lean();

                if (userAddress) {

                    order.addressId = userAddress._id;
     

                    await order.save({ session });
                    console.log(`✅ Updated address for Order: ${order._id} (User: ${order.userId})`);
                } else {
                    console.log(`⏳ No active address yet for User: ${order.userId} on Order: ${order._id}`);
                }
            }

            await session.commitTransaction();
            session.endSession();
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("❌ Address update cron job error:", error);
        }
    });

}).catch(err => {
    console.error("❌ MongoDB connection failed for cron jobs:", err);
});
