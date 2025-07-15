const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const moment = require("moment")
const { UserAddress, Transaction, Order, SellProduct, Bid, FeeSetting, User, Shipping, OrderStatusHistory, ProductReview, ChatRoom, ChatMessage, WalletTnx, SellerWithdrawl, SellerBank, PlatformRevenue, Dispute } = require('../../db');
const { findOrCreateOneOnOneRoom } = require('../services/serviceChat');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes, parseItems } = require('../../utils/globalFunction');
const { SALE_TYPE, DEFAULT_AMOUNT, PAYMENT_METHOD, ORDER_STATUS, PAYMENT_STATUS, CHARGE_TYPE, PRICING_TYPE, SHIPPING_STATUS, TNX_TYPE } = require('../../utils/Role');
const { default: mongoose } = require('mongoose');
const Joi = require('joi');

const emitSystemMessage = async (io, systemMessage, room, buyerId, sellerId) => {
    if (!io) return;

    // Emit the new message to the room
    const messageWithRoom = {
        ...systemMessage.toObject(),
        chatRoom: room._id
    };
    io.to(room._id.toString()).emit('newMessage', messageWithRoom);

    // Update chat room for both users
    const roomObj = await ChatRoom.findById(room._id)
        .populate('participants', 'userName profileImage')
        .populate('lastMessage');

    // For buyer
    io.to(`user_${buyerId}`).emit('roomUpdated', {
        ...roomObj.toObject(),
        participants: roomObj.participants.filter(p => p._id.toString() !== buyerId.toString()),
        unreadCount: 0
    });

    // For seller
    io.to(`user_${sellerId}`).emit('roomUpdated', {
        ...roomObj.toObject(),
        participants: roomObj.participants.filter(p => p._id.toString() !== sellerId.toString()),
        unreadCount: 1
    });

    // Also emit a specific system notification event
    io.to(`user_${buyerId}`).emit('systemNotification', {
        type: systemMessage.messageType,
        meta: systemMessage.systemMeta
    });
    io.to(`user_${sellerId}`).emit('systemNotification', {
        type: systemMessage.messageType,
        meta: systemMessage.systemMeta
    });
};

const createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        let { addressId, items, paymentMethod = PAYMENT_METHOD.ONLINE } = req.body;
        let totalShippingCharge = 0;
        const userId = req.user.userId;

        if (req.body.items) {
            items = parseItems(req.body.items)
        }

        const sellerIds = new Set(); // collect seller IDs

        if (!Array.isArray(items) || items.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid order data');
        }
        const address = await UserAddress.findOne({ userId, isActive: true, _id: toObjectId(addressId) });
        if (!address) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Address not found');
        }
        const activeOrderStatuses = [
            ORDER_STATUS.PENDING,
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.PROCESSING,
            ORDER_STATUS.SHIPPED,
            ORDER_STATUS.DELIVERED
        ];
        const productIds = items.map(i => toObjectId(i.productId));
        const existingOrders = await Order.find({
            userId: toObjectId(userId),
            'items.productId': { $in: productIds },
            isDeleted: { $ne: true },   // Assuming soft deletes,
            status: { $in: activeOrderStatuses },
            paymentStatus: { $ne: PAYMENT_STATUS.FAILED }
        }).session(session);


        if (existingOrders.length > 0) {
            // Find which products are duplicated
            const orderedProductIds = new Set();
            for (const order of existingOrders) {
                for (const item of order.items) {
                    if (productIds.some(pid => pid.equals(item.productId))) {
                        orderedProductIds.add(item.productId.toString());
                    }
                }
            }
            return apiErrorRes(
                HTTP_STATUS.CONFLICT,
                res,
                `Order already placed for product(s): ${Array.from(orderedProductIds).join(', ')}`
            );
        }

        const feeSettings = await FeeSetting.find({
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).lean();
        const feeMap = {};
        feeSettings.forEach(fee => {
            feeMap[fee.name] = fee;
        });


        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await SellProduct.findOne({ _id: toObjectId(item.productId), isDeleted: false, isDisable: false, isSold: false }).session(session);
            if (!product) {
                await session.abortTransaction();
                return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `Product not found or unavailable: ${item.productId}`);
            }

            const seller = await User.findOne({ _id: product.userId });
            if (!seller || seller.isDeleted || seller.isDisable) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Seller of product ${product.title} is deleted or disabled`);
            }

            sellerIds.add(product.userId.toString());

            if (product.userId.toString() === userId.toString()) {
                await session.abortTransaction();
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `You cannot purchase your own product: ${product.title}`);
            }

            let price = 0;

            if (product.saleType === SALE_TYPE.FIXED) {
                // Standard product
                price = product.fixedPrice;


            } else if (product.saleType === SALE_TYPE.AUCTION) {
                const { auctionSettings = {} } = product;

                // Ensure bidding has ended
                if (auctionSettings.isBiddingOpen) {
                    await session.abortTransaction();
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Bidding is still open for: ${product.title}`);
                }

                // Optionally enforce based on end timestamp
                if (auctionSettings.biddingEndsAt && moment().isBefore(auctionSettings.biddingEndsAt)) {
                    await session.abortTransaction();
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Bidding period hasn't ended yet for: ${product.title}`);
                }



                // Check if user is the winning bidder
                const winningBid = await Bid.findOne({
                    productId: toObjectId(product._id),
                    userId: toObjectId(userId),
                    currentlyWinning: true
                }).session(session);

                if (!winningBid) {
                    await session.abortTransaction();
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `You have not won the auction for: ${product.title}`);
                }


                if (auctionSettings.reservePrice && winningBid.amount < auctionSettings.reservePrice) {
                    await session.abortTransaction();
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Winning bid for ${product.title} does not meet the reserve price`);
                }

                price = winningBid.amount;
            }

            const subtotal = price * Number(item.quantity ?? 1);
            totalAmount += subtotal;

            orderItems.push({
                productId: product._id,
                quantity: Number(item.quantity ?? 1),
                priceAtPurchase: price
            });
            totalShippingCharge += Number(product.shippingCharge ?? DEFAULT_AMOUNT.SHIPPING_CHARGE);
        }

        const sellerId = Array.from(sellerIds)[0];

        const buyerProtectionFeeSetting = feeMap[CHARGE_TYPE.BUYER_PROTECTION_FEE];
        let buyerProtectionFee = 0;
        let buyerProtectionFeeType = PRICING_TYPE.FIXED;
        if (buyerProtectionFeeSetting) {
            buyerProtectionFeeType = buyerProtectionFeeSetting.type;
            buyerProtectionFee = buyerProtectionFeeType === PRICING_TYPE.PERCENTAGE
                ? (totalAmount * buyerProtectionFeeSetting.value / 100)
                : buyerProtectionFeeSetting.value;
        }
        const taxSetting = feeMap[CHARGE_TYPE.TAX];
        let tax = 0;
        let taxType = PRICING_TYPE.FIXED;
        if (taxSetting) {
            taxType = taxSetting.type;
            tax = taxType === PRICING_TYPE.PERCENTAGE
                ? (totalAmount * taxSetting.value / 100)
                : taxSetting.value;
        }


        const shippingCharge = totalShippingCharge || 0

        const grandTotal = totalAmount + shippingCharge + buyerProtectionFee + tax;



        const order = new Order({
            userId,
            sellerId,
            addressId: address._id,
            items: orderItems,
            totalAmount,
            shippingCharge,
            grandTotal,
            paymentMethod,
            BuyerProtectionFee: buyerProtectionFee,
            BuyerProtectionFeeType: buyerProtectionFeeType,
            Tax: tax,
            TaxType: taxType,
        });
        await order.save({ session });

        // Create or get chat room with seller after order creation
        const { room } = await findOrCreateOneOnOneRoom(userId, sellerId);

        // Create system message for order creation
        const systemMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'ORDER_STATUS',
            systemMeta: {
                statusType: 'ORDER',
                status: ORDER_STATUS.PENDING,
                orderId: order._id,
                productId: orderItems[0].productId, // First product in order
                meta: {
                    orderNumber: order._id.toString(),
                    totalAmount: order.grandTotal,
                    itemCount: orderItems.length
                },
                actions: [
                    {
                        label: "View Order",
                        url: `/order/${order._id}`,
                        type: "primary"
                    }
                ],
                theme: 'info'
            }
        });

        console.log(12345, "systemMessage", systemMessage)


        await systemMessage.save({ session });

        // Update chat room's last message
        await ChatRoom.findByIdAndUpdate(
            room._id,
            {
                lastMessage: systemMessage._id,
                updatedAt: new Date()
            },
            { session }
        );

        await session.commitTransaction();


        const io = req.app.get('io');
        await emitSystemMessage(io, systemMessage, room, userId, sellerId);

        await trackOrderRevenue(order, feeMap, session);

        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Order placed successfully", order);
    } catch (err) {
        await session.abortTransaction(); // ✅ move here only
        console.error("Order creation error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to place order");
    } finally {
        session.endSession(); // ✅ always close the session
    }


};

const trackOrderRevenue = async (order, feeMap, session) => {
    const revenueEntries = [];

    // Track Buyer Protection Fee
    if (order.BuyerProtectionFee > 0) {
        revenueEntries.push({
            orderId: order._id,
            revenueType: 'BUYER_PROTECTION_FEE',
            amount: order.BuyerProtectionFee,
            calculationType: order.BuyerProtectionFeeType,
            calculationValue: feeMap[CHARGE_TYPE.BUYER_PROTECTION_FEE].value,
            baseAmount: order.totalAmount,
            status: 'PENDING',
            description: `Buyer protection fee for order ${order._id}`,
            metadata: {
                orderTotal: order.totalAmount,
                buyerId: order.userId
            }
        });
    }

    // Track Tax
    if (order.Tax > 0) {
        revenueEntries.push({
            orderId: order._id,
            revenueType: 'TAX',
            amount: order.Tax,
            calculationType: order.TaxType,
            calculationValue: feeMap[CHARGE_TYPE.TAX].value,
            baseAmount: order.totalAmount,
            status: 'PENDING',
            description: `Tax for order ${order._id}`,
            metadata: {
                orderTotal: order.totalAmount,
                buyerId: order.userId
            }
        });
    }

    // Save revenue entries
    if (revenueEntries.length > 0) {
        await PlatformRevenue.insertMany(revenueEntries, { session });
    }
};

// Sample callback for successful payment

// const paymentCallback = async (req, res) => {
//     const schema = Joi.object({
//         orderId: Joi.string().required(),
//         paymentStatus: Joi.string().valid(PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.FAILED).required(),
//         paymentId: Joi.string().required(),
//         cardType: Joi.string().required(),
//         cardLast4: Joi.string().required(),
//     });

//     const { error, value } = schema.validate(req.body);
//     if (error) {
//         return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);
//     }

//     const { orderId, paymentStatus, paymentId, cardType, cardLast4 } = value;

//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//         const order = await Order.findOne({ _id: orderId })
//             .populate('userId')
//             .populate('sellerId')
//             .session(session);

//         if (!order) {
//             await session.abortTransaction();
//             return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
//         }

//         if (order.paymentStatus === PAYMENT_STATUS.COMPLETED) {
//             await session.abortTransaction();
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Payment already completed");
//         }

//         if (order.paymentStatus === PAYMENT_STATUS.FAILED && paymentStatus === PAYMENT_STATUS.COMPLETED) {
//             await session.abortTransaction();
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Payment cannot be marked as success after failure");
//         }

//         // Update order payment info
//         order.paymentStatus = paymentStatus;
//         order.paymentId = paymentId;

//         // If payment failed: update status + mark products as not sold
//         if (paymentStatus === PAYMENT_STATUS.FAILED) {
//             order.status = ORDER_STATUS.FAILED;
//         } else if (paymentStatus === PAYMENT_STATUS.COMPLETED) {
//             order.paymentStatus = PAYMENT_STATUS.COMPLETED;
//         }

//         await order.save({ session });

//         // Find or create chat room between buyer and seller
//         const { room } = await findOrCreateOneOnOneRoom(order.userId, order.sellerId);

//         // Create system message for payment status
//         const systemMessage = new ChatMessage({
//             chatRoom: room._id,
//             messageType: 'PAYMENT_STATUS',
//             systemMeta: {
//                 statusType: 'PAYMENT',
//                 status: paymentStatus,
//                 orderId: order._id,
//                 productId: order.items[0].productId, // First product in order
//                 title: paymentStatus === PAYMENT_STATUS.COMPLETED ? 'Payment Completed' : 'Payment Failed',
//                 meta: {
//                     orderNumber: order._id.toString(),
//                     amount: `$${(order.grandTotal || 0).toFixed(2)}`,
//                     itemCount: order.items.length,
//                     paymentId: paymentId,
//                     paymentMethod: order.paymentMethod,
//                     cardInfo: paymentStatus === PAYMENT_STATUS.COMPLETED ? `${cardType} ending in ${cardLast4}` : null,
//                     timestamp: new Date().toISOString()
//                 },
//                 actions: paymentStatus === PAYMENT_STATUS.COMPLETED ? [
//                     {
//                         label: "View Order",
//                         url: `/order/${order._id}`,
//                         type: "primary"
//                     }
//                 ] : [
//                     {
//                         label: "Try Payment Again",
//                         url: `/payment/retry/${order._id}`,
//                         type: "primary"
//                     },
//                     {
//                         label: "View Order",
//                         url: `/order/${order._id}`,
//                         type: "secondary"
//                     }
//                 ],
//                 theme: paymentStatus === PAYMENT_STATUS.COMPLETED ? 'success' : 'error'
//             }
//         });

//         await systemMessage.save({ session });

//         // Update chat room's last message
//         await ChatRoom.findByIdAndUpdate(
//             room._id,
//             {
//                 lastMessage: systemMessage._id,
//                 updatedAt: new Date()
//             },
//             { session }
//         );

//         await session.commitTransaction();
//         session.endSession();

//         // Log transaction
//         if ([PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.FAILED].includes(paymentStatus)) {
//             await Transaction.create({
//                 orderId: order._id,
//                 userId: order.userId,
//                 amount: order.grandTotal,
//                 paymentMethod: order.paymentMethod,
//                 paymentStatus,
//                 paymentGatewayId: paymentId,
//                 cardType: cardType || undefined,
//                 cardLast4: cardLast4 || undefined,
//             });
//         }

//         if (order.status !== ORDER_STATUS.FAILED) {
//             await OrderStatusHistory.create({
//                 orderId: order._id,
//                 oldStatus: order.status,
//                 newStatus: order.status,
//                 note: 'Payment status updated'
//             });
//         }

//         const io = req.app.get('io');
//         await emitSystemMessage(io, systemMessage, room, order.userId, order.sellerId);

//         await updateOrderRevenue(order, paymentStatus, session);
//         await session.commitTransaction();
//         return apiSuccessRes(HTTP_STATUS.OK, res, "Payment status updated", {
//             orderId: order._id,
//             paymentStatus: order.paymentStatus,
//             orderStatus: order.status,
//         });
//     } catch (err) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("Payment callback error:", err);
//         return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to update payment status");
//     }finally {
//   session.endSession();                     // always clean up
// }
// };



const paymentCallback = async (req, res) => {
    const schema = Joi.object({
        orderId: Joi.string().required(),
        paymentStatus: Joi.string().valid(PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.FAILED).required(),
        paymentId: Joi.string().required(),
        cardType: Joi.string().required(),
        cardLast4: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);
    }

    const { orderId, paymentStatus, paymentId, cardType, cardLast4 } = value;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const order = await Order.findOne({ _id: orderId })
            .populate('userId')
            .populate('sellerId')
            .session(session);

        if (!order) {
            await session.abortTransaction();
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
        }

        if (order.paymentStatus === PAYMENT_STATUS.COMPLETED) {
            await session.abortTransaction();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Payment already completed");
        }

        if (order.paymentStatus === PAYMENT_STATUS.FAILED && paymentStatus === PAYMENT_STATUS.COMPLETED) {
            await session.abortTransaction();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Payment cannot be marked as success after failure");
        }

        // Update order payment info
        order.paymentStatus = paymentStatus;
        order.paymentId = paymentId;

        // If payment failed: update status + mark products as not sold
        if (paymentStatus === PAYMENT_STATUS.FAILED) {
            order.status = ORDER_STATUS.FAILED;
        } else if (paymentStatus === PAYMENT_STATUS.COMPLETED) {
            order.paymentStatus = PAYMENT_STATUS.COMPLETED;
        }

        await order.save({ session });

        // Find or create chat room between buyer and seller
        const { room } = await findOrCreateOneOnOneRoom(order.userId, order.sellerId);

        // Create system message for payment status
        const systemMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'PAYMENT_STATUS',
            systemMeta: {
                statusType: 'PAYMENT',
                status: paymentStatus,
                orderId: order._id,
                productId: order.items[0].productId, // First product in order
                title: paymentStatus === PAYMENT_STATUS.COMPLETED ? 'Payment Completed' : 'Payment Failed',
                meta: {
                    orderNumber: order._id.toString(),
                    amount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    itemCount: order.items.length,
                    paymentId: paymentId,
                    paymentMethod: order.paymentMethod,
                    cardInfo: paymentStatus === PAYMENT_STATUS.COMPLETED ? `${cardType} ending in ${cardLast4}` : null,
                    timestamp: new Date().toISOString()
                },
                actions: paymentStatus === PAYMENT_STATUS.COMPLETED ? [
                    {
                        label: "View Order",
                        url: `/order/${order._id}`,
                        type: "primary"
                    }
                ] : [
                    {
                        label: "Try Payment Again",
                        url: `/payment/retry/${order._id}`,
                        type: "primary"
                    },
                    {
                        label: "View Order",
                        url: `/order/${order._id}`,
                        type: "secondary"
                    }
                ],
                theme: paymentStatus === PAYMENT_STATUS.COMPLETED ? 'success' : 'error'
            }
        });

        await systemMessage.save({ session });

        // Update chat room's last message
        await ChatRoom.findByIdAndUpdate(
            room._id,
            {
                lastMessage: systemMessage._id,
                updatedAt: new Date()
            },
            { session }
        );

        // Update order revenue (if this function uses session, make sure it doesn't commit)
        await updateOrderRevenue(order, paymentStatus, session);

        // Commit the transaction once all database operations are complete
        await session.commitTransaction();

        // Post-transaction operations (these don't need to be in the transaction)
        // Log transaction
        if ([PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.FAILED].includes(paymentStatus)) {
            await Transaction.create({
                orderId: order._id,
                userId: order.userId,
                amount: order.grandTotal,
                paymentMethod: order.paymentMethod,
                paymentStatus,
                paymentGatewayId: paymentId,
                cardType: cardType || undefined,
                cardLast4: cardLast4 || undefined,
            });
        }

        if (order.status !== ORDER_STATUS.FAILED) {
            await OrderStatusHistory.create({
                orderId: order._id,
                oldStatus: order.status,
                newStatus: order.status,
                note: 'Payment status updated'
            });
        }

        const io = req.app.get('io');
        await emitSystemMessage(io, systemMessage, room, order.userId, order.sellerId);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Payment status updated", {
            orderId: order._id,
            paymentStatus: order.paymentStatus,
            orderStatus: order.status,
        });
    } catch (err) {
        await session.abortTransaction();
        console.error("Payment callback error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to update payment status");
    } finally {
        session.endSession();
    }
};



const updateOrderRevenue = async (order, paymentStatus, session) => {
    if (paymentStatus === PAYMENT_STATUS.COMPLETED) {
        await PlatformRevenue.updateMany(
            { orderId: order._id },
            {
                $set: {
                    status: 'COMPLETED',
                    completedAt: new Date()
                }
            },
            { session }
        );
    } else if (paymentStatus === PAYMENT_STATUS.FAILED) {
        await PlatformRevenue.updateMany(
            { orderId: order._id },
            {
                $set: {
                    status: 'CANCELLED',
                    completedAt: new Date()
                }
            },
            { session }
        );
    }
};

const updateOrderById = async (req, res) => {
    const { orderId } = req.params;

    // ---------------------------
    // Joi Validation Schema
    // ---------------------------
    const schema = Joi.object({
        addressId: Joi.string().optional(),
        items: Joi.array().items(
            Joi.object({
                productId: Joi.string().required(),
                quantity: Joi.number().min(1).default(1),
                saleType: Joi.string().valid(...Object.values(SALE_TYPE)).optional(),
                priceAtPurchase: Joi.number().required()
            })
        ).optional(),
        totalAmount: Joi.number().optional(),
        platformFee: Joi.number().optional(),
        shippingCharge: Joi.number().optional(),
        grandTotal: Joi.number().optional(),
        paymentStatus: Joi.string().valid(...Object.values(PAYMENT_STATUS)).optional(),
        paymentMethod: Joi.string().valid(...Object.values(PAYMENT_METHOD)).optional(),
        status: Joi.string().valid(...Object.values(ORDER_STATUS)).optional(),
        isDisable: Joi.boolean().optional(),
        isDeleted: Joi.boolean().optional()
    });

    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json(apiErrorRes(CONSTANTS_MSG.VALIDATION_ERROR, error.details));
    }

    try {
        // Check if order exists
        const existingOrder = await Order.findById(orderId);
        if (!existingOrder) {
            return res.status(HTTP_STATUS.NOT_FOUND).json(apiErrorRes("Order not found"));
        }

        // ---------------------------
        // Handle addressSnapshot update
        // ---------------------------
        if (value.addressId && value.addressId !== String(existingOrder.addressId)) {
            const address = await UserAddress.findById(value.addressId).lean();
            if (!address) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json(apiErrorRes("Invalid addressId"));
            }
        }

        // ---------------------------
        // Update Order Document
        // ---------------------------
        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            { $set: value },
            { new: true }
        );

        if (updatedOrder.status !== existingOrder.status) {
            await OrderStatusHistory.create({
                orderId: updatedOrder._id,
                oldStatus: existingOrder.status,
                newStatus: updatedOrder.status,
                changedBy: req.user?.userId,
                note: 'Status updated by seller'
            });
        }

        return res.status(HTTP_STATUS.OK).json(apiSuccessRes(updatedOrder, "Order updated successfully"));
    } catch (err) {
        console.error("Update Order Error:", err);
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(apiErrorRes(CONSTANTS_MSG.INTERNAL_SERVER_ERROR));
    }
};

const getBoughtProducts = async (req, res) => {
    try {
        let userId = req.query.userId || req.user.userId
        if (!userId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "userId is required");
        }

        const pageNo = Math.max(1, parseInt(req.query.pageNo) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.size) || 10));
        const skip = (pageNo - 1) * pageSize;
        const ALLOWED_BUYER_NEXT_STATUSES = {
            [ORDER_STATUS.SHIPPED]: ORDER_STATUS.CONFIRM_RECEIPT,  // Buyer confirms delivery
            [ORDER_STATUS.DELIVERED]: ORDER_STATUS.CONFIRM_RECEIPT,  // Buyer confirms delivery
            [ORDER_STATUS.CONFIRM_RECEIPT]: ORDER_STATUS.REVIEW,  // Buyer confirms delivery

        };
        // Query for active orders by user
        const query = {
            userId,
            isDeleted: false,
            isDisable: false
        };

        let { paymentStatus, status } = req.query
        if (paymentStatus) {

            query["paymentStatus"] = paymentStatus || PAYMENT_STATUS.COMPLETED
        }
        // ORDER_STATUS
        if (status) {
            query["status"] = status

        }

        const total = await Order.countDocuments(query);


        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(pageSize)
            .populate([{
                path: 'items.productId',
                model: 'SellProduct',
                select: 'title productImages fixedPrice status saleType auctionSettings'
            },
            {
                path: 'sellerId',
                select: 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting'
            }])
            .lean();



        for (const order of orders) {

            for (const item of order.items || []) {
                const productId = item.productId?._id;
                order.isReviewed = false;
                if (order.status === ORDER_STATUS.CONFIRM_RECEIPT && productId) {
                    const reviewExists = await ProductReview.exists({
                        userId,
                        productId,

                        isDeleted: false,
                        isDisable: false
                    });

                    order.isReviewed = !!reviewExists;
                }
            }
            /** -------- 2. Work out the next step (or none) -------- */
            if (order.paymentStatus === PAYMENT_STATUS.PENDING) {
                // Still waiting for payment ⇒ always show “Pay now”
                order.allowedNextStatuses = 'Pay now';
            } else if (!order.isReviewed) {
                // No payment due and not reviewed yet ⇒ show normal progression
                order.allowedNextStatuses =
                    ALLOWED_BUYER_NEXT_STATUSES[order.status] || '';
            } else {
                // Already reviewed ⇒ no further action
                order.allowedNextStatuses = '';
            }
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Bought products fetched successfully", {
            pageNo,
            size: pageSize,
            total,
            orders
        });

    } catch (err) {
        console.error("Get Bought Product Error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to get bought products",
            err
        );
    }
};

const previewOrder = async (req, res) => {
    try {
        // let { addressId, items } = req.body;
        let { items } = req.body;

        let totalShippingCharge = 0;
        const userId = req.user.userId;

        if (req.body.items) {
            items = parseItems(req.body.items);
        }

        if (!Array.isArray(items) || items.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid order items');
        }
        const address = await UserAddress.findOne({ userId, isActive: true, });

        // const address = await UserAddress.findOne({ userId, isActive: true, _id: toObjectId(addressId) });
        // if (!address) {
        //     return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Address not found');
        // }

        const productIds = items.map(i => toObjectId(i.productId));

        let totalAmount = 0;
        const previewItems = [];
        console.log("itemsitems", items)

        for (const item of items) {
            const product = await SellProduct.findOne({ _id: toObjectId(item.productId), isDeleted: false, isDisable: false }).populate([{
                path: "userId",
                select: "userName profileImage isLive"
            }]).lean();

            if (!product) {
                return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `Product not found or unavailable: ${item.productId}`);
            }

            const seller = await User.findOne({ _id: product.userId }).populate([{ path: "provinceId", select: '_id value' }, { path: "districtId", select: '_id value' }]).lean()
            if (!seller || seller.isDeleted || seller.isDisable) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Seller of product ${product.title} is deleted or disabled`);
            }

            if (product.userId.toString() === userId.toString()) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `You cannot purchase your own product: ${product.title}`);
            }


            let price = 0;

            if (product.saleType === SALE_TYPE.FIXED) {
                price = product.fixedPrice;

            } else if (product.saleType === SALE_TYPE.AUCTION) {
                const { auctionSettings = {} } = product;

                if (auctionSettings.isBiddingOpen) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Bidding is still open for: ${product.title}`);
                }

                if (auctionSettings.biddingEndsAt && moment().isBefore(auctionSettings.biddingEndsAt)) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Bidding period hasn't ended yet for: ${product.title}`);
                }

                const winningBid = await Bid.findOne({
                    productId: toObjectId(product._id),
                    userId: toObjectId(userId),
                    currentlyWinning: true
                });

                if (!winningBid) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `You have not won the auction for: ${product.title}`);
                }

                if (auctionSettings.reservePrice && winningBid.amount < auctionSettings.reservePrice) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Winning bid for ${product.title} does not meet the reserve price`);
                }

                price = winningBid.amount;
            }

            const quantity = Number(item.quantity ?? 1);
            const subtotal = price * quantity;
            totalAmount += subtotal;

            const shippingCharge = Number(product.shippingCharge ?? DEFAULT_AMOUNT.SHIPPING_CHARGE);
            totalShippingCharge += shippingCharge;

            previewItems.push({
                productData: product,
                quantity,
                price,
                subtotal,
                shippingCharge,
                seller: {
                    name: seller?.userName || null,
                    profileImage: seller?.profileImage || null,
                    isLive: seller?.isLive || false

                }
            });
        }

        const shippingCharge = totalShippingCharge;
        // Fetch FeeSettings for buyer protection fee and tax
        const feeSettings = await FeeSetting.find({
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).lean();
        const feeMap = {};
        feeSettings.forEach(fee => {
            feeMap[fee.name] = fee;
        });
        const buyerProtectionFeeSetting = feeMap[CHARGE_TYPE.BUYER_PROTECTION_FEE];
        let buyerProtectionFee = 0;
        let buyerProtectionFeeType = PRICING_TYPE.FIXED;
        if (buyerProtectionFeeSetting) {
            buyerProtectionFeeType = buyerProtectionFeeSetting.type;
            buyerProtectionFee = buyerProtectionFeeType === PRICING_TYPE.PERCENTAGE
                ? (totalAmount * buyerProtectionFeeSetting.value / 100)
                : buyerProtectionFeeSetting.value;
        }

        const taxSetting = feeMap[CHARGE_TYPE.TAX];
        let tax = 0;
        let taxType = PRICING_TYPE.FIXED;
        if (taxSetting) {
            taxType = taxSetting.type;
            tax = taxType === PRICING_TYPE.PERCENTAGE
                ? (totalAmount * taxSetting.value / 100)
                : taxSetting.value;
        }

        const grandTotal = totalAmount + shippingCharge + buyerProtectionFee + tax;

        return apiSuccessRes(HTTP_STATUS.OK, res, "Order preview", {
            items: previewItems,
            address,
            totalAmount,
            shippingCharge,
            buyerProtectionFee,
            buyerProtectionFeeType,
            tax,
            taxType,
            grandTotal
        });
    } catch (err) {
        console.error("Order preview error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to preview order");
    }
};

const getSoldProducts = async (req, res) => {
    try {
        const sellerId = req.user?.userId;
        if (!sellerId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Seller ID is required");
        }

        const pageNo = Math.max(1, parseInt(req.query.pageNo) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.size) || 10));
        const skip = (pageNo - 1) * pageSize;

        // Only include confirmed, shipped, delivered orders
        // const allowedStatuses = [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED];

        // Query orders where sellerId is matched and status is in allowedStatuses
        const query = {
            sellerId,
            isDeleted: false,
            isDisable: false,
        };

        let { paymentStatus, status } = req.query
        if (paymentStatus) {

            query["paymentStatus"] = paymentStatus || PAYMENT_STATUS.COMPLETED
        }
        // ORDER_STATUS
        if (status) {
            query["status"] = status

        }
        const total = await Order.countDocuments(query);

        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(pageSize)
            .populate([
                {
                    path: 'items.productId',
                    model: 'SellProduct',
                    select: 'title productImages fixedPrice saleType auctionSettings userId deliveryType'
                },
                {
                    path: 'userId',
                    select: 'userName profileImage isLive is_Id_verified is_Verified_Seller'
                }
            ])
            .lean();

        // Filter each order's items to only include the seller's products (defensive step)
        const productIds = [];
        for (const order of orders) {
            for (const item of order.items) {
                if (item?.productId?._id) productIds.push(item.productId._id);
            }
        }

        const existingReviews = productIds.length
            ? await ProductReview.find({
                userId: sellerId,
                raterRole: "seller",
                productId: { $in: productIds },
                isDeleted: false,
                isDisable: false
            }).select("productId").lean()
            : [];

        const reviewedSet = new Set(existingReviews.map((r) => r.productId.toString()));

        for (const order of orders) {
            // ... your existing item filtering

            // Compute allowed next statuses based on current order status and delivery types
            const currentStatus = order.status;

            const allLocalPickup = order.items.every(item => item.productId?.deliveryType === "local pickup");

            order.items.forEach((item) => {
                order.isReviewed = reviewedSet.has(item.productId?._id?.toString());

            });



            let allowedNextStatuses = '';

            if (currentStatus === ORDER_STATUS.PENDING) {
                allowedNextStatuses = ORDER_STATUS.CONFIRMED;
            } else if (currentStatus === ORDER_STATUS.CONFIRMED) {
                if (allLocalPickup) {
                    allowedNextStatuses = ORDER_STATUS.DELIVERED;
                } else {
                    allowedNextStatuses = ORDER_STATUS.SHIPPED;
                }
            }

            if (!order.isReviewed && (order.status == ORDER_STATUS.DELIVERED || order.status == ORDER_STATUS.CONFIRM_RECEIPT)) {
                // if you need multiple actions, turn this into an array.
                allowedNextStatuses = "REVIEW";
            }
            // else if (currentStatus === ORDER_STATUS.SHIPPED) {
            //     allowedNextStatuses = ORDER_STATUS.DELIVERED;
            // }
            // else {
            //     allowedNextStatuses = ALLOWED_NEXT_STATUSES[currentStatus] || [];
            // }
            order.allowedNextStatuses = allowedNextStatuses;
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Sold products fetched successfully", {
            pageNo,
            size: pageSize,
            total,
            orders
        });

    } catch (err) {
        console.error("Get Sold Products Error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to get sold products", err);
    }
};


const cancelOrderAndRelistProducts = async (req, res) => {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            const { orderId } = req.body;
            const sellerId = req.user?.userId; // Current user (seller)

            // Input validation
            if (!orderId) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID is required");
            }

            if (!sellerId) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Authentication required");
            }

            // Define allowed statuses for cancellation
            const allowedOrderStatuses = [
                ORDER_STATUS.PENDING,
                ORDER_STATUS.CANCELLED,
                ORDER_STATUS.RETURNED,
                ORDER_STATUS.FAILED,
            ];

            const allowedPaymentStatuses = [
                PAYMENT_STATUS.PENDING,
                PAYMENT_STATUS.FAILED,
                PAYMENT_STATUS.REFUNDED,
            ];

            // Step 1: Find and validate the order
            const order = await Order.findOne({
                _id: orderId,
                isDeleted: false
            })
                .populate({
                    path: 'items.productId',
                    select: 'userId isSold title', // Get seller info and current sold status
                    model: 'SellProduct'
                })
                .session(session);

            if (!order) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
            }

            // Step 2: Validate order status
            if (!allowedOrderStatuses.includes(order.status)) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    `Cannot cancel order. Current status: ${order.status}`
                );
            }

            // Step 3: Validate payment status
            if (!allowedPaymentStatuses.includes(order.paymentStatus)) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    `Cannot cancel order. Payment status: ${order.paymentStatus}`
                );
            }

            // Step 4: Validate seller ownership of ALL products in the order
            const invalidProducts = [];
            const validProductIds = [];

            for (const item of order.items) {
                if (!item.productId) {
                    invalidProducts.push({ error: "Product not found", itemId: item._id });
                    continue;
                }
                // Check if current user is the seller of this product
                if (item.productId.userId.toString() !== sellerId.toString()) {
                    invalidProducts.push({
                        productId: item.productId._id,
                        productTitle: item.productId.title,
                        error: "You are not the seller of this product"
                    });
                } else {
                    validProductIds.push(item.productId._id);
                }
            }

            // If any products don't belong to the seller, reject the request
            if (invalidProducts.length > 0) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(
                    HTTP_STATUS.FORBIDDEN,
                    res,
                    "You can only cancel orders containing your own products",
                    { invalidProducts }
                );
            }

            if (validProductIds.length === 0) {
                await session.abortTransaction();
                session.endSession();
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "No valid products found in order");
            }

            // Step 5: Update products back to available (isSold: false)
            // Only update products that are currently sold to avoid unnecessary writes
            const productUpdateResult = await SellProduct.updateMany(
                {
                    _id: { $in: validProductIds },
                    isSold: true, // Only update if currently sold
                    userId: sellerId // Extra security check
                },
                {
                    $set: {
                        isSold: false,
                        updatedAt: new Date()
                    }
                },
                { session }
            );

            console.log("Product relist result:", {
                totalProducts: validProductIds.length,
                matchedCount: productUpdateResult.matchedCount,
                modifiedCount: productUpdateResult.modifiedCount
            });

            // Step 6: Update order status to CANCELLED (if not already cancelled)
            let orderUpdateResult = null;
            if (order.status !== ORDER_STATUS.CANCELLED) {
                orderUpdateResult = await Order.findByIdAndUpdate(
                    order._id,
                    {
                        status: ORDER_STATUS.CANCELLED,
                        cancelledAt: new Date(),
                        cancelledBy: sellerId,
                        updatedAt: new Date()
                    },
                    {
                        session,
                        new: true
                    }
                );
            }

            // Step 7: Commit transaction
            await session.commitTransaction();
            session.endSession();

            // Success response with details
            if (orderUpdateResult?.status !== order.status) {
                await OrderStatusHistory.create({
                    orderId: order._id,
                    oldStatus: order.status,
                    newStatus: orderUpdateResult.status,
                    changedBy: req.user?.userId,
                    note: 'Status updated by seller'
                });
            }

            return apiSuccessRes(HTTP_STATUS.OK, res, "Order cancelled and products relisted successfully", {
                orderId: order._id,
                orderStatus: orderUpdateResult?.status || order.status,
                productsRelisted: productUpdateResult.modifiedCount,
                totalProducts: validProductIds.length,
                message: productUpdateResult.modifiedCount < validProductIds.length
                    ? "Some products were already available for sale"
                    : "All products are now available for sale"
            });

        } catch (err) {
            await session.abortTransaction();
            session.endSession();

            // Handle write conflicts with retry logic
            if (err.errorLabels && err.errorLabels.includes('TransientTransactionError')) {
                attempt++;
                console.log(`Write conflict detected. Retry attempt ${attempt}/${maxRetries}`, {
                    orderId: req.body.orderId,
                    sellerId: req.user?.userId,
                    errorCode: err.code
                });

                if (attempt < maxRetries) {
                    // Exponential backoff
                    const delay = 100 * Math.pow(2, attempt);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry the transaction
                }
            }

            // Log error details for debugging
            console.error("Cancel Order Error:", {
                orderId: req.body.orderId,
                sellerId: req.user?.userId,
                attempt: attempt + 1,
                error: err.message,
                code: err.code,
                codeName: err.codeName
            });

            return apiErrorRes(
                HTTP_STATUS.INTERNAL_SERVER_ERROR,
                res,
                attempt >= maxRetries
                    ? "Order cancellation failed after multiple attempts. Please try again later."
                    : err.message || "Failed to cancel order and relist products",
                {
                    orderId: req.body.orderId,
                    retryAttempt: attempt + 1
                }
            );
        }
    }
};


const ALLOWED_NEXT_STATUSES = {
    [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
    [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED],
    [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.RETURNED],
};
const TERMINAL_STATUSES = [
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.RETURNED,
    ORDER_STATUS.FAILED,
];

const updateOrderStatusBySeller = async (req, res) => {
    try {
        const sellerId = req.user?.userId;
        const { orderId } = req.params;
        let { status: newStatus } = req.body;

        if (!newStatus) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "status is Required");
        }

        const order = await Order.findOne({ _id: orderId, sellerId })
            .populate('items.productId')
            .populate('userId');

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found for this seller");
        }

        const currentStatus = order.status;

        if (currentStatus === newStatus) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order is already in this status");
        }

        // Populate items.productId to check delivery types
        const populatedOrder = await order.populate('items.productId');




        // Check if ALL products are local pickup
        const allLocalPickup = populatedOrder.items.every(
            item => item.productId?.deliveryType === "local pickup"
        );

        // Check if ANY product is NOT local pickup
        const hasNonLocalPickup = populatedOrder.items.some(
            item => item.productId?.deliveryType !== "local pickup"
        );


        // Define allowed status transitions based on current status and delivery types
        let allowedTransitions = [];






        if (currentStatus === ORDER_STATUS.PENDING) {
            // From pending, seller can cancel or confirm
            allowedTransitions = [ORDER_STATUS.CANCELLED, ORDER_STATUS.CONFIRMED];
        } else if (currentStatus === ORDER_STATUS.CONFIRMED) {

            if (allLocalPickup) {
                // All local pickup: can go directly to DELIVERED or CANCELLED
                allowedTransitions = [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED];
            } else {
                // Has non-local pickup products: must ship before deliver or can cancel
                allowedTransitions = [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED];
            }
        } else if (currentStatus === ORDER_STATUS.SHIPPED) {
            // From shipped can only go to delivered
            allowedTransitions = [ORDER_STATUS.DELIVERED];
        } else {
            // For other statuses, fallback to default allowed transitions if any
            allowedTransitions = ALLOWED_NEXT_STATUSES[currentStatus] || [];
        }

        if (!allowedTransitions.includes(newStatus)) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                `Cannot move order from ${currentStatus} to ${newStatus}`
            );
        }

        // console.log("hasNonLocalPickup",hasNonLocalPickup)

        if (newStatus === ORDER_STATUS.SHIPPED && !hasNonLocalPickup) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "Shipping step not allowed for orders with only local‑pickup products"
            );
        }

        // Prevent shipping if no non-local-pickup products
        if (newStatus === ORDER_STATUS.SHIPPED) {
            const { carrierId, trackingNumber } = req.body;
            const shippingData = {
                carrier: carrierId,
                trackingNumber: trackingNumber || undefined,
                status: SHIPPING_STATUS.NOT_DISPATCHED,
            };

            if (!carrierId) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "CarrierId is required for shipping");
            }
            const existingShipping = await Shipping.findOne({ orderId: order._id, isDeleted: false });
            if (existingShipping) {
                // Update existing shipping record
                existingShipping.carrier = shippingData.carrier;
                existingShipping.trackingNumber = shippingData.trackingNumber;
                existingShipping.status = shippingData.status;
                await existingShipping.save();
            } else {
                // Create new shipping record
                const newShipping = new Shipping({
                    orderId: order._id,
                    addressId: order.addressId, // make sure order has this field
                    ...shippingData,
                });
                await newShipping.save();
            }


        }

        // Update product isSold flag if order is cancelled, returned, or failed
        if (
            [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED, ORDER_STATUS.FAILED].includes(newStatus)
        ) {
            for (const item of populatedOrder.items) {
                const product = item.productId;
                const sellerProduct = await SellProduct.findOne({ _id: product._id });

                if (sellerProduct?.saleType === 'fixed') {
                    sellerProduct.isSold = false;
                    await sellerProduct.save();
                }
            }
        }

        // Save new status
        order.status = newStatus;
        await order.save();

        // Create or get chat room for system message
        const { room } = await findOrCreateOneOnOneRoom(order.userId, sellerId);

        // Prepare system message based on new status
        let messageTitle = '';
        let messageTheme = 'info';
        let additionalMeta = {};
        let additionalActions = [];

        switch (newStatus) {
            case ORDER_STATUS.CONFIRMED:
                messageTitle = 'Order Confirmed';
                messageTheme = 'success';
                break;
            case ORDER_STATUS.SHIPPED:
                messageTitle = 'Order Shipped';
                messageTheme = 'info';
                if (req.body.carrierId && req.body.trackingNumber) {
                    additionalMeta.carrier = req.body.carrierId;
                    additionalMeta.trackingNumber = req.body.trackingNumber;
                    additionalActions.push({
                        label: "Track Shipment",
                        url: `/tracking/${req.body.trackingNumber}`,
                        type: "secondary"
                    });
                }
                break;
            case ORDER_STATUS.DELIVERED:
                messageTitle = 'Order Delivered';
                messageTheme = 'success';
                break;
            case ORDER_STATUS.CANCELLED:
                messageTitle = 'Order Cancelled';
                messageTheme = 'error';
                break;
            default:
                messageTitle = `Order ${newStatus}`;
                break;
        }

        // Create system message
        const systemMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'ORDER_STATUS',
            systemMeta: {
                statusType: 'ORDER',
                status: newStatus,
                orderId: order._id,
                productId: order.items[0].productId,
                title: messageTitle,
                meta: {
                    orderNumber: order._id.toString(),
                    previousStatus: currentStatus,
                    newStatus: newStatus,
                    totalAmount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    itemCount: order.items.length,
                    timestamp: new Date().toISOString(),
                    ...additionalMeta
                },
                actions: [
                    {
                        label: "View Order",
                        url: `/order/${order._id}`,
                        type: "primary"
                    },
                    ...additionalActions
                ],
                theme: messageTheme
            }
        });

        // Start transaction
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Save the system message
            await systemMessage.save({ session });

            // Update chat room's last message
            await ChatRoom.findByIdAndUpdate(
                room._id,
                {
                    lastMessage: systemMessage._id,
                    updatedAt: new Date()
                },
                { session }
            );

            // Update order status
            order.status = newStatus;
            await order.save({ session });

            const totalAmount = order.grandTotal || 0;
            let serviceCharge = 0;
            let serviceType = '';

            let taxAmount = 0;
            let taxType = '';


            if (newStatus === ORDER_STATUS.DELIVERED) {
                const feeSettings = await FeeSetting.find({
                    name: { $in: ["SERVICE_CHARGE", "TAX"] },
                    isActive: true,
                    isDisable: false,
                    isDeleted: false
                });
                const serviceChargeSetting = feeSettings.find(f => f.name === "SERVICE_CHARGE");
                const taxSetting = feeSettings.find(f => f.name === "TAX");

                if (serviceChargeSetting) {
                    if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
                        serviceCharge = (totalAmount * serviceChargeSetting.value) / 100;
                        serviceType = PRICING_TYPE.PERCENTAGE
                    } else if (serviceChargeSetting.type === PRICING_TYPE.FIXED) {
                        serviceCharge = serviceChargeSetting.value;
                        serviceType = PRICING_TYPE.FIXED
                    }
                }

                if (taxSetting) {
                    if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
                        taxAmount = (totalAmount * taxSetting.value) / 100;
                        taxType = PRICING_TYPE.PERCENTAGE
                    } else if (taxSetting.type === PRICING_TYPE.FIXED) {
                        taxAmount = taxSetting.value;
                        taxType = PRICING_TYPE.FIXED
                    }
                }

                const netAmount = totalAmount - serviceCharge - taxAmount;

                const sellerWalletTnx = new WalletTnx({
                    orderId: order._id,
                    userId: sellerId,
                    amount: totalAmount,
                    netAmount: netAmount,
                    serviceCharge,
                    taxCharge: taxAmount,
                    tnxType: TNX_TYPE.CREDIT,
                    serviceType: serviceType,
                    taxType: taxType,
                    tnxStatus: PAYMENT_STATUS.COMPLETED
                });
                await sellerWalletTnx.save({ session });

                await User.findByIdAndUpdate(
                    sellerId,
                    {
                        $inc: { walletBalance: netAmount } // increment walletBalance by net earnings
                    },
                    { session }
                );


            }


            // Create status history
            if (currentStatus !== newStatus) {
                await OrderStatusHistory.create([{
                    orderId: order._id,
                    oldStatus: currentStatus,
                    newStatus,
                    changedBy: req.user?.userId,
                    note: 'Status updated by seller'
                }], { session });
            }

            await session.commitTransaction();

            // Emit socket events
            const io = req.app.get('io');
            await emitSystemMessage(io, systemMessage, room, order.userId, sellerId);

            return apiSuccessRes(HTTP_STATUS.OK, res, "Order status updated successfully", {
                orderId: order._id,
                status: order.status,
            });
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    } catch (err) {
        console.error("Update order status error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to update order status"
        );
    }
};


// const updateOrderStatusByBuyer = async (req, res) => {
//     try {
//         const buyerId = req.user?.userId;
//         const { orderId } = req.params;
//         let { status: newStatus } = req.body;

//         if (!newStatus) {
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Status is required");
//         }

//         const order = await Order.findOne({ _id: orderId, userId: buyerId })
//             .populate('items.productId')
//             .populate('sellerId');

//         if (!order) {
//             return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found for this buyer");
//         }

//         const currentStatus = order.status;

//         if (currentStatus === newStatus) {
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order is already in this status");
//         }

//         // Populate product data
//         const populatedOrder = await order.populate('items.productId');

//         let allowedTransitions = [];

//         if (currentStatus === ORDER_STATUS.SHIPPED) {
//             // After shipped, buyer can confirm delivery or request return
//             allowedTransitions = [ORDER_STATUS.CONFIRM_RECEIPT];
//             // allowedTransitions = [ORDER_STATUS.CONFIRM_RECEIPT, ORDER_STATUS.RETURNED];
//         } else if (currentStatus === ORDER_STATUS.DELIVERED) {
//             // After delivery, buyer can request return
//             allowedTransitions = [ORDER_STATUS.RETURNED];
//         } else {
//             return apiErrorRes(
//                 HTTP_STATUS.BAD_REQUEST,
//                 res,
//                 `Buyers can only update orders after they are shipped or delivered`
//             );
//         }

//         if (!allowedTransitions.includes(newStatus)) {
//             return apiErrorRes(
//                 HTTP_STATUS.BAD_REQUEST,
//                 res,
//                 `Cannot move order from ${currentStatus} to ${newStatus}`
//             );
//         }

//         // If buyer is requesting return, unlock isSold flag
//         if (newStatus === ORDER_STATUS.RETURNED) {
//             for (const item of populatedOrder.items) {
//                 const product = item.productId;
//                 const sellerProduct = await SellProduct.findOne({ _id: product._id });
//                 if (sellerProduct?.saleType === 'fixed') {
//                     sellerProduct.isSold = false;
//                     await sellerProduct.save();
//                 }
//             }
//         }

//         // Create or get chat room for system message
//         const { room } = await findOrCreateOneOnOneRoom(buyerId, order.sellerId);

//         // Prepare system message based on new status
//         let messageTitle = '';
//         let messageTheme = 'info';
//         let additionalMeta = {};

//         switch (newStatus) {
//             case ORDER_STATUS.CONFIRM_RECEIPT:
//                 messageTitle = 'Order Received';
//                 messageTheme = 'success';
//                 break;
//             case ORDER_STATUS.RETURNED:
//                 messageTitle = 'Return Requested';
//                 messageTheme = 'warning';
//                 break;
//             default:
//                 messageTitle = `Order ${newStatus}`;
//                 break;
//         }

//         // Create system message
//         const systemMessage = new ChatMessage({
//             chatRoom: room._id,
//             messageType: 'ORDER_STATUS',
//             content: `Order status updated to ${newStatus}`,
//             systemMeta: {
//                 statusType: 'ORDER',
//                 status: newStatus,
//                 orderId: order._id,
//                 productId: order.items[0].productId,
//                 title: messageTitle,
//                 meta: {
//                     orderNumber: order._id.toString(),
//                     previousStatus: currentStatus,
//                     newStatus: newStatus,
//                     totalAmount: `$${(order.grandTotal || 0).toFixed(2)}`,
//                     itemCount: order.items.length,
//                     timestamp: new Date().toISOString(),
//                     ...additionalMeta
//                 },
//                 actions: [
//                     {
//                         label: "View Order",
//                         url: `/order/${order._id}`,
//                         type: "primary"
//                     }
//                 ],
//                 theme: messageTheme
//             }
//         });

//         // Start transaction
//         const session = await mongoose.startSession();
//         session.startTransaction();

//         try {
//             // Save the system message
//             await systemMessage.save({ session });

//             // Update chat room's last message
//             await ChatRoom.findByIdAndUpdate(
//                 room._id,
//                 {
//                     lastMessage: systemMessage._id,
//                     updatedAt: new Date()
//                 },
//                 { session }
//             );

//             // Save new status
//             order.status = newStatus;
//             await order.save({ session });

//             if (currentStatus !== newStatus) {
//                 await OrderStatusHistory.create([{
//                     orderId: order._id,
//                     oldStatus: currentStatus,
//                     newStatus,
//                     changedBy: req.user?.userId,
//                     note: 'Status updated by buyer'
//                 }], { session });
//             }

//             await session.commitTransaction();

//             // Emit socket events
//             const io = req.app.get('io');
//             await emitSystemMessage(io, systemMessage, room, order.sellerId, buyerId);

//             return apiSuccessRes(
//                 HTTP_STATUS.OK,
//                 res,
//                 newStatus === ORDER_STATUS.CONFIRM_RECEIPT
//                     ? "Order marked as received. Thank you for confirming receipt!"
//                     : "Order status updated successfully",
//                 {
//                     orderId: order._id,
//                     status: order.status,
//                 }
//             );
//         } catch (err) {
//             await session.abortTransaction();
//             throw err;
//         } finally {
//             session.endSession();
//         }
//     } catch (err) {
//         console.error("Update order status by buyer error:", err);
//         return apiErrorRes(
//             HTTP_STATUS.INTERNAL_SERVER_ERROR,
//             res,
//             err.message || "Failed to update order status"
//         );
//     }
// };

// Get detailed order info for UI




const updateOrderStatusByBuyer = async (req, res) => {
    try {
        const buyerId = req.user?.userId;
        const { orderId } = req.params;
        let { status: newStatus } = req.body;

        if (!newStatus) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Status is required");
        }

        const order = await Order.findOne({ _id: orderId, userId: buyerId })
            .populate('items.productId')
            .populate('sellerId');

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found for this buyer");
        }

        const currentStatus = order.status;

        if (currentStatus === newStatus) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order is already in this status");
        }

        // Populate product data
        const populatedOrder = await order.populate('items.productId');

        let allowedTransitions = [];

        if (currentStatus === ORDER_STATUS.SHIPPED) {
            // After shipped, buyer can confirm receipt (will auto-handle DELIVERED in background)
            allowedTransitions = [ORDER_STATUS.CONFIRM_RECEIPT];
        } else if (currentStatus === ORDER_STATUS.DELIVERED) {
            // After delivery, buyer can confirm receipt or request return
            allowedTransitions = [ORDER_STATUS.CONFIRM_RECEIPT, ORDER_STATUS.RETURNED];
        } else {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                `Buyers can only update orders after they are shipped or delivered`
            );
        }

        if (!allowedTransitions.includes(newStatus)) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                `Cannot move order from ${currentStatus} to ${newStatus}`
            );
        }

        // If user is confirming receipt from SHIPPED status, first mark as DELIVERED
        let shouldAutoDeliver = false;
        if (currentStatus === ORDER_STATUS.SHIPPED && newStatus === ORDER_STATUS.CONFIRM_RECEIPT) {
            shouldAutoDeliver = true;
        }

        // If buyer is requesting return, unlock isSold flag
        if (newStatus === ORDER_STATUS.RETURNED) {
            for (const item of populatedOrder.items) {
                const product = item.productId;
                const sellerProduct = await SellProduct.findOne({ _id: product._id });
                if (sellerProduct?.saleType === 'fixed') {
                    sellerProduct.isSold = false;
                    await sellerProduct.save();
                }
            }
        }

        // Create or get chat room for system message
        const { room } = await findOrCreateOneOnOneRoom(buyerId, order.sellerId);

        // Prepare system message based on new status
        let messageTitle = '';
        let messageTheme = 'info';
        let additionalMeta = {};

        switch (newStatus) {
            case ORDER_STATUS.DELIVERED:
                messageTitle = 'Order Delivered';
                messageTheme = 'success';
                break;
            case ORDER_STATUS.CONFIRM_RECEIPT:
                messageTitle = 'Order Received';
                messageTheme = 'success';
                break;
            case ORDER_STATUS.RETURNED:
                messageTitle = 'Return Requested';
                messageTheme = 'warning';
                break;
            default:
                messageTitle = `Order ${newStatus}`;
                break;
        }

        // Create system message
        const systemMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'ORDER_STATUS',
            content: `Order status updated to ${newStatus}`,
            systemMeta: {
                statusType: 'ORDER',
                status: newStatus,
                orderId: order._id,
                productId: order.items[0].productId,
                title: messageTitle,
                meta: {
                    orderNumber: order._id.toString(),
                    previousStatus: currentStatus,
                    newStatus: newStatus,
                    totalAmount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    itemCount: order.items.length,
                    timestamp: new Date().toISOString(),
                    ...additionalMeta
                },
                actions: [
                    {
                        label: "View Order",
                        url: `/order/${order._id}`,
                        type: "primary"
                    }
                ],
                theme: messageTheme
            }
        });

        // Start transaction
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // If auto-delivering, first update to DELIVERED status
            if (shouldAutoDeliver) {
                // First create DELIVERED status entry
                await OrderStatusHistory.create([{
                    orderId: order._id,
                    oldStatus: currentStatus,
                    newStatus: ORDER_STATUS.DELIVERED,
                    changedBy: req.user?.userId,
                    note: 'Auto-delivered during confirm receipt'
                }], { session });

                // Update order to DELIVERED first
                order.status = ORDER_STATUS.DELIVERED;
                await order.save({ session });

                // Create system message for DELIVERED status
                const deliveredMessage = new ChatMessage({
                    chatRoom: room._id,
                    messageType: 'ORDER_STATUS',
                    content: `Order status updated to ${ORDER_STATUS.DELIVERED}`,
                    systemMeta: {
                        statusType: 'ORDER',
                        status: ORDER_STATUS.DELIVERED,
                        orderId: order._id,
                        productId: order.items[0].productId,
                        title: 'Order Delivered',
                        meta: {
                            orderNumber: order._id.toString(),
                            previousStatus: currentStatus,
                            newStatus: ORDER_STATUS.DELIVERED,
                            totalAmount: `${(order.grandTotal || 0).toFixed(2)}`,
                            itemCount: order.items.length,
                            timestamp: new Date().toISOString(),
                            ...additionalMeta
                        },
                        actions: [
                            {
                                label: "View Order",
                                url: `/order/${order._id}`,
                                type: "primary"
                            }
                        ],
                        theme: 'success'
                    }
                });

                await deliveredMessage.save({ session });

                // Emit socket event for delivered status
                const io = req.app.get('io');
                await emitSystemMessage(io, deliveredMessage, room, order.sellerId, buyerId);
            }

            // Now handle the final status (CONFIRM_RECEIPT)
            // Save the system message for final status
            await systemMessage.save({ session });

            // Update chat room's last message
            await ChatRoom.findByIdAndUpdate(
                room._id,
                {
                    lastMessage: systemMessage._id,
                    updatedAt: new Date()
                },
                { session }
            );

            // Save final status
            order.status = newStatus;
            await order.save({ session });

            // Create status history for final status
            await OrderStatusHistory.create([{
                orderId: order._id,
                oldStatus: shouldAutoDeliver ? ORDER_STATUS.DELIVERED : currentStatus,
                newStatus,
                changedBy: req.user?.userId,
                note: 'Status updated by buyer'
            }], { session });

            await session.commitTransaction();

            // Emit socket events for final status
            const io = req.app.get('io');
            await emitSystemMessage(io, systemMessage, room, order.sellerId, buyerId);

            // Prepare success message
            let successMessage = "Order status updated successfully";
            if (newStatus === ORDER_STATUS.CONFIRM_RECEIPT) {
                successMessage = "Order marked as received. Thank you for confirming receipt!";
            }

            return apiSuccessRes(
                HTTP_STATUS.OK,
                res,
                successMessage,
                {
                    orderId: order._id,
                    status: order.status,
                }
            );
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    } catch (err) {
        console.error("Update order status by buyer error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to update order status"
        );
    }
};



const getOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'orderId is required');
        }

        // Fetch order with all necessary relations
        const order = await Order.findOne({ _id: orderId, isDeleted: false })
            .populate({
                path: 'items.productId',
                model: 'SellProduct',
                select: 'title productImages fixedPrice saleType auctionSettings shippingCharge deliveryType',
            })
            .populate({
                path: 'userId',
                select: 'userName profileImage isLive is_Id_verified is_Verified_Seller',
            })
            .populate({
                path: 'sellerId',
                select: 'userName profileImage isLive is_Id_verified is_Verified_Seller',
            })
            .populate({
                path: 'addressId',
                model: 'UserAddress',
            })
            .lean();

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Order not found');
        }

        // Shipping info
        const shipping = await Shipping.findOne({ orderId: order._id, isDeleted: false })
            .populate({ path: 'carrier', select: 'name' })
            .lean();

        // Status history
        const statusHistory = await OrderStatusHistory.find({ orderId: order._id })
            .sort({ changedAt: 1 })
            .populate({ path: 'changedBy', select: 'userName' })
            .lean();

        // Dispute info
        const dispute = await Dispute.findOne({ orderId: order._id, isDeleted: false }).lean();

        // Reviews (for each product in order)

        const reviews = await Promise.all(
            (order.items || []).map(async (item) => {
                const review = await ProductReview.findOne({ productId: item.productId?._id, userId: order.userId?._id, isDeleted: false });
                return review ? {
                    productId: item.productId?._id,
                    rating: review.rating,
                    reviewText: review.reviewText,
                    reviewImages: review.reviewImages,
                    createdAt: review.createdAt,
                } : null;
            })
        );

        // Fetch transaction info for this order
        const transaction = await Transaction.findOne({ orderId: order._id }).lean();

        // Format breakdown
        const breakdown = {
            item: order.totalAmount || 0,
            shipping: order.shippingCharge || 0,
            buyerProtectionFee: order.BuyerProtectionFee || 0,
            taxes: order.Tax || 0,
            total: order.grandTotal || 0,
        };

        // Format response
        const response = {
            status: order.status,
            paymentStatus: order.paymentStatus,
            orderId: order.orderId || String(order._id),
            orderDate: order.createdAt,
            paymentMethod: order.paymentMethod,
            paymentTime: order.updatedAt,
            seller: order.sellerId || null,
            buyer: order.userId || null,
            items: (order.items || []).map(item => ({
                title: item.productId?.title || '',
                image: item.productId?.productImages?.[0] || '',
                price: item.priceAtPurchase || 0,
                quantity: item.quantity || 1,
                saleType: item.productId?.saleType || '',
                auctionSettings: item.productId?.auctionSettings || null,
                shippingCharge: item.productId?.shippingCharge || 0,
                deliveryType: item.productId?.deliveryType || '',
            })),
            breakdown,
            address: order.addressId || null,
            shipping: shipping ? {
                carrier: shipping.carrier?.name || '',
                trackingNumber: shipping.trackingNumber || '',
                shippingDate: shipping.updatedAt || null,
                status: shipping.status || '',
            } : null,
            statusHistory: (statusHistory || []).map(h => ({
                oldStatus: h.oldStatus,
                newStatus: h.newStatus,
                changedBy: h.changedBy?.userName || '',
                changedAt: h.changedAt,
                note: h.note || '',
            })),
            dispute: dispute ? {
                status: dispute.status,
                reason: dispute.reason,
                description: dispute.description,
                resolved: dispute.status === 'resolved',
                createdAt: dispute.createdAt,
            } : null,
            reviews: reviews.filter(Boolean),
            transaction: transaction ? {
                transactionId: transaction._id,
                paymentGatewayId: transaction.paymentGatewayId,
                amount: transaction.amount,
                paymentMethod: transaction.paymentMethod,
                paymentStatus: transaction.paymentStatus,
                cardType: transaction.cardType || '',
                cardLast4: transaction.cardLast4 || '',
                createdAt: transaction.createdAt,
            } : null,
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Order details fetched', response);
    } catch (err) {
        console.error('Get order details error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || 'Failed to fetch order details');
    }
};

const retryOrderPayment = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user?.userId;

        if (!orderId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID is required");
        }

        // Find the order and validate
        const order = await Order.findOne({
            _id: orderId,
            userId: userId,
            isDeleted: false
        }).populate('items.productId');

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
        }

        // Check if payment can be retried
        if (![PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED].includes(order.paymentStatus)) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "Payment retry is only allowed for pending or failed payments"
            );
        }

        // Check if order is in valid status
        if (![ORDER_STATUS.PENDING, ORDER_STATUS.FAILED].includes(order.status)) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "Payment retry is only allowed for pending or failed orders"
            );
        }

        // Verify all products are still available
        for (const item of order.items) {
            const product = await SellProduct.findOne({
                _id: item.productId,
                isDeleted: false,
                isDisable: false
            });

            if (!product || product.isSold) {
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    `Product ${product?.title || 'Unknown'} is no longer available`
                );
            }
        }

        // Return order details needed for payment
        return apiSuccessRes(HTTP_STATUS.OK, res, "Order ready for payment retry", {
            orderId: order._id,
            amount: order.grandTotal,
            items: order.items.map(item => ({
                productId: item.productId._id,
                title: item.productId.title,
                quantity: item.quantity,
                price: item.priceAtPurchase
            }))
        });

    } catch (err) {
        console.error("Retry payment error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to process payment retry"
        );
    }
};







const confirmreciptReview = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user?.userId;
        if (!orderId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID is required");
        }


        const order = await Order.findOne({
            _id: orderId,
            userId: userId
        })
            .sort({ createdAt: -1 })
            .populate([
                {
                    path: 'items.productId',
                    model: 'SellProduct',
                    select: 'title productImages description fixedPrice saleType auctionSettings userId deliveryType'
                },
                {
                    path: 'userId',
                    select: 'userName profileImage isLive is_Id_verified is_Verified_Seller'
                }
            ])
            .lean();


        const shipping = await Shipping.findOne({ orderId: order._id, isDeleted: false })
            .populate({ path: 'carrier', select: 'name' })
            .lean();
        const reviews = await Promise.all(
            (order.items || []).map(async (item) => {
                const review = await ProductReview.findOne({ productId: item.productId?._id, userId: order.userId?._id, isDeleted: false });
                return review ? {
                    productId: item.productId?._id,
                    rating: review.rating,
                    reviewText: review.reviewText,
                    reviewImages: review.reviewImages,
                    createdAt: review.createdAt,
                } : null;
            })
        );
        let obj = {
            order,
            shipping,
            reviews
        }


        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
        }
        return apiSuccessRes(HTTP_STATUS.OK, res, 'Order details fetched', obj);



    } catch (err) {
        console.error("Retry payment error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to process payment retry"
        );
    }
}


const addrequest = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { withDrawMethodId, amount } = req.body;
        const userId = req.user.userId;

        await session.withTransaction(async () => {
            const user = await User.findById(userId).session(session);
            if (!user) {
                throw new Error("User not found");
            }

            if (amount > user.walletBalance) {
                throw new Error("Insufficient wallet balance");
            }

            const feeSettings = await FeeSetting.find({
                name: "WITHDRAWAL_FEE",
                isActive: true,
                isDisable: false,
                isDeleted: false
            }).session(session);

            const withDrawlSetting = feeSettings.find(f => f.name === "WITHDRAWAL_FEE");

            let withdrawfee = 0;
            let withdrawfeeType = '';

            if (withDrawlSetting) {
                if (withDrawlSetting.type === PRICING_TYPE.PERCENTAGE) {
                    withdrawfee = (amount * withDrawlSetting.value) / 100;
                    withdrawfeeType = PRICING_TYPE.PERCENTAGE;
                } else if (withDrawlSetting.type === PRICING_TYPE.FIXED) {
                    withdrawfee = withDrawlSetting.value;
                    withdrawfeeType = PRICING_TYPE.FIXED;
                }
            }
            const totalDeduction = Number(amount) + Number(withdrawfee);
            console.log("totalDeductiontotalDeduction", amount, withdrawfee, totalDeduction)

            if (totalDeduction > user.walletBalance) {
                throw new Error("Insufficient wallet balance including withdrawal fee");
            }

            user.walletBalance -= totalDeduction; WalletTnx
            user.FreezWalletBalance += amount;
            await user.save({ session });

            const newRequest = new SellerWithdrawl({
                userId,
                withDrawMethodId,
                amount,
                withdrawfee: withDrawlSetting.value,
                withdrawfeeType,
                status: 'pending'
            });

            await newRequest.save({ session });

            await trackWithdrawalRevenue(newRequest, withdrawfee, session);

            return apiSuccessRes(
                HTTP_STATUS.CREATED,
                res,
                "Withdraw request added successfully",
                newRequest
            );
        });

    } catch (err) {
        console.error("add request", err);
        // <-- Remove this line:
        // await session.abortTransaction();

        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to process withdrawal request"
        );
    } finally {
        session.endSession();
    }
};

const trackWithdrawalRevenue = async (withdrawalRequest, withdrawalFee, session) => {
    if (withdrawalFee > 0) {
        await PlatformRevenue.create([{
            withdrawalId: withdrawalRequest._id,
            revenueType: 'WITHDRAWAL_FEE',
            amount: withdrawalFee,
            calculationType: withdrawalRequest.withdrawfeeType,
            calculationValue: withdrawalRequest.withdrawfee,
            baseAmount: withdrawalRequest.amount,
            status: 'PENDING',
            description: `Withdrawal fee for request ${withdrawalRequest._id}`,
            metadata: {
                withdrawalAmount: withdrawalRequest.amount,
                sellerId: withdrawalRequest.userId
            }
        }], { session });
    }
};

const changeStatus = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        const { withdrawRequestId, status } = req.body;
        await session.withTransaction(async () => {
            const withdrawRequest = await SellerWithdrawl.findById(withdrawRequestId).session(session);
            if (!withdrawRequest) {
                throw new Error("Withdraw request not found");
            }
            if (withdrawRequest.status !== 'pending') {
                throw new Error("Request already processed");
            }

            const user = await User.findById(withdrawRequest.userId).session(session);
            if (!user) {
                throw new Error("User not found");
            }

            if (status === 'Approved') {
                user.FreezWalletBalance -= withdrawRequest.amount;
            } else if (status === 'Rejected') {
                let calculatedFee = 0;
                if (withdrawRequest.withdrawfeeType === PRICING_TYPE.PERCENTAGE) {
                    calculatedFee = (withdrawRequest.amount * withdrawRequest.withdrawfee) / 100;
                } else if (withdrawRequest.withdrawfeeType === PRICING_TYPE.FIXED) {
                    calculatedFee = withdrawRequest.withdrawfee;
                }

                const totalRefund = Number(withdrawRequest.amount) + Number(calculatedFee);
                user.FreezWalletBalance -= withdrawRequest.amount;
                user.walletBalance += totalRefund;
            }

            await user.save({ session });

            withdrawRequest.status = status;
            await withdrawRequest.save({ session });

            await WalletTnx.findOneAndUpdate(
                { sellerWithdrawlId: withdrawRequest._id },
                { tnxStatus: status === 'Approved' ? PAYMENT_STATUS.COMPLETED : PAYMENT_STATUS.REJECTED },
                { session }
            );

            await updateWithdrawalRevenue(withdrawRequest, status, session);
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, `Withdraw request ${status} successfully`);
    } catch (err) {
        console.error("changeStatus error", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to change withdrawal request status");
    } finally {
        session.endSession();
    }
};

const updateWithdrawalRevenue = async (withdrawalRequest, status, session) => {
    const revenueStatus = status === 'Approved' ? 'COMPLETED' : 'CANCELLED';
    await PlatformRevenue.updateMany(
        { withdrawalId: withdrawalRequest._id },
        {
            $set: {
                status: revenueStatus,
                completedAt: new Date()
            }
        },
        { session }
    );
};

const getWithdrawalInfo = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Fetch user wallet info
        const user = await User.findById(userId).select('walletBalance FreezWalletBalance').lean();
        if (!user) {
            return apiErrorRes(404, res, "User not found");
        }

        // Fetch active withdrawal methods for the user (example: SellerBank collection)
        const withdrawalMethods = await SellerBank.find({
            userId,
            isActive: true,
            isDeleted: false
        }).lean();

        // Fetch current active withdrawal fee settings
        const feeSetting = await FeeSetting.findOne({
            name: "WITHDRAWAL_FEE",
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).lean();

        const withdrawalFeeInfo = feeSetting
            ? {
                type: feeSetting.type,
                value: feeSetting.value
            }
            : null;

        return apiSuccessRes(200, res, "Withdrawal info fetched successfully", {
            walletBalance: user.walletBalance,
            FreezWalletBalance: user.FreezWalletBalance,
            withdrawalMethods,
            withdrawalFeeInfo
        });

    } catch (err) {
        console.error("getWithdrawalInfo error", err);
        return apiErrorRes(500, res, "Failed to fetch withdrawal info");
    }
};



const getAllWithdrawRequests = async (req, res) => {
    try {
        // Parse query params
        let { pageNo = 1, size = 10, minAmount, maxAmount, sortBy = 'createdAt', order = 'desc' } = req.query;
        pageNo = parseInt(pageNo);
        size = parseInt(size);

        // Build filter object
        const filter = {};
        if (minAmount !== undefined || maxAmount !== undefined) {
            filter.amount = {};
            if (minAmount !== undefined) filter.amount.$gte = Number(minAmount);
            if (maxAmount !== undefined) filter.amount.$lte = Number(maxAmount);
        }

        // Build sort object
        const sortOrder = order.toLowerCase() === 'asc' ? 1 : -1;
        const sort = {};
        sort[sortBy] = sortOrder;

        // Fetch total count for pagination info
        const total = await SellerWithdrawl.countDocuments(filter);

        // Fetch paginated data
        const data = await SellerWithdrawl.find(filter)
            .populate('userId', 'name email') // example: populate user name and email
            .populate('withDrawMethodId')     // populate withdrawal method info
            .sort(sort)
            .skip((pageNo - 1) * size)
            .limit(size)
            .lean();

        return apiSuccessRes(200, res, "Withdrawal requests fetched successfully", {
            pageNo,
            size,
            totalPages: Math.ceil(total / size),
            totalRecords: total,
            data
        });
    } catch (err) {
        console.error("getAllWithdrawRequests error", err);
        return apiErrorRes(500, res, "Failed to fetch withdrawal requests");
    }
};



//////////////////////////////////////////////////////////////////////////////
router.post('/previewOrder', perApiLimiter(), upload.none(), previewOrder);
router.post('/placeOrder', perApiLimiter(), upload.none(), createOrder);

router.post('/paymentCallback', paymentCallback);

router.post('/updateOrderStatusBySeller/:orderId', perApiLimiter(), upload.none(), updateOrderStatusBySeller);

router.get('/confirmreciptReview/:orderId', perApiLimiter(), upload.none(), confirmreciptReview);
router.post('/updateOrderStatusByBuyer/:orderId', perApiLimiter(), upload.none(), updateOrderStatusByBuyer);

router.get('/getSoldProducts', perApiLimiter(), upload.none(), getSoldProducts);
router.get('/getBoughtProduct', perApiLimiter(), upload.none(), getBoughtProducts);

router.get('/retryPayment/:orderId', perApiLimiter(), upload.none(), retryOrderPayment);
router.get('/details/:orderId', perApiLimiter(), upload.none(), getOrderDetails);

//////////////////////////////////////////////////////////////////////////////
/////////////////////////////******WALLET******///////////////////////////////
router.get('/getWithdrawalInfo', perApiLimiter(), upload.none(), getWithdrawalInfo);
router.post('/addrequest', perApiLimiter(), upload.none(), addrequest);
router.post('/changeStatus', perApiLimiter(), upload.none(), changeStatus);
router.get('/getAllWithdrawRequests', perApiLimiter(), upload.none(), getAllWithdrawRequests);







// router.post('/updateOrder/:orderId', perApiLimiter(), upload.none(), updateOrderById);
// router.post('/cancelAndRelistProduct', perApiLimiter(), upload.none(), cancelOrderAndRelistProducts);

module.exports = router;


// PENDING -> CONFIRMED -> SHIPPED -> DELIVERED sor seller
// SHIPPED -> CONFIRM_RECEIPT 