const express = require('express');
const multer = require('multer');
require('dotenv').config();
const upload = multer();
const router = express.Router();
const moment = require("moment")
const { UserAddress, Transaction, Order, SellProduct, Bid, FeeSetting, User, Shipping, OrderStatusHistory, ProductReview, ChatRoom, ChatMessage, WalletTnx, SellerWithdrawl, SellerBank, PlatformRevenue, Dispute, CancelType } = require('../../db');
const { findOrCreateOneOnOneRoom } = require('../services/serviceChat');
const { saveNotification } = require('../services/serviceNotification');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes, parseItems } = require('../../utils/globalFunction');
const { SALE_TYPE, DEFAULT_AMOUNT, PAYMENT_METHOD, ORDER_STATUS, PAYMENT_STATUS, CHARGE_TYPE, PRICING_TYPE, SHIPPING_STATUS, TNX_TYPE, NOTIFICATION_TYPES, createStandardizedChatMeta, createStandardizedNotificationMeta, DISPUTE_STATUS, DISPUTE_DECISION } = require('../../utils/Role');
const { default: mongoose } = require('mongoose');
const Joi = require('joi');
const { uploadImageCloudinary } = require('../../utils/cloudinary');




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
        const address = await UserAddress.findOne({ userId, _id: toObjectId(addressId) });
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
                title: "Order Created",
                orderId: order._id,
                productId: orderItems[0].productId, // First product in order
                meta: createStandardizedChatMeta({
                    orderNumber: order.orderId.toString(),
                    totalAmount: order.grandTotal,
                    amount: order.grandTotal,
                    itemCount: orderItems.length,
                    sellerId: sellerId,
                    buyerId: userId,
                    orderStatus: ORDER_STATUS.PENDING,
                    paymentStatus: order.paymentStatus,
                    paymentMethod: order.paymentMethod
                }),
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

        for (const item of orderItems) {
            await SellProduct.updateOne(
                { _id: item.productId },
                { $set: { isSold: true } },
                { session }
            );
        }


        await session.commitTransaction();


        const io = req.app.get('io');
        await emitSystemMessage(io, systemMessage, room, userId, sellerId);

        await trackOrderRevenue(order, feeMap, session);

        // Send notifications
        const notifications = [
            {
                recipientId: sellerId,
                userId: userId,
                orderId: order._id,
                productId: orderItems[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "New Order Received!",
                message: `You have received a new order for ${orderItems.length} item(s). Order amount: $${order.grandTotal.toFixed(2)}`,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    itemCount: orderItems.length,
                    totalAmount: order.grandTotal,
                    amount: order.grandTotal,
                    sellerId: sellerId,
                    buyerId: userId,
                    status: ORDER_STATUS.PENDING,
                    newStatus: ORDER_STATUS.PENDING,
                    paymentMethod: order.paymentMethod,
                    paymentStatus: order.paymentStatus
                }),
                redirectUrl: `/order/${order._id}`
            }
        ];
        await saveNotification(notifications);

        // Send payment pending message if payment is not completed
        if (order.paymentStatus !== PAYMENT_STATUS.COMPLETED) {
            const payNowMessage = new ChatMessage({
                chatRoom: room._id,
                messageType: 'PAYMENT_STATUS',
                systemMeta: {
                    statusType: 'PAYMENT',
                    status: PAYMENT_STATUS.PENDING,
                    orderId: order._id,
                    productId: orderItems[0].productId,
                    title: 'Payment Pending',
                    meta: createStandardizedChatMeta({
                        orderNumber: order._id.toString(),
                        totalAmount: order.grandTotal,
                        amount: order.grandTotal,
                        itemCount: orderItems.length,
                        sellerId: sellerId,
                        buyerId: userId,
                        orderStatus: order.status,
                        paymentStatus: order.paymentStatus,
                        paymentMethod: order.paymentMethod
                    }),
                    actions: [
                        {
                            label: 'Pay Now',
                            url: `/payment/retry/${order._id}`,
                            type: 'primary'
                        }
                    ],
                    theme: 'warning',
                    content: 'Payment Pending. Pay now. Unpaid orders will be cancelled within 24 hours.'
                }
            });
            await payNowMessage.save();
            await ChatRoom.findByIdAndUpdate(
                room._id,
                {
                    lastMessage: payNowMessage._id,
                    updatedAt: new Date()
                }
            );
            await emitSystemMessage(io, payNowMessage, room, userId, sellerId);
        }

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




// Beam Payment Gateway Webhook Handler
const beamPaymentWebhook = async (req, res) => {
    try {
        console.log("Beam Payment Webhook received:", req.body);

        const { event, data } = req.body;

        if (!event || !data) {
            return res.status(400).json({ error: 'Invalid webhook payload' });
        }

        // Get the redirect preference from query params
        const shouldRedirect = req.query.redirect !== 'false';

        // Handle different Beam events
        switch (event) {
            case 'charge.succeeded':
            case 'payment_link.paid':
            case 'purchase.succeeded':
                await handleBeamPaymentSuccess(data, req);
                if (shouldRedirect) {
                    return res.redirect(`/payment-success.html?orderId=${data.referenceId}&paymentId=${data.chargeId || data.id}&amount=${data.amount || data.total}`);
                }
                break;
            case 'charge.failed':
            case 'payment.failed':
                await handleBeamPaymentFailure(data, req);
                if (shouldRedirect) {
                    return res.redirect(`/payment-cancel.html?orderId=${data.referenceId}&amount=${data.amount || data.total}&reason=${data.failureCode || 'payment_failed'}`);
                }
                break;
            default:
                console.log(`Unhandled Beam event: ${event}`);
                if (shouldRedirect) {
                    return res.redirect(`/payment-cancel.html?reason=invalid_event`);
                }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error('Beam webhook error:', error);
        if (shouldRedirect) {
            return res.redirect(`/payment-cancel.html?reason=server_error`);
        }
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
};

const handleBeamPaymentSuccess = async (paymentData, req) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Extract order information from payment data according to Beam API structure
        // The order ID should be in the referenceId field as per OpenAPI spec
        const orderId = paymentData.referenceId ||
            paymentData.order?.referenceId ||
            paymentData.metadata?.orderId ||
            paymentData.order_id ||
            paymentData.reference;
        const paymentId = paymentData.chargeId ||
            paymentData.id ||
            paymentData.payment_id ||
            paymentData.transaction_id;
        const amount = paymentData.amount || paymentData.total;

        if (!orderId) {
            throw new Error('Order ID not found in payment data');
        }

        const order = await Order.findOne({ _id: orderId })
            .populate('userId')
            .populate('sellerId')
            .session(session);

        if (!order) {
            throw new Error(`Order not found: ${orderId}`);
        }

        if (order.paymentStatus === PAYMENT_STATUS.COMPLETED) {
            console.log(`Payment already completed for order: ${orderId}`);
            await session.abortTransaction();
            return;
        }

        // Update order payment info
        order.paymentStatus = PAYMENT_STATUS.COMPLETED;
        order.paymentId = paymentId;
        order.paymentGateway = 'beam';

        await order.save({ session });

        // Create or get chat room between buyer and seller
        const { room } = await findOrCreateOneOnOneRoom(order.userId, order.sellerId);

        // Create system message for payment success
        const systemMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'PAYMENT_STATUS',
            systemMeta: {
                statusType: 'PAYMENT',
                status: PAYMENT_STATUS.COMPLETED,
                orderId: order._id,
                productId: order.items[0].productId,
                title: 'Payment Completed',
                meta: createStandardizedChatMeta({
                    orderNumber: order._id.toString(),
                    totalAmount: order.grandTotal,
                    amount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    itemCount: order.items.length,
                    paymentId: paymentId,
                    paymentMethod: 'Beam Payment',
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    orderStatus: order.status,
                    paymentStatus: PAYMENT_STATUS.COMPLETED
                }),
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

        await updateOrderRevenue(order, PAYMENT_STATUS.COMPLETED, session);
        await session.commitTransaction();

        // Post-transaction operations
        await Transaction.create({
            orderId: order._id,
            userId: order.userId,
            amount: order.grandTotal,
            paymentMethod: 'beam',
            paymentStatus: PAYMENT_STATUS.COMPLETED,
            paymentGatewayId: paymentId
        });

        const io = req.app.get('io');
        await emitSystemMessage(io, systemMessage, room, order.userId, order.sellerId);

        // Send shipping pending message if needed
        const populatedOrder = await Order.findById(order._id)
            .populate('items.productId', 'deliveryType title');

        const hasShippingProducts = populatedOrder.items.some(
            item => item.productId?.deliveryType !== 'local pickup'
        );

        if (hasShippingProducts) {
            const shippingPendingMessage = new ChatMessage({
                chatRoom: room._id,
                messageType: 'ORDER_STATUS',
                systemMeta: {
                    statusType: 'SHIPPING',
                    status: 'PENDING',
                    orderId: order._id,
                    productId: order.items[0].productId,
                    title: 'Shipping Pending',
                    meta: createStandardizedChatMeta({
                        orderNumber: order._id.toString(),
                        totalAmount: order.grandTotal,
                        amount: order.grandTotal,
                        itemCount: order.items.length,
                        sellerId: order.sellerId,
                        buyerId: order.userId,
                        orderStatus: order.status,
                        paymentStatus: order.paymentStatus,
                        paymentMethod: 'beam'
                    }),
                    actions: [
                        {
                            label: "View Order",
                            url: `/order/${order._id}`,
                            type: "primary"
                        }
                    ],
                    theme: 'info',
                    content: 'Shipping is pending. The seller will ship your items soon.'
                }
            });

            await shippingPendingMessage.save();
            await ChatRoom.findByIdAndUpdate(
                room._id,
                {
                    lastMessage: shippingPendingMessage._id,
                    updatedAt: new Date()
                }
            );
            await emitSystemMessage(io, shippingPendingMessage, room, order.userId, order.sellerId);
        }

    } catch (error) {
        await session.abortTransaction();
        console.error('Beam payment success handler error:', error);
        throw error;
    } finally {
        session.endSession();
    }
};

const handleBeamPaymentFailure = async (paymentData, req) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Extract order information from payment data according to Beam API structure
        const orderId = paymentData.referenceId ||
            paymentData.order?.referenceId ||
            paymentData.metadata?.orderId ||
            paymentData.order_id ||
            paymentData.reference;
        const paymentId = paymentData.chargeId ||
            paymentData.id ||
            paymentData.payment_id ||
            paymentData.transaction_id;
        const failureReason = paymentData.failureCode ||
            paymentData.failure_reason ||
            paymentData.error_message ||
            'Payment failed';

        if (!orderId) {
            throw new Error('Order ID not found in payment data');
        }

        const order = await Order.findOne({ _id: orderId })
            .populate('userId')
            .populate('sellerId')
            .session(session);

        if (!order) {
            throw new Error(`Order not found: ${orderId}`);
        }

        // Update order payment info
        order.paymentStatus = PAYMENT_STATUS.FAILED;
        order.status = ORDER_STATUS.FAILED;
        order.paymentId = paymentId;

        await order.save({ session });

        // Create system message for payment failure
        const { room } = await findOrCreateOneOnOneRoom(order.userId, order.sellerId);
        const systemMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'PAYMENT_STATUS',
            systemMeta: {
                statusType: 'PAYMENT',
                status: PAYMENT_STATUS.FAILED,
                orderId: order._id,
                productId: order.items[0].productId,
                title: 'Payment Failed',
                meta: createStandardizedChatMeta({
                    orderNumber: order._id.toString(),
                    totalAmount: order.grandTotal,
                    failureReason: failureReason,
                    sellerId: order.sellerId,
                    buyerId: order.userId
                }),
                actions: [
                    {
                        label: "Try Payment Again",
                        url: `/payment/retry/${order._id}`,
                        type: "primary"
                    }
                ],
                theme: 'error'
            }
        });

        await systemMessage.save({ session });
        await ChatRoom.findByIdAndUpdate(
            room._id,
            { lastMessage: systemMessage._id, updatedAt: new Date() },
            { session }
        );

        await updateOrderRevenue(order, PAYMENT_STATUS.FAILED, session);
        await session.commitTransaction();

        const io = req.app.get('io');
        await emitSystemMessage(io, systemMessage, room, order.userId, order.sellerId);

    } catch (error) {
        await session.abortTransaction();
        console.error('Beam payment failure handler error:', error);
        throw error;
    } finally {
        session.endSession();
    }
};



// Initialize Beam Payment
const initiateBeamPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        const userId = req.user.userId;

        const order = await Order.findOne({
            _id: orderId,
            userId: userId,
            paymentStatus: PAYMENT_STATUS.PENDING
        });

        console.log("Order found:", order);

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found or already paid");
        }

        // Prepare payment data according to Beam API OpenAPI specification
        const paymentData = {
            order: {
                currency: 'THB', // Required field
                netAmount: Math.round(order.grandTotal * 100), // Convert to smallest currency unit (satang)
                referenceId: order._id.toString(), // Move to order object
                description: `Order payment for ${order._id}`, // Optional description
            },
            redirectUrl: `${process.env.BASE_URL}/payment/beam/callback?orderId=${order._id}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour expiry
            collectDeliveryAddress: false,
            feeType: 'TRANSACTION_FEE',
            linkSettings: {
                qrPromptPay: { isEnabled: true },
                // card: { isEnabled: true },
                // mobileBanking: { isEnabled: true },
                // trueMoney: { isEnabled: true }

            }
        };

        console.log('Sending payment data:', JSON.stringify(paymentData, null, 2));

        const beamResponse = await createBeamPaymentLink(paymentData);

        if (beamResponse.success) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "Payment link created successfully", {
                paymentUrl: beamResponse.url,
                paymentId: beamResponse.id,
                orderId: order._id
            });
        } else {
            console.error('Beam payment error:', beamResponse.error, beamResponse.details);
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Failed to create payment link", beamResponse.details);
        }

    } catch (error) {
        console.error("Beam payment initiation error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to initiate payment");
    }
};

const createBeamPaymentLink = async (paymentData) => {

    try {
        const merchantId = process.env.BEAM_MERCHANT_ID?.trim();
        const apiKey = process.env.BEAM_API_KEY?.trim();

        if (!merchantId || !apiKey) {
            throw new Error('Missing BEAM_MERCHANT_ID or BEAM_API_KEY in environment variables');
        }

        if (apiKey.length < 20) {
            throw new Error('BEAM_API_KEY appears too short – check your API key');
        }

        if (!paymentData.order || !paymentData.order.currency || !paymentData.order.netAmount) {
            throw new Error('Invalid payment data: missing required order fields');
        }

        const apiUrl =
            'https://playground.api.beamcheckout.com/api/v1/payment-links'
        // 'https://api.beamcheckout.com/api/v1/payment-links'

        const idempotencyKey = `order_${paymentData.order.referenceId}_${Date.now()}`;

        const headers = {
            'Authorization': 'Basic ' + Buffer.from(`${merchantId}:${apiKey}`).toString('base64'),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Kudsun-Platform/1.0',
            'x-beam-idempotency-key': idempotencyKey
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(paymentData)
        });

        const data = await response.json();

        console.log("testing=======>>", response)



        if (!response.ok) {
            let errorMessage = data?.error?.errorMessage || data?.message || `HTTP ${response.status}: ${response.statusText}`;

            return {
                success: false,
                error: errorMessage,
                details: data,
                statusCode: response.status
            };
        }

        return {
            success: true,
            url: data.url,
            id: data.id
        };
    } catch (error) {
        console.error('Beam API connection error:', error);
        return {
            success: false,
            error: error.message || 'API connection failed'
        };
    }
};








// Update the existing paymentCallback to handle Beam webhooks
const originalPaymentCallback = async (req, res) => {
    // Check if this is a Beam webhook
    if (req.body.event && req.body.data) {
        return beamPaymentWebhook(req, res);
    }

    // Get the redirect preference from query params
    const shouldRedirect = req.query.redirect !== 'false';

    // Existing payment callback logic for other gateways
    const schema = Joi.object({
        orderId: Joi.string().required(),
        paymentStatus: Joi.string().valid(PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.FAILED).required(),
        paymentId: Joi.string().required(),
        cardType: Joi.string().required(),
        cardLast4: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
        if (shouldRedirect) {
            return res.redirect(`/payment-cancel.html?orderId=${req.body.orderId || ''}&reason=invalid_request`);
        }
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);
    }

    console.log("value", value)

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
                meta: createStandardizedChatMeta({
                    orderNumber: order._id.toString(),
                    totalAmount: order.grandTotal,
                    amount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    itemCount: order.items.length,
                    paymentId: paymentId,
                    paymentMethod: order.paymentMethod,
                    cardInfo: paymentStatus === PAYMENT_STATUS.COMPLETED ? `${cardType} ending in ${cardLast4}` : null,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    orderStatus: order.status,
                    paymentStatus: paymentStatus
                }),
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

        // Send shipping pending message if payment is completed and products require shipping
        if (paymentStatus === PAYMENT_STATUS.COMPLETED) {
            // Populate order with product details to check deliveryType
            const populatedOrder = await Order.findById(order._id)
                .populate('items.productId', 'deliveryType title');

            // Check if any products require shipping (not local pickup)
            const hasShippingProducts = populatedOrder.items.some(
                item => item.productId?.deliveryType !== 'local pickup'
            );

            if (hasShippingProducts) {
                const shippingPendingMessage = new ChatMessage({
                    chatRoom: room._id,
                    messageType: 'ORDER_STATUS',
                    systemMeta: {
                        statusType: 'SHIPPING',
                        status: 'PENDING',
                        orderId: order._id,
                        productId: order.items[0].productId,
                        title: 'Shipping Pending',
                        meta: createStandardizedChatMeta({
                            orderNumber: order._id.toString(),
                            totalAmount: order.grandTotal,
                            amount: order.grandTotal,
                            itemCount: order.items.length,
                            sellerId: order.sellerId,
                            buyerId: order.userId,
                            orderStatus: order.status,
                            paymentStatus: order.paymentStatus,
                            paymentMethod: order.paymentMethod
                        }),
                        actions: [
                            {
                                label: "View Order",
                                url: `/order/${order._id}`,
                                type: "primary"
                            }
                        ],
                        theme: 'info',
                        content: 'Shipping is pending. The seller will ship your items soon.'
                    }
                });

                await shippingPendingMessage.save();
                await ChatRoom.findByIdAndUpdate(
                    room._id,
                    {
                        lastMessage: shippingPendingMessage._id,
                        updatedAt: new Date()
                    }
                );
                await emitSystemMessage(io, shippingPendingMessage, room, order.userId, order.sellerId);
            }
        }

        // Send notifications for payment status
        const paymentNotifications = [];

        if (paymentStatus === PAYMENT_STATUS.COMPLETED) {
            // Notify buyer
            paymentNotifications.push({
                recipientId: order.userId,
                userId: order.sellerId,
                orderId: order._id,
                productId: order.items[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Payment Successful!",
                message: `Your payment of $${order.grandTotal.toFixed(2)} has been processed successfully. Your order is now being prepared.`,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    amount: order.grandTotal,
                    totalAmount: order.grandTotal,
                    paymentMethod: order.paymentMethod,
                    paymentId: paymentId,
                    cardType: cardType,
                    cardLast4: cardLast4,
                    status: paymentStatus,
                    newStatus: paymentStatus,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    itemCount: order.items.length
                }),
                redirectUrl: `/order/${order._id}`
            });

            // Notify seller
            paymentNotifications.push({
                recipientId: order.sellerId,
                userId: order.userId,
                orderId: order._id,
                productId: order.items[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Payment Received!",
                message: `Payment of $${order.grandTotal.toFixed(2)} has been received for your order. Please prepare the items for shipment.`,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    amount: order.grandTotal,
                    totalAmount: order.grandTotal,
                    itemCount: order.items.length,
                    paymentMethod: order.paymentMethod,
                    paymentId: paymentId,
                    cardType: cardType,
                    cardLast4: cardLast4,
                    status: paymentStatus,
                    newStatus: paymentStatus,
                    sellerId: order.sellerId,
                    buyerId: order.userId
                }),
                redirectUrl: `/order/${order._id}`
            });
        } else if (paymentStatus === PAYMENT_STATUS.FAILED) {
            // Notify buyer about failed payment
            paymentNotifications.push({
                recipientId: order.userId,
                userId: order.sellerId,
                orderId: order._id,
                productId: order.items[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Payment Failed",
                message: `Your payment of $${order.grandTotal.toFixed(2)} could not be processed. Please try again or use a different payment method.`,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    amount: order.grandTotal,
                    totalAmount: order.grandTotal,
                    paymentMethod: order.paymentMethod,
                    status: paymentStatus,
                    newStatus: paymentStatus,
                    sellerId: order.sellerId,
                    buyerId: order.userId,
                    itemCount: order.items.length
                }),
                redirectUrl: `/payment/retry/${order._id}`
            });
        }

        if (paymentNotifications.length > 0) {
            await saveNotification(paymentNotifications);
        }

        if (shouldRedirect) {
            if (paymentStatus === PAYMENT_STATUS.COMPLETED) {
                return res.redirect(`/payment-success.html?orderId=${order._id}&paymentId=${paymentId}&amount=${order.grandTotal}`);
            } else {
                return res.redirect(`/payment-cancel.html?orderId=${order._id}&amount=${order.grandTotal}&reason=payment_failed`);
            }
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Payment status updated", {
            orderId: order._id,
            paymentStatus: order.paymentStatus,
            orderStatus: order.status,
        });
    } catch (err) {
        await session.abortTransaction();
        console.error("Payment callback error:", err);
        if (shouldRedirect) {
            return res.redirect(`/payment-cancel.html?orderId=${orderId}&reason=server_error`);
        }
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


        const orderIds = orders.map(o => o._id);


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
                // Still waiting for payment ⇒ always show "Pay now"
                order.labalStatuses = 'Unpaid';
                order.allowedNextStatuses = 'Pay now';
            } else if (!order.isReviewed) {
                // order.labalStatuses = 'Unreviewed';

                if (order.status == ORDER_STATUS.SHIPPED) {
                    order.labalStatuses = 'Shipped';

                    order.allowedNextStatuses =
                        'Confirm Receipt';

                } else if (order.status == ORDER_STATUS.DELIVERED) {
                    order.labalStatuses = 'Shipped';

                    order.allowedNextStatuses =
                        "Confirm Receipt";

                } else if (ORDER_STATUS.CONFIRM_RECEIPT) {
                    order.labalStatuses = 'Unreviewed';

                    order.allowedNextStatuses =
                        ALLOWED_BUYER_NEXT_STATUSES[order.status] || '';

                }

                if (order.status == ORDER_STATUS.DISPUTE) {
                    order.labalStatuses = 'Disputed';
                    order.allowedNextStatuses = "";

                }
                // No payment due and not reviewed yet ⇒ show normal progression

            } else {
                // Already reviewed ⇒ no further action
                order.allowedNextStatuses = '';
            }
            if (order.status == ORDER_STATUS.PENDING || order.status == ORDER_STATUS.CONFIRMED) {
                order.labalStatuses = 'Unsent';


            }


            if (order.status == ORDER_STATUS.COMPLETED) {
                order.labalStatuses = 'Completed';


            }

            if (order.status == ORDER_STATUS.CANCELLED) {
                order.labalStatuses = 'Cancelled';


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
        const address = await UserAddress.findOne({ userId, isActive: true }).populate([
            { path: 'provinceId', select: 'value' },
            { path: 'districtId', select: 'value' }
        ]);

        // const address = await UserAddress.findOne({ userId, isActive: true, _id: toObjectId(addressId) });
        // if (!address) {
        //     return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Address not found');
        // }

        const productIds = items.map(i => toObjectId(i.productId));

        let totalAmount = 0;
        const previewItems = [];


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
            // paymentStatus: PAYMENT_STATUS.COMPLETED
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

        const orderIds = orders.map(o => o._id);





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



            // Compute allowed next statuses based on current order status and delivery types
            const currentStatus = order.status;
            const paymentStatuss = order.paymentStatus;


            const allLocalPickup = order.items.every(item => item.productId?.deliveryType === "local pickup");

            order.items.forEach((item) => {
                order.isReviewed = reviewedSet.has(item.productId?._id?.toString());

            });



            let allowedNextStatuses = '';
            let labalStatuses = ''






            if (currentStatus === ORDER_STATUS.PENDING) {
                labalStatuses = ''
                allowedNextStatuses = ORDER_STATUS.CONFIRMED;
            } else if (currentStatus === ORDER_STATUS.CONFIRMED) {
                if (allLocalPickup) {
                    allowedNextStatuses = ORDER_STATUS.DELIVERED;
                } else {
                    labalStatuses = "Unsent"

                    allowedNextStatuses = ORDER_STATUS.SHIPPED;
                }
            }

            if (!order.isReviewed && (order.status == ORDER_STATUS.DELIVERED || order.status == ORDER_STATUS.CONFIRM_RECEIPT)) {
                // if you need multiple actions, turn this into an array.
                labalStatuses = "Unreviewed"
                allowedNextStatuses = "REVIEW";
            }

            if (order.status == ORDER_STATUS.DISPUTE) {

                let disputeData = await Dispute.findOne({ orderId: order?._id })
                if (disputeData?.sellerResponse?.responseType) {
                    labalStatuses = "Disputed"
                    allowedNextStatuses = ""
                } else {
                    labalStatuses = "Disputed"
                    allowedNextStatuses = "Response"
                }
            }

            if (order.status == ORDER_STATUS.COMPLETED) {
                labalStatuses = "Completed"
                allowedNextStatuses = ""

            }

            if (order.status == ORDER_STATUS.CANCELLED) {
                labalStatuses = 'Cancelled';
                allowedNextStatuses = ""
            }



            // if (order.paymentStatus == PAYMENT_STATUS.PENDING) {
            //     labalStatuses = "InProgress"
            //     allowedNextStatuses = ""
            // }
            // else
            if (currentStatus === ORDER_STATUS.SHIPPED) {
                labalStatuses = "Shipped";
                allowedNextStatuses = ""
            }
            // else {
            //     allowedNextStatuses = ALLOWED_NEXT_STATUSES[currentStatus] || [];
            // }


            if (paymentStatuss === PAYMENT_STATUS.PENDING) {
                labalStatuses = 'Payment Pending',
                    allowedNextStatuses = ""
            }

            order.allowedNextStatuses = allowedNextStatuses;

            order.labalStatuses = labalStatuses;

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
                meta: createStandardizedChatMeta({
                    orderNumber: order._id.toString(),
                    previousStatus: currentStatus,
                    newStatus: newStatus,
                    totalAmount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    amount: order.grandTotal,
                    itemCount: order.items.length,
                    sellerId: sellerId,
                    buyerId: order.userId,
                    orderStatus: newStatus,
                    paymentStatus: order.paymentStatus,
                    paymentMethod: order.paymentMethod,
                    ...additionalMeta
                }),
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

            // Use product cost only for seller payout calculation (not grand total)
            // const productCost = order.totalAmount || 0; // This is the original product cost
            // let serviceCharge = 0;
            // let serviceType = '';

            // let taxAmount = 0;
            // let taxType = '';


            // if (newStatus === ORDER_STATUS.DELIVERED || newStatus === ORDER_STATUS.CONFIRMED) {
            //     const feeSettings = await FeeSetting.find({
            //         name: { $in: ["SERVICE_CHARGE", "TAX"] },
            //         isActive: true,
            //         isDisable: false,
            //         isDeleted: false
            //     });
            //     const serviceChargeSetting = feeSettings.find(f => f.name === "SERVICE_CHARGE");
            //     const taxSetting = feeSettings.find(f => f.name === "TAX");

            //     if (serviceChargeSetting) {
            //         if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
            //             serviceCharge = (productCost * serviceChargeSetting.value) / 100;
            //             serviceType = PRICING_TYPE.PERCENTAGE
            //         } else if (serviceChargeSetting.type === PRICING_TYPE.FIXED) {
            //             serviceCharge = serviceChargeSetting.value;
            //             serviceType = PRICING_TYPE.FIXED
            //         }
            //     }

            //     if (taxSetting) {
            //         if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
            //             taxAmount = (productCost * taxSetting.value) / 100;
            //             taxType = PRICING_TYPE.PERCENTAGE
            //         } else if (taxSetting.type === PRICING_TYPE.FIXED) {
            //             taxAmount = taxSetting.value;
            //             taxType = PRICING_TYPE.FIXED
            //         }
            //     }

            //     const netAmount = productCost - serviceCharge - taxAmount;

            //     const sellerWalletTnx = new WalletTnx({
            //         orderId: order._id,
            //         userId: sellerId,
            //         amount: productCost, // Original product cost
            //         netAmount: netAmount, // After deducting platform fees
            //         serviceCharge,
            //         taxCharge: taxAmount,
            //         tnxType: TNX_TYPE.CREDIT,
            //         serviceType: serviceType,
            //         taxType: taxType,
            //         tnxStatus: PAYMENT_STATUS.COMPLETED
            //     });
            //     await sellerWalletTnx.save({ session });

            //     await User.findByIdAndUpdate(
            //         sellerId,
            //         {
            //             $inc: { walletBalance: netAmount } // increment walletBalance by net earnings
            //         },
            //         { session }
            //     );


            // }


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

            // Send review pending message if order is delivered
            if (newStatus === ORDER_STATUS.DELIVERED) {
                const reviewPendingMessage = new ChatMessage({
                    chatRoom: room._id,
                    messageType: 'REVIEW_STATUS',
                    systemMeta: {
                        statusType: 'REVIEW',
                        status: 'PENDING',
                        orderId: order._id,
                        productId: order.items[0].productId,
                        title: 'Review Pending',
                        meta: createStandardizedChatMeta({
                            orderNumber: order._id.toString(),
                            totalAmount: order.grandTotal,
                            amount: order.grandTotal,
                            itemCount: order.items.length,
                            sellerId: sellerId,
                            buyerId: order.userId,
                            orderStatus: newStatus,
                            paymentStatus: order.paymentStatus,
                            paymentMethod: order.paymentMethod
                        }),
                        actions: [
                            {
                                label: "Confirm Receipt",
                                url: `/order/${order._id}/confirm-receipt`,
                                type: "primary"
                            },
                            {
                                label: "View Order",
                                url: `/order/${order._id}`,
                                type: "secondary"
                            }
                        ],
                        theme: 'info',
                        content: 'Review is pending. Please confirm receipt and leave a review for this order.'
                    }
                });

                await reviewPendingMessage.save();
                await ChatRoom.findByIdAndUpdate(
                    room._id,
                    {
                        lastMessage: reviewPendingMessage._id,
                        updatedAt: new Date()
                    }
                );
                await emitSystemMessage(io, reviewPendingMessage, room, order.userId, sellerId);
            }

            // Send notification to buyer about status change
            let notificationTitle = '';
            let notificationMessage = '';

            switch (newStatus) {
                case ORDER_STATUS.CONFIRMED:
                    notificationTitle = "Order Confirmed!";
                    notificationMessage = `Your order has been confirmed by the seller and is being prepared for shipment.`;
                    break;
                case ORDER_STATUS.SHIPPED:
                    notificationTitle = "Order Shipped!";
                    notificationMessage = `Your order has been shipped and is on its way to you.`;
                    if (req.body.trackingNumber) {
                        notificationMessage += ` Tracking number: ${req.body.trackingNumber}`;
                    }
                    break;
                case ORDER_STATUS.DELIVERED:
                    notificationTitle = "Order Delivered!";
                    notificationMessage = `Your order has been delivered! Please confirm receipt when you receive it.`;
                    break;
                case ORDER_STATUS.CANCELLED:
                    notificationTitle = "Order Cancelled";
                    notificationMessage = `Your order has been cancelled by the seller. You will receive a full refund if payment was already processed.`;
                    break;
                default:
                    notificationTitle = "Order Status Updated";
                    notificationMessage = `Your order status has been updated to ${newStatus}.`;
            }

            const statusNotifications = [{
                recipientId: order.userId,
                userId: sellerId,
                orderId: order._id,
                productId: order.items[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: notificationTitle,
                message: notificationMessage,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    oldStatus: currentStatus,
                    newStatus: newStatus,
                    trackingNumber: req.body.trackingNumber || null,
                    carrier: req.body.carrierId || null,
                    sellerId: sellerId,
                    buyerId: order.userId,
                    totalAmount: order.grandTotal,
                    amount: order.grandTotal,
                    itemCount: order.items.length,
                    paymentMethod: order.paymentMethod,
                    status: newStatus,
                    actionBy: 'seller'
                }),
                redirectUrl: `/order/${order._id}`,

            }];

            await saveNotification(statusNotifications);

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
                meta: createStandardizedChatMeta({
                    orderNumber: order._id.toString(),
                    previousStatus: currentStatus,
                    newStatus: newStatus,
                    totalAmount: `$${(order.grandTotal || 0).toFixed(2)}`,
                    amount: order.grandTotal,
                    itemCount: order.items.length,
                    sellerId: order.sellerId,
                    buyerId: buyerId,
                    orderStatus: newStatus,
                    paymentStatus: order.paymentStatus,
                    paymentMethod: order.paymentMethod,
                    ...additionalMeta
                }),
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
                        meta: createStandardizedChatMeta({
                            orderNumber: order._id.toString(),
                            previousStatus: currentStatus,
                            newStatus: ORDER_STATUS.DELIVERED,
                            totalAmount: `${(order.grandTotal || 0).toFixed(2)}`,
                            amount: order.grandTotal,
                            itemCount: order.items.length,
                            sellerId: order.sellerId,
                            buyerId: buyerId,
                            orderStatus: ORDER_STATUS.DELIVERED,
                            paymentStatus: order.paymentStatus,
                            paymentMethod: order.paymentMethod,
                            ...additionalMeta
                        }),
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

            // Send review pending message for both buyer and seller if order is confirmed receipt
            if (newStatus === ORDER_STATUS.CONFIRM_RECEIPT) {
                const reviewPendingMessage = new ChatMessage({
                    chatRoom: room._id,
                    messageType: 'REVIEW_STATUS',
                    systemMeta: {
                        statusType: 'REVIEW',
                        status: 'PENDING',
                        orderId: order._id,
                        productId: order.items[0].productId,
                        title: 'Reviews Pending',
                        meta: createStandardizedChatMeta({
                            orderNumber: order._id.toString(),
                            totalAmount: order.grandTotal,
                            amount: order.grandTotal,
                            itemCount: order.items.length,
                            sellerId: order.sellerId,
                            buyerId: buyerId,
                            orderStatus: newStatus,
                            paymentStatus: order.paymentStatus,
                            paymentMethod: order.paymentMethod
                        }),
                        actions: [
                            {
                                label: "Leave Review",
                                url: `/order/${order._id}/review`,
                                type: "primary"
                            },
                            {
                                label: "View Order",
                                url: `/order/${order._id}`,
                                type: "secondary"
                            }
                        ],
                        theme: 'info',
                        content: 'Reviews are pending. Both buyer and seller can now leave reviews for this completed transaction.'
                    }
                });

                await reviewPendingMessage.save();
                await ChatRoom.findByIdAndUpdate(
                    room._id,
                    {
                        lastMessage: reviewPendingMessage._id,
                        updatedAt: new Date()
                    }
                );
                await emitSystemMessage(io, reviewPendingMessage, room, order.sellerId, buyerId);
            }

            // Send notification to seller about buyer action
            let notificationTitle = '';
            let notificationMessage = '';

            switch (newStatus) {
                case ORDER_STATUS.CONFIRM_RECEIPT:
                    notificationTitle = "Order Confirmed by Buyer!";
                    notificationMessage = `The buyer has confirmed receipt of the order. Transaction completed successfully!`;
                    break;
                case ORDER_STATUS.RETURNED:
                    notificationTitle = "Return Requested";
                    notificationMessage = `The buyer has requested a return for this order. Please review the return request.`;
                    break;
                default:
                    notificationTitle = "Order Status Updated by Buyer";
                    notificationMessage = `The buyer has updated the order status to ${newStatus}.`;
            }

            const buyerActionNotifications = [{
                recipientId: order.sellerId,
                userId: buyerId,
                orderId: order._id,
                productId: order.items[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: notificationTitle,
                message: notificationMessage,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    newStatus: newStatus,
                    oldStatus: currentStatus,
                    actionBy: 'buyer',
                    sellerId: order.sellerId,
                    buyerId: buyerId,
                    totalAmount: order.grandTotal,
                    amount: order.grandTotal,
                    itemCount: order.items.length,
                    paymentMethod: order.paymentMethod,
                    status: newStatus
                }),
                redirectUrl: `/order/${order._id}`
            }];

            await saveNotification(buyerActionNotifications);

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
                select: 'title productImages _id fixedPrice saleType auctionSettings shippingCharge deliveryType',
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
                populate: [
                    {
                        path: 'provinceId',
                        model: 'Location',
                        select: 'value',
                    },
                    {
                        path: 'districtId',
                        model: 'Location',
                        select: 'value',
                    }
                ]
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
                const productReviews = await ProductReview.find({ productId: item.productId?._id })
                    .populate({
                        path: 'userId',
                        select: 'profileImage userName'
                    })
                    .lean();

                // Add isYourReview flag to each review
                const enrichedReviews = productReviews.map((review) => ({
                    ...review,
                    isYourReview: review.userId?._id?.toString() === req.user.userId.toString()
                }));

                return {
                    productId: item.productId?._id,
                    reviews: enrichedReviews
                };
            })
        );


        const isLocalPickup = (order.items || [])[0]?.productId?.deliveryType === 'local_pickup';

        // Define base steps
        const baseSteps = isLocalPickup
            ? ['paid', 'delivered', 'review']
            : ['paid', 'shipped', 'delivered', 'review'];

        // Normalize history statuses to lowercase
        const statusSet = new Set((statusHistory || []).map(h => h.newStatus?.toLowerCase()));

        // Helper to check if step is reached
        const getStepStatus = (step, index, allSteps) => {
            if (step === 'paid') return statusSet.has('confirmed') || statusSet.has('pending') || statusSet.has('completed'); // 'confirmed' means paid
            if (step === 'shipped') return statusSet.has('shipped');
            if (step === 'delivered') return statusSet.has('delivered');
            if (step === 'review') return reviews?.length > 0 && reviews[0].reviews?.some(r => r.isYourReview);
            return false;
        };

        // Build progress bar array
        const progressSteps = baseSteps.map((step, index) => {
            const isCompleted = getStepStatus(step, index, baseSteps);
            return {
                label: step.charAt(0).toUpperCase() + step.slice(1),
                value: step,
                status: isCompleted ? 'completed' : 'upcoming'
            };
        });

        // Mark current active step
        for (let i = 0; i < progressSteps.length; i++) {
            if (progressSteps[i].status === 'upcoming') {
                progressSteps[i].status = 'active';
                break;
            }
        }



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


        let deliveryProgressSteps = [];
        // Extract timestamps from statusHistory
        const shippedStatus = statusHistory.find(h => h.newStatus?.toLowerCase() === 'shipped');
        const deliveredStatus = statusHistory.find(h => h.newStatus?.toLowerCase() === 'delivered');
        if (isLocalPickup) {
            const isDelivered = !!deliveredStatus;
            deliveryProgressSteps = [
                {
                    label: 'Delivered',
                    value: 'delivered',
                    status: isDelivered ? 'completed' : 'active',
                    changedAt: deliveredStatus?.changedAt || null,
                    address: order.addressId || null,
                }
            ];
        } else {
            const isShipped = !!shippedStatus;
            const isDelivered = !!deliveredStatus;

            // Determine each step's status
            const shippedStep = {
                label: 'Shipped',
                value: 'shipped',
                status: isShipped ? 'completed' : 'active',
                changedAt: shippedStatus?.changedAt || null,
            };

            const onTheWayStep = {
                label: 'On The Way',
                value: 'on_the_way',
                status: isDelivered ? 'completed' : (isShipped ? 'active' : 'upcoming'),
                changedAt: isShipped ? shippedStatus?.changedAt || null : null, // Approx. time since shipped
            };

            const deliveredStep = {
                label: 'Delivered',
                value: 'delivered',
                status: isDelivered ? 'completed' : (isShipped ? 'upcoming' : 'upcoming'),
                changedAt: deliveredStatus?.changedAt || null,
            };

            deliveryProgressSteps = [shippedStep, onTheWayStep, deliveredStep];
        }





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
                productImages: item.productId?.productImages || '',
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
                createdAt: shipping.createdAt || '',

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
            reviews: reviews && reviews[0] || [],
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
            deliveryProgressSteps,
            progressSteps: progressSteps
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
                },
                {
                    path: 'addressId',
                    populate: (
                        [
                            {
                                path: "provinceId",
                                select: "value"
                            },
                            {
                                path: "districtId",
                                select: "value"
                            },

                        ]
                    ),
                    select: 'provinceId districtId notes fullName phone line1 postalCode'
                },

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


        const OrderHistory = await OrderStatusHistory.find({
            orderId: order._id,
            $or: [
                { oldStatus: { $in: ['shipped', 'delivered'] } },
                { newStatus: { $in: ['shipped', 'delivered'] } }
            ]
        });

        let obj = {
            order,
            shipping,
            reviews,
            OrderHistory
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
            let withdrawfeeType = PRICING_TYPE.FIXED;

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
            // console.log("totalDeductiontotalDeduction", amount, withdrawfee, totalDeduction)

            if (totalDeduction > user.walletBalance) {
                throw new Error("Insufficient wallet balance including withdrawal fee");
            }

            user.walletBalance -= totalDeduction; WalletTnx
            user.FreezWalletBalance += Number(amount);
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

            // Send notification about withdrawal request
            const withdrawalRequestNotifications = [{
                recipientId: userId,
                userId: userId,
                type: NOTIFICATION_TYPES.SYSTEM,
                title: "Withdrawal Request Submitted",
                message: `Your withdrawal request for $${amount} has been submitted successfully and is pending approval.`,
                meta: createStandardizedNotificationMeta({
                    withdrawalId: newRequest._id.toString(),
                    amount: amount,
                    withdrawalAmount: amount,
                    withdrawalFee: withdrawfee,
                    status: newRequest.status,
                    newStatus: newRequest.status,
                    sellerId: userId,
                    processedBy: 'system'
                }),
                redirectUrl: `/wallet/withdrawals`
            }];

            await saveNotification(withdrawalRequestNotifications);

            return apiSuccessRes(
                HTTP_STATUS.CREATED,
                res,
                "Withdraw request added successfully",
                newRequest
            );
        });

    } catch (err) {
        // console.error("add request", err);
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
        const { withdrawRequestId, status, notes } = req.body;
        const image = req.file;




        // Input validation
        if (!withdrawRequestId || !status) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "withdrawRequestId and status are required");
        }

        if (!['Approved', 'Rejected'].includes(status)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid status. Must be 'Approved' or 'Rejected'");
        }

        if (notes && notes.length > 500) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Notes cannot exceed 500 characters");
        }

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
                user.FreezWalletBalance -= Number(withdrawRequest.amount);
            } else if (status === 'Rejected') {
                let calculatedFee = 0;
                if (withdrawRequest.withdrawfeeType === PRICING_TYPE.PERCENTAGE) {
                    calculatedFee = (Number(withdrawRequest.amount) * Number(withdrawRequest.withdrawfee)) / 100;
                } else if (withdrawRequest.withdrawfeeType === PRICING_TYPE.FIXED) {
                    calculatedFee = Number(withdrawRequest.withdrawfee);
                }

                const totalRefund = Number(withdrawRequest.amount) + Number(calculatedFee);
                user.FreezWalletBalance -= Number(withdrawRequest.amount);
                user.walletBalance += totalRefund;
            }

            await user.save({ session });

            withdrawRequest.status = status;
            if (notes) {
                withdrawRequest.adminNotes = notes.trim();
            }
            if (image) {
                const imageUrl = await uploadImageCloudinary(image, 'withdrawal-images');
                withdrawRequest.adminImage = imageUrl;
            }
            withdrawRequest.processedAt = new Date();
            await withdrawRequest.save({ session });

            await WalletTnx.findOneAndUpdate(
                { sellerWithdrawlId: withdrawRequest._id },
                { tnxStatus: status === 'Approved' ? PAYMENT_STATUS.COMPLETED : PAYMENT_STATUS.REJECTED },
                { session }
            );

            await updateWithdrawalRevenue(withdrawRequest, status, session);

            // Send notification about withdrawal status change
            let notificationTitle = '';
            let notificationMessage = '';

            if (status === 'Approved') {
                notificationTitle = "Withdrawal Request Approved!";
                notificationMessage = `Your withdrawal request for ฿${withdrawRequest.amount} has been approved and processed.`;
            } else if (status === 'Rejected') {
                notificationTitle = "Withdrawal Request Rejected";
                notificationMessage = `Your withdrawal request for ฿${withdrawRequest.amount} has been rejected. The amount has been refunded to your wallet.`;
            }

            const withdrawalStatusNotifications = [{
                recipientId: withdrawRequest.userId,
                userId: withdrawRequest.userId,
                type: NOTIFICATION_TYPES.SYSTEM,
                title: notificationTitle,
                message: notificationMessage,
                meta: createStandardizedNotificationMeta({
                    withdrawalId: withdrawRequest._id.toString(),
                    amount: Number(withdrawRequest.amount),
                    withdrawalAmount: Number(withdrawRequest.amount),
                    withdrawalFee: Number(withdrawRequest.withdrawfee),
                    status: status,
                    newStatus: status,
                    oldStatus: 'pending',
                    processedBy: 'admin',
                    sellerId: withdrawRequest.userId
                }),
                redirectUrl: `/wallet/withdrawals`
            }];

            await saveNotification(withdrawalStatusNotifications);
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
            walletBalance: Number(user.walletBalance),
            FreezWalletBalance: Number(user.FreezWalletBalance),
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
            .populate('userId', 'userName email') // example: populate user name and email
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

const getAllTransactionsForAdmin = async (req, res) => {
    try {
        // Parse query params
        let {
            pageNo = 1,
            size = 10,
            minAmount,
            maxAmount,
            sortBy = 'createdAt',
            order = 'desc',
            status,
            paymentStatus,
            sellerId,
            buyerId,
            dateFrom,
            dateTo,
            paidToSeller, // Filter for paid to seller status
            hasDispute, // New filter for dispute existence
            disputeStatus // New filter for dispute status
        } = req.query;

        pageNo = parseInt(pageNo);
        size = parseInt(size);

        // Build filter object
        const filter = {};
        filter.paymentStatus = { $ne: PAYMENT_STATUS.PENDING };

        if (minAmount !== undefined || maxAmount !== undefined) {
            filter.amount = {};
            if (minAmount !== undefined) filter.amount.$gte = Number(minAmount);
            if (maxAmount !== undefined) filter.amount.$lte = Number(maxAmount);
        }

        if (status) filter.status = status;
        if (paymentStatus) filter.paymentStatus = paymentStatus;
        if (sellerId) filter.sellerId = toObjectId(sellerId);
        if (buyerId) filter.userId = toObjectId(buyerId);

        // Date range filter
        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) filter.createdAt.$lte = new Date(dateTo);
        }

        // Dispute filter - we'll apply this after we get the data since dispute is in a separate collection
        let disputeFilter = null;
        if (hasDispute === 'true') {
            disputeFilter = { hasDispute: true };
        } else if (hasDispute === 'false') {
            disputeFilter = { hasDispute: false };
        }

        // Build sort object
        const sortOrder = order.toLowerCase() === 'asc' ? 1 : -1;
        const sort = {};
        sort[sortBy] = sortOrder;

        // Fetch total count for pagination info
        const total = await Order.countDocuments(filter);

        // Fetch paginated orders with all related data
        const orders = await Order.find(filter)
            .populate([
                {
                    path: 'userId',
                    select: 'userName profileImage email phone'
                },
                {
                    path: 'sellerId',
                    select: 'userName profileImage email phone'
                },
                {
                    path: 'items.productId',
                    select: 'title productImages fixedPrice saleType'
                },
                {
                    path: 'disputeId',
                    select: 'disputeId status disputeType description adminReview createdAt'
                }
            ])
            .sort(sort)
            .skip((pageNo - 1) * size)
            .limit(size)
            .lean();

        // Get wallet transactions for these orders
        const orderIds = orders.map(order => order._id);

        // Get both credit and withdrawal transactions
        const walletTransactions = await WalletTnx.find({
            orderId: { $in: orderIds },
            tnxType: { $in: [TNX_TYPE.CREDIT, TNX_TYPE.WITHDRAWL] }
        }).lean();

        // Get disputes for all orders (in case disputeId is not populated in order)
        const disputes = await Dispute.find({
            orderId: { $in: orderIds },
            isDeleted: false
        }).lean();

        // Create maps
        const creditTnxMap = {};
        const withdrawalTnxMap = {};
        const disputeMap = {};

        walletTransactions.forEach(tnx => {
            if (tnx.tnxType === TNX_TYPE.CREDIT) {
                creditTnxMap[tnx.orderId.toString()] = tnx;
            } else if (tnx.tnxType === TNX_TYPE.WITHDRAWL) {
                withdrawalTnxMap[tnx.orderId.toString()] = tnx;
            }
        });

        disputes.forEach(dispute => {
            disputeMap[dispute.orderId.toString()] = dispute;
        });

        // Format response data
        let formattedOrders = orders.map(order => {
            const creditTnx = creditTnxMap[order._id.toString()];
            const withdrawalTnx = withdrawalTnxMap[order._id.toString()];
            const dispute = order.disputeId || disputeMap[order._id.toString()];

            const orderData = {
                orderId: order._id,
                orderIdFor: order.orderId,
                orderNumber: order._id.toString(),
                orderDate: order.createdAt,
                status: order.status,
                paymentStatus: order.paymentStatus,

                // Buyer Information
                buyer: {
                    id: order.userId?._id,
                    name: order.userId?.userName,
                    email: order.userId?.email,
                    phone: order.userId?.phone,
                    profileImage: order.userId?.profileImage
                },

                // Seller Information
                seller: {
                    id: order.sellerId?._id,
                    name: order.sellerId?.userName,
                    email: order.sellerId?.email,
                    phone: order.sellerId?.phone,
                    profileImage: order.sellerId?.profileImage
                },

                // Payment Details
                buyerPayment: {
                    totalAmount: order.totalAmount || 0,
                    shippingCharge: order.shippingCharge || 0,
                    buyerProtectionFee: order.BuyerProtectionFee || 0,
                    tax: order.Tax || 0,
                    grandTotal: order.grandTotal || 0,
                    paymentMethod: order.paymentMethod,
                    paymentId: order.paymentId
                },

                // Seller Payout Details
                sellerPayout: creditTnx ? {
                    payoutAmount: creditTnx.netAmount || 0,
                    productAmount: creditTnx.amount || 0,
                    serviceCharge: creditTnx.serviceCharge || 0,
                    taxCharge: creditTnx.taxCharge || 0,
                    serviceType: creditTnx.serviceType,
                    taxType: creditTnx.taxType,
                    payoutStatus: creditTnx.tnxStatus,
                    payoutDate: creditTnx.createdAt,
                    transactionId: creditTnx._id,
                    isPaidToSeller: !!withdrawalTnx,
                    withdrawalDetails: withdrawalTnx ? {
                        withdrawalId: withdrawalTnx._id,
                        withdrawalAmount: withdrawalTnx.amount,
                        withdrawalFee: withdrawalTnx.withdrawfee,
                        netAmountPaid: withdrawalTnx.netAmount,
                        withdrawalDate: withdrawalTnx.createdAt,
                        notes: withdrawalTnx.notes
                    } : null
                } : null,

                // Dispute Information
                dispute: dispute ? {
                    disputeId: dispute.disputeId,
                    status: dispute.status,
                    disputeType: dispute.disputeType,
                    description: dispute.description,
                    createdAt: dispute.createdAt,
                    adminReview: dispute.adminReview || null,
                    isResolved: dispute.status === 'RESOLVED'
                } : null,

                // Helper flags
                hasDispute: !!dispute,
                disputeStatus: dispute?.status || null,

                // Product Details
                products: order.items.map(item => ({
                    productId: item.productId?._id,
                    title: item.productId?.title,
                    images: item.productId?.productImages,
                    price: item.priceAtPurchase,
                    quantity: item.quantity,
                    saleType: item.productId?.saleType
                })),

                // Platform Revenue
                platformRevenue: {
                    buyerProtectionFee: order.BuyerProtectionFee || 0,
                    tax: +order.Tax + +(creditTnx?.taxCharge || 0),
                    serviceCharge: creditTnx?.serviceCharge || 0,
                    withdrawalFee: withdrawalTnx?.withdrawfee || 0,
                    totalRevenue: (+order.BuyerProtectionFee || 0) +
                        (+order.Tax + +(creditTnx?.taxCharge || 0)) +
                        +(creditTnx?.serviceCharge || 0) +
                        +(withdrawalTnx?.withdrawfee || 0)
                }
            };

            return orderData;
        });

        // Apply post-processing filters

        // Filter by paidToSeller if specified
        if (paidToSeller !== undefined) {
            const isPaid = paidToSeller === 'true' || paidToSeller === true;
            formattedOrders = formattedOrders.filter(order =>
                order.sellerPayout?.isPaidToSeller === isPaid
            );
        }

        // Filter by dispute existence
        if (disputeFilter) {
            if (disputeFilter.hasDispute) {
                formattedOrders = formattedOrders.filter(order => order.hasDispute);
            } else {
                formattedOrders = formattedOrders.filter(order => !order.hasDispute);
            }
        }

        // Filter by dispute status
        if (disputeStatus) {
            formattedOrders = formattedOrders.filter(order =>
                order.dispute?.status === disputeStatus
            );
        }

        // Recalculate pagination info based on filtered results
        const filteredTotal = formattedOrders.length;
        const totalPages = Math.ceil(filteredTotal / size);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Transactions fetched successfully", {
            pageNo,
            size,
            totalPages,
            totalRecords: filteredTotal,
            originalTotalRecords: total, // Total before dispute filtering
            transactions: formattedOrders,
            filters: {
                hasDispute,
                disputeStatus,
                paidToSeller,
                appliedFilters: {
                    minAmount: minAmount || null,
                    maxAmount: maxAmount || null,
                    status: status || null,
                    paymentStatus: paymentStatus || null,
                    dateFrom: dateFrom || null,
                    dateTo: dateTo || null
                }
            }
        });

    } catch (err) {
        console.error("getAllTransactionsForAdmin error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to fetch transactions");
    }
};

// const markSellerAsPaid = async (req, res) => {
//     const session = await mongoose.startSession();

//     try {
//         const { orderId, notes } = req.body;

//         if (!orderId) {
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID is required");
//         }

//         await session.withTransaction(async () => {
//             // Find the order and wallet transaction
//             const order = await Order.findById(orderId)
//                 .populate('sellerId')
//                 .session(session);

//             if (!order) {
//                 throw new Error("Order not found");
//             }

//             // Find the credit transaction for this order
//             const creditTransaction = await WalletTnx.findOne({
//                 orderId: order._id,
//                 tnxType: TNX_TYPE.CREDIT,
//                 tnxStatus: PAYMENT_STATUS.COMPLETED
//             }).session(session);

//             if (!creditTransaction) {
//                 throw new Error("No credit transaction found for this order");
//             }

//             // Check if withdrawal already processed
//             const existingWithdrawal = await WalletTnx.findOne({
//                 orderId: order._id,
//                 tnxType: TNX_TYPE.WITHDRAWL,
//                 tnxStatus: PAYMENT_STATUS.COMPLETED
//             }).session(session);

//             if (existingWithdrawal) {
//                 throw new Error("Withdrawal already processed for this order");
//             }

//             // Get withdrawal fee settings
//             const withdrawalFeeSetting = await FeeSetting.findOne({
//                 name: "WITHDRAWAL_FEE",
//                 isActive: true,
//                 isDisable: false,
//                 isDeleted: false
//             }).session(session);

//             const amountToWithdraw = creditTransaction.netAmount; // This is the amount seller should receive
//             let withdrawalFee = 0;
//             let withdrawalFeeType = '';

//             if (withdrawalFeeSetting) {
//                 if (withdrawalFeeSetting.type === PRICING_TYPE.PERCENTAGE) {
//                     withdrawalFee = (amountToWithdraw * withdrawalFeeSetting.value) / 100;
//                     withdrawalFeeType = PRICING_TYPE.PERCENTAGE;
//                 } else {
//                     withdrawalFee = withdrawalFeeSetting.value;
//                     withdrawalFeeType = PRICING_TYPE.FIXED;
//                 }
//             }

//             // Check if seller has enough balance for withdrawal amount
//             const seller = await User.findById(order.sellerId._id).session(session);
//             if (seller.walletBalance < amountToWithdraw) {
//                 throw new Error(`Insufficient wallet balance. Required: ${amountToWithdraw}, Available: ${seller.walletBalance}`);
//             }

//             // Create withdrawal transaction
//             const withdrawalTnx = new WalletTnx({
//                 orderId: order._id,
//                 userId: order.sellerId._id,
//                 amount: amountToWithdraw,
//                 netAmount: amountToWithdraw - withdrawalFee,
//                 withdrawfee: withdrawalFee,
//                 withdrawfeeType: withdrawalFeeType,
//                 tnxType: TNX_TYPE.WITHDRAWL,
//                 tnxStatus: PAYMENT_STATUS.COMPLETED,
//                 notes: notes || 'Manual withdrawal by admin'
//             });

//             await withdrawalTnx.save({ session });

//             // Track withdrawal fee in platform revenue
//             if (withdrawalFee > 0) {
//                 const platformRevenue = new PlatformRevenue({
//                     orderId: order._id,
//                     revenueType: 'WITHDRAWAL_FEE',
//                     amount: withdrawalFee,
//                     calculationType: withdrawalFeeType,
//                     calculationValue: withdrawalFeeSetting.value,
//                     baseAmount: amountToWithdraw,
//                     status: 'COMPLETED',
//                     completedAt: new Date(),
//                     description: `Withdrawal fee for order ${order._id}`,
//                     metadata: {
//                         withdrawalId: withdrawalTnx._id,
//                         sellerId: order.sellerId._id,
//                         withdrawalAmount: amountToWithdraw,
//                         netAmountPaid: amountToWithdraw - withdrawalFee
//                     }
//                 });
//                 await platformRevenue.save({ session });
//             }

//             // Deduct only the withdrawal amount from seller's wallet balance
//             await User.findByIdAndUpdate(
//                 order.sellerId._id,
//                 {
//                     $inc: { walletBalance: -amountToWithdraw }
//                 },
//                 { session }
//             );

//             // Create or get chat room for system message
//             const { room } = await findOrCreateOneOnOneRoom(order.userId, order.sellerId);

//             // Create system message for manual payout
//             const systemMessage = new ChatMessage({
//                 chatRoom: room._id,
//                 messageType: 'PAYMENT_STATUS',
//                 systemMeta: {
//                     statusType: 'PAYMENT',
//                     status: 'COMPLETED',
//                     orderId: order._id,
//                     productId: order.items[0].productId,
//                     title: 'Manual Withdrawal Completed',
//                     meta: createStandardizedChatMeta({
//                         orderNumber: order._id.toString(),
//                         totalAmount: order.grandTotal,
//                         amount: `$${amountToWithdraw.toFixed(2)}`,
//                         withdrawalFee: `$${withdrawalFee.toFixed(2)}`,
//                         netAmount: `$${(amountToWithdraw - withdrawalFee).toFixed(2)}`,
//                         withdrawalAmount: amountToWithdraw,
//                         itemCount: order.items.length,
//                         paymentMethod: 'Manual Admin Withdrawal',
//                         notes: notes || 'Withdrawal processed by admin',
//                         sellerId: order.sellerId._id,
//                         buyerId: order.userId,
//                         orderStatus: order.status,
//                         paymentStatus: order.paymentStatus,
//                         transactionId: withdrawalTnx._id.toString()
//                     }),
//                     actions: [
//                         {
//                             label: "View Order",
//                             url: `/order/${order._id}`,
//                             type: "primary"
//                         }
//                     ],
//                     theme: 'success'
//                 }
//             });

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

//             // Emit socket events
//             const io = req.app.get('io');
//             await emitSystemMessage(io, systemMessage, room, order.userId, order.sellerId);

//             // Send notification to seller about manual payout
//             const payoutNotifications = [{
//                 recipientId: order.sellerId._id,
//                 userId: order.userId,
//                 orderId: order._id,
//                 productId: order.items[0].productId,
//                 type: NOTIFICATION_TYPES.ORDER,
//                 title: "Payment Processed!",
//                 message: `Your earnings of $${(amountToWithdraw - withdrawalFee).toFixed(2)} for order ${order._id.toString().slice(-6)} have been processed and withdrawn from your wallet.`,
//                 meta: createStandardizedNotificationMeta({
//                     orderNumber: order._id.toString(),
//                     orderId: order._id.toString(),
//                     withdrawalAmount: amountToWithdraw,
//                     amount: amountToWithdraw,
//                     withdrawalFee: withdrawalFee,
//                     netAmount: amountToWithdraw - withdrawalFee,
//                     netAmountPaid: amountToWithdraw - withdrawalFee,
//                     transactionId: withdrawalTnx._id.toString(),
//                     processedBy: 'admin',
//                     sellerId: order.sellerId._id,
//                     buyerId: order.userId,
//                     totalAmount: order.grandTotal,
//                     itemCount: order.items.length,
//                     paymentMethod: order.paymentMethod,
//                     status: 'COMPLETED',
//                     newStatus: 'COMPLETED'
//                 }),
//                 redirectUrl: `/wallet/transactions`
//             }];

//             await saveNotification(payoutNotifications);

//             return apiSuccessRes(HTTP_STATUS.OK, res, "Seller withdrawal processed successfully", {
//                 orderId: order._id,
//                 sellerId: order.sellerId._id,
//                 sellerName: order.sellerId.userName,
//                 withdrawalAmount: amountToWithdraw,
//                 withdrawalFee: withdrawalFee,
//                 netAmount: amountToWithdraw - withdrawalFee,
//                 transactionId: withdrawalTnx._id,
//                 remainingWalletBalance: seller.walletBalance - amountToWithdraw
//             });
//         });

//     } catch (err) {
//         console.error("markSellerAsPaid error:", err);
//         return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to process seller withdrawal");
//     } finally {
//         session.endSession();
//     }
// };

const getSellerPayoutStatus = async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!orderId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID is required");
        }

        // Find the order
        const order = await Order.findById(orderId)
            .populate('sellerId', 'userName email phone')
            .populate('items.productId', 'title productImages')
            .lean();

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
        }

        // Check if seller is already paid
        const existingPayout = await WalletTnx.findOne({
            orderId: order._id,
            tnxType: TNX_TYPE.CREDIT
        }).lean();

        // Calculate what the payout should be
        const productCost = order.totalAmount || 0;
        const feeSettings = await FeeSetting.find({
            name: { $in: ["SERVICE_CHARGE", "TAX"] },
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).lean();

        const serviceChargeSetting = feeSettings.find(f => f.name === "SERVICE_CHARGE");
        const taxSetting = feeSettings.find(f => f.name === "TAX");

        let serviceCharge = 0;
        let taxCharge = 0;

        if (serviceChargeSetting) {
            if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
                serviceCharge = (productCost * serviceChargeSetting.value) / 100;
            } else {
                serviceCharge = serviceChargeSetting.value;
            }
        }

        if (taxSetting) {
            if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
                taxCharge = (productCost * taxSetting.value) / 100;
            } else {
                taxCharge = taxSetting.value;
            }
        }

        const netAmount = productCost - serviceCharge - taxCharge;

        return apiSuccessRes(HTTP_STATUS.OK, res, "Payout status fetched successfully", {
            orderId: order._id,
            orderNumber: order._id.toString(),
            orderStatus: order.status,
            paymentStatus: order.paymentStatus,

            seller: {
                id: order.sellerId._id,
                name: order.sellerId.userName,
                email: order.sellerId.email,
                phone: order.sellerId.phone
            },

            products: order.items.map(item => ({
                productId: item.productId._id,
                title: item.productId.title,
                images: item.productId.productImages,
                price: item.priceAtPurchase,
                quantity: item.quantity
            })),

            payoutCalculation: {
                productCost: productCost,
                serviceCharge: serviceCharge,
                taxCharge: taxCharge,
                netAmount: netAmount,
                serviceChargeType: serviceChargeSetting?.type || 'FIXED',
                taxChargeType: taxSetting?.type || 'FIXED'
            },

            payoutStatus: existingPayout ? {
                isPaid: true,
                paidAmount: existingPayout.amount,
                netPaidAmount: existingPayout.netAmount,
                paidDate: existingPayout.createdAt,
                transactionId: existingPayout._id,
                notes: existingPayout.notes
            } : {
                isPaid: false,
                canBePaid: order.status === ORDER_STATUS.DELIVERED || order.status === ORDER_STATUS.CONFIRMED
            }
        });

    } catch (err) {
        console.error("getSellerPayoutStatus error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to get payout status");
    }
};


const getSellerPayoutCalculation = async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID is required");
        }

        // Find the order
        const order = await Order.findById(orderId)
            .populate('sellerId', 'userName email phone')
            .populate('items.productId', 'title productImages')
            .lean();

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
        }

        // Check for dispute information
        let disputeInfo = null;
        const dispute = await Dispute.findOne({
            orderId: order._id,
            isDeleted: false,
            isDisable: false
        }).lean();

        if (dispute) {
            disputeInfo = {
                disputeId: dispute.disputeId,
                status: dispute.status,
                disputeReason: dispute.disputeReason,
                createdAt: dispute.createdAt,
                hasResolution: !!dispute.adminReview,
                decision: dispute.adminReview?.decision || null,
                disputeAmountPercent: dispute.adminReview?.disputeAmountPercent || 0,
                decisionNote: dispute.adminReview?.decisionNote || '',
                resolvedAt: dispute.adminReview?.resolvedAt || null,
                reviewedBy: dispute.adminReview?.reviewedBy || null
            };
        }

        // Find the credit wallet transaction for this order
        const creditTnx = await WalletTnx.findOne({
            orderId: order._id,
            tnxType: TNX_TYPE.CREDIT,
            tnxStatus: PAYMENT_STATUS.COMPLETED
        }).lean();

        // Calculate original amounts from order (before any dispute adjustments)
        const originalProductCost = Number(order.totalAmount) || 0;
        let calculatedProductCost = originalProductCost;
        let calculatedServiceCharge = 0;
        let calculatedTaxCharge = 0;
        let calculatedNetAmount = 0;
        let disputeAdjustmentDetails = null;

        // Get fee settings for calculation
        const feeSettings = await FeeSetting.find({
            name: { $in: ["SERVICE_CHARGE", "TAX"] },
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).lean();

        const serviceChargeSetting = feeSettings.find(f => f.name === "SERVICE_CHARGE");
        const taxSetting = feeSettings.find(f => f.name === "TAX");

        // Apply dispute adjustments if dispute is resolved
        if (disputeInfo && disputeInfo.hasResolution && disputeInfo.status === DISPUTE_STATUS.RESOLVED) {
            const { decision, disputeAmountPercent = 0 } = disputeInfo;

            if (decision === DISPUTE_DECISION.SELLER) {
                // Seller wins - gets full amount
                calculatedProductCost = originalProductCost;
                disputeAdjustmentDetails = {
                    type: 'SELLER_FAVOR',
                    description: 'Dispute resolved in seller favor - full payment',
                    originalAmount: originalProductCost,
                    adjustedAmount: calculatedProductCost,
                    sellerReceivePercent: 100,
                    buyerRefundPercent: 0,
                    adjustmentAmount: 0
                };
            } else if (decision === DISPUTE_DECISION.BUYER) {
                // Buyer wins - seller gets reduced amount
                const sellerReceivePercent = 100 - disputeAmountPercent;
                calculatedProductCost = originalProductCost * (sellerReceivePercent / 100);
                const refundAmount = originalProductCost * (disputeAmountPercent / 100);

                disputeAdjustmentDetails = {
                    type: 'BUYER_FAVOR',
                    description: `Dispute resolved in buyer favor - ${sellerReceivePercent}% to seller, ${disputeAmountPercent}% refund to buyer`,
                    originalAmount: originalProductCost,
                    adjustedAmount: calculatedProductCost,
                    sellerReceivePercent: sellerReceivePercent,
                    buyerRefundPercent: disputeAmountPercent,
                    adjustmentAmount: refundAmount
                };
            }
        } else {
            // No dispute or unresolved dispute - use original amount
            calculatedProductCost = originalProductCost;
        }

        // Calculate fees on the (potentially adjusted) product cost
        if (serviceChargeSetting) {
            if (serviceChargeSetting.type === PRICING_TYPE.PERCENTAGE) {
                calculatedServiceCharge = (calculatedProductCost * serviceChargeSetting.value) / 100;
            } else {
                calculatedServiceCharge = serviceChargeSetting.value;
            }
        }

        if (taxSetting) {
            if (taxSetting.type === PRICING_TYPE.PERCENTAGE) {
                calculatedTaxCharge = (calculatedProductCost * taxSetting.value) / 100;
            } else {
                calculatedTaxCharge = taxSetting.value;
            }
        }

        calculatedNetAmount = calculatedProductCost - calculatedServiceCharge - calculatedTaxCharge;

        // Use actual transaction amounts if order is completed and payment processed
        let finalAmounts = {
            productCost: calculatedProductCost,
            serviceCharge: calculatedServiceCharge,
            taxCharge: calculatedTaxCharge,
            netAmount: calculatedNetAmount,
            serviceChargeType: serviceChargeSetting?.type || 'FIXED',
            taxChargeType: taxSetting?.type || 'FIXED',
            isEstimated: true
        };

        if (creditTnx) {
            // Use actual processed amounts
            finalAmounts = {
                productCost: Number(creditTnx.amount) || 0,
                serviceCharge: Number(creditTnx.serviceCharge) || 0,
                taxCharge: Number(creditTnx.taxCharge) || 0,
                netAmount: Number(creditTnx.netAmount) || 0,
                serviceChargeType: creditTnx.serviceType || 'FIXED',
                taxChargeType: creditTnx.taxType || 'FIXED',
                isEstimated: false
            };
        }

        // Check if payout (withdrawal) is already completed
        const withdrawalTnx = await WalletTnx.findOne({
            orderId: order._id,
            tnxType: TNX_TYPE.WITHDRAWL,
            tnxStatus: PAYMENT_STATUS.COMPLETED
        }).lean();
        const isPayoutCompleted = !!withdrawalTnx;

        // Get withdrawal fee setting and calculate withdrawal fee
        const withdrawalFeeSetting = await FeeSetting.findOne({
            name: "WITHDRAWAL_FEE",
            isActive: true,
            isDisable: false,
            isDeleted: false
        }).lean();

        let withdrawalFee = 0;
        let withdrawalFeeType = '';

        if (withdrawalFeeSetting) {
            if (withdrawalFeeSetting.type === PRICING_TYPE.PERCENTAGE) {
                withdrawalFee = (finalAmounts.netAmount * withdrawalFeeSetting.value) / 100;
                withdrawalFeeType = PRICING_TYPE.PERCENTAGE;
            } else {
                withdrawalFee = withdrawalFeeSetting.value;
                withdrawalFeeType = PRICING_TYPE.FIXED;
            }
        }

        const netAmountAfterWithdrawalFee = finalAmounts.netAmount - withdrawalFee;

        return apiSuccessRes(HTTP_STATUS.OK, res, "Payout calculation fetched successfully", {
            orderId: order._id,
            orderNumber: order._id.toString(),
            orderStatus: order.status,
            paymentStatus: order.paymentStatus,
            isPayoutCompleted: isPayoutCompleted,
            seller: {
                id: order.sellerId._id,
                name: order.sellerId.userName,
                email: order.sellerId.email,
                phone: order.sellerId.phone
            },
            products: order.items.map(item => ({
                productId: item.productId._id,
                title: item.productId.title,
                images: item.productId.productImages,
                price: item.priceAtPurchase,
                quantity: item.quantity
            })),
            disputeInfo: disputeInfo,
            disputeAdjustment: disputeAdjustmentDetails,
            payoutCalculation: {
                originalProductCost: originalProductCost,
                productCost: finalAmounts.productCost,
                serviceCharge: finalAmounts.serviceCharge,
                taxCharge: finalAmounts.taxCharge,
                netAmount: finalAmounts.netAmount,
                withdrawalFee: withdrawalFee,
                withdrawalFeeType: withdrawalFeeType,
                netAmountAfterWithdrawalFee: netAmountAfterWithdrawalFee,
                serviceChargeType: finalAmounts.serviceChargeType,
                taxChargeType: finalAmounts.taxChargeType,
                withdrawalFeeSettingValue: withdrawalFeeSetting?.value || 0,
                isEstimated: finalAmounts.isEstimated,
                hasDispute: !!disputeInfo,
                isDisputeResolved: disputeInfo?.status === DISPUTE_STATUS.RESOLVED,
                feeSettings: {
                    serviceCharge: serviceChargeSetting ? {
                        value: serviceChargeSetting.value,
                        type: serviceChargeSetting.type
                    } : null,
                    tax: taxSetting ? {
                        value: taxSetting.value,
                        type: taxSetting.type
                    } : null,
                    withdrawalFee: withdrawalFeeSetting ? {
                        value: withdrawalFeeSetting.value,
                        type: withdrawalFeeSetting.type
                    } : null
                }
            }
        });
    } catch (err) {
        console.error("getSellerPayoutCalculation error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to get payout calculation");
    }
};



//////////////////////////////////////////////////////////////////////////////
router.post('/previewOrder', perApiLimiter(), upload.none(), previewOrder);
router.post('/placeOrder', perApiLimiter(), upload.none(), createOrder);

// Beam Payment Routes
router.post('/beam/initiate', perApiLimiter(), upload.none(), initiateBeamPayment);
router.post('/beam/webhook', upload.none(), beamPaymentWebhook);
///////////////////////////
router.post('/paymentCallback', upload.none(), originalPaymentCallback);

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
router.post('/changeStatus', perApiLimiter(), upload.single('image'), changeStatus);
router.get('/getAllWithdrawRequests', perApiLimiter(), upload.none(), getAllWithdrawRequests);

//////////////////////////////////////////////////////////////////////////////
/////////////////////////////******ADMIN TRANSACTIONS******///////////////////////////////
router.get('/admin/transactions', perApiLimiter(), upload.none(), getAllTransactionsForAdmin);

const getAdminFinancialDashboard = async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;

        // Build date filter
        const dateFilter = {};
        if (dateFrom) dateFilter.createdAt = { $gte: new Date(dateFrom) };
        if (dateTo) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(dateTo) };

        // Get total orders and amounts
        const totalOrdersStats = await Order.aggregate([
            { $match: { paymentStatus: PAYMENT_STATUS.COMPLETED, ...dateFilter } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalGMV: { $sum: '$grandTotal' },
                    totalProductValue: { $sum: '$totalAmount' },
                    totalShipping: { $sum: '$shippingCharge' },
                    totalBuyerProtectionFee: { $sum: '$BuyerProtectionFee' },
                    totalTax: { $sum: '$Tax' }
                }
            }
        ]);

        // Get seller payouts
        const sellerPayoutStats = await WalletTnx.aggregate([
            { $match: { tnxType: TNX_TYPE.CREDIT, tnxStatus: PAYMENT_STATUS.COMPLETED, ...dateFilter } },
            {
                $group: {
                    _id: null,
                    totalSellerPayouts: { $sum: '$netAmount' },
                    totalServiceCharges: { $sum: { $toDouble: '$serviceCharge' } },
                    totalTaxCharges: { $sum: { $toDouble: '$taxCharge' } },
                    payoutCount: { $sum: 1 }
                }
            }
        ]);

        // Get withdrawal stats
        const withdrawalStats = await WalletTnx.aggregate([
            { $match: { tnxType: TNX_TYPE.WITHDRAWL, tnxStatus: PAYMENT_STATUS.COMPLETED, ...dateFilter } },
            {
                $group: {
                    _id: null,
                    totalWithdrawals: { $sum: '$amount' },
                    totalWithdrawalFees: { $sum: '$withdrawfee' },
                    withdrawalCount: { $sum: 1 }
                }
            }
        ]);

        // Get platform revenue
        const platformRevenue = await PlatformRevenue.aggregate([
            { $match: { status: 'COMPLETED', ...dateFilter } },
            {
                $group: {
                    _id: '$revenueType',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get dispute financial impact
        const disputeImpact = await Dispute.aggregate([
            { $match: { status: DISPUTE_STATUS.RESOLVED, ...dateFilter } },
            {
                $lookup: {
                    from: 'Order',
                    localField: 'orderId',
                    foreignField: '_id',
                    as: 'order'
                }
            },
            { $unwind: '$order' },
            {
                $group: {
                    _id: '$adminReview.decision',
                    count: { $sum: 1 },
                    totalOrderValue: { $sum: '$order.grandTotal' },
                    avgRefundPercent: { $avg: '$adminReview.disputeAmountPercent' }
                }
            }
        ]);

        // Payment method breakdown
        const paymentMethodStats = await Order.aggregate([
            { $match: { paymentStatus: PAYMENT_STATUS.COMPLETED, ...dateFilter } },
            {
                $group: {
                    _id: '$paymentMethod',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$grandTotal' }
                }
            }
        ]);

        // Daily transaction trends (last 30 days)
        const dailyTrends = await Order.aggregate([
            {
                $match: {
                    paymentStatus: PAYMENT_STATUS.COMPLETED,
                    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    orderCount: { $sum: 1 },
                    totalGMV: { $sum: '$grandTotal' },
                    uniqueBuyers: { $addToSet: '$userId' },
                    uniqueSellers: { $addToSet: '$sellerId' }
                }
            },
            {
                $project: {
                    date: '$_id',
                    orderCount: 1,
                    totalGMV: 1,
                    uniqueBuyerCount: { $size: '$uniqueBuyers' },
                    uniqueSellerCount: { $size: '$uniqueSellers' }
                }
            },
            { $sort: { date: 1 } }
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Financial dashboard data fetched successfully", {
            overview: {
                orders: totalOrdersStats[0] || {},
                sellerPayouts: sellerPayoutStats[0] || {},
                withdrawals: withdrawalStats[0] || {},
                disputes: disputeImpact
            },
            platformRevenue,
            paymentMethodBreakdown: paymentMethodStats,
            dailyTrends,
            dateRange: { dateFrom, dateTo }
        });

    } catch (err) {
        console.error("getAdminFinancialDashboard error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to fetch financial dashboard data");
    }
};

const getProductFinancialDetails = async (req, res) => {
    try {
        const { productId } = req.params;
        const { includeHistory = true } = req.query;

        if (!productId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Product ID is required");
        }

        // Get product basic info
        const product = await SellProduct.findById(productId)
            .populate('userId', 'userName email')
            .populate('categoryId', 'name')
            .lean();

        if (!product) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Product not found");
        }

        // Get all orders for this product
        const orders = await Order.find({
            'items.productId': toObjectId(productId),
            paymentStatus: { $ne: PAYMENT_STATUS.PENDING }
        })
            .populate('userId', 'userName email phone')
            .populate('sellerId', 'userName email phone')
            .populate('disputeId')
            .sort({ createdAt: -1 })
            .lean();

        // Get financial summary for this product
        const financialSummary = await Order.aggregate([
            { $match: { 'items.productId': toObjectId(productId), paymentStatus: PAYMENT_STATUS.COMPLETED } },
            { $unwind: '$items' },
            { $match: { 'items.productId': toObjectId(productId) } },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: '$items.priceAtPurchase' },
                    totalOrderValue: { $sum: '$grandTotal' },
                    totalShippingCharges: { $sum: '$shippingCharge' },
                    totalBuyerProtectionFees: { $sum: '$BuyerProtectionFee' },
                    totalTaxes: { $sum: '$Tax' },
                    avgOrderValue: { $avg: '$grandTotal' },
                    firstSaleDate: { $min: '$createdAt' },
                    lastSaleDate: { $max: '$createdAt' }
                }
            }
        ]);

        // Get seller payout details for this product
        const orderIds = orders.map(order => order._id);
        const sellerPayouts = await WalletTnx.find({
            orderId: { $in: orderIds },
            tnxType: TNX_TYPE.CREDIT
        }).lean();

        const withdrawals = await WalletTnx.find({
            orderId: { $in: orderIds },
            tnxType: TNX_TYPE.WITHDRAWL
        }).lean();

        // Calculate platform revenue from this product
        const platformRevenueFromProduct = await PlatformRevenue.find({
            orderId: { $in: orderIds }
        }).lean();

        // Get dispute information
        const disputes = await Dispute.find({
            orderId: { $in: orderIds }
        }).lean();

        // Build comprehensive response
        const response = {
            product: {
                ...product,
                isActive: !product.isSold && !product.isDeleted && !product.isDisable
            },
            financialSummary: financialSummary[0] || {
                totalSales: 0,
                totalRevenue: 0,
                totalOrderValue: 0,
                totalShippingCharges: 0,
                totalBuyerProtectionFees: 0,
                totalTaxes: 0,
                avgOrderValue: 0
            },
            sellerPayouts: {
                totalPaidToSeller: sellerPayouts.reduce((sum, payout) => sum + (payout.netAmount || 0), 0),
                totalServiceCharges: sellerPayouts.reduce((sum, payout) => sum + (parseFloat(payout.serviceCharge) || 0), 0),
                totalTaxCharges: sellerPayouts.reduce((sum, payout) => sum + (parseFloat(payout.taxCharge) || 0), 0),
                payoutCount: sellerPayouts.length
            },
            withdrawals: {
                totalWithdrawn: withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0),
                totalWithdrawalFees: withdrawals.reduce((sum, w) => sum + (w.withdrawfee || 0), 0),
                withdrawalCount: withdrawals.length
            },
            platformRevenue: {
                total: platformRevenueFromProduct.reduce((sum, rev) => sum + (rev.amount || 0), 0),
                breakdown: platformRevenueFromProduct.reduce((acc, rev) => {
                    acc[rev.revenueType] = (acc[rev.revenueType] || 0) + rev.amount;
                    return acc;
                }, {})
            },
            disputes: {
                total: disputes.length,
                resolved: disputes.filter(d => d.status === DISPUTE_STATUS.RESOLVED).length,
                pending: disputes.filter(d => d.status === DISPUTE_STATUS.PENDING).length,
                totalFinancialImpact: disputes
                    .filter(d => d.adminReview?.disputeAmountPercent > 0)
                    .reduce((sum, d) => {
                        const order = orders.find(o => o._id.toString() === d.orderId.toString());
                        return sum + (order ? (order.grandTotal * d.adminReview.disputeAmountPercent / 100) : 0);
                    }, 0)
            }
        };

        // Include detailed transaction history if requested
        if (includeHistory === 'true') {
            response.transactionHistory = orders.map(order => {
                const itemInOrder = order.items.find(item => item.productId.toString() === productId);
                const sellerPayout = sellerPayouts.find(p => p.orderId.toString() === order._id.toString());
                const withdrawal = withdrawals.find(w => w.orderId.toString() === order._id.toString());
                const dispute = disputes.find(d => d.orderId.toString() === order._id.toString());

                return {
                    orderId: order._id,
                    orderNumber: order.orderId,
                    orderDate: order.createdAt,
                    orderStatus: order.status,
                    paymentStatus: order.paymentStatus,
                    buyer: order.userId,
                    seller: order.sellerId,
                    itemDetails: itemInOrder,
                    amounts: {
                        itemPrice: itemInOrder?.priceAtPurchase || 0,
                        totalOrderValue: order.grandTotal,
                        shippingCharge: order.shippingCharge,
                        buyerProtectionFee: order.BuyerProtectionFee,
                        tax: order.Tax
                    },
                    sellerPayout: sellerPayout ? {
                        netAmount: sellerPayout.netAmount,
                        serviceCharge: sellerPayout.serviceCharge,
                        taxCharge: sellerPayout.taxCharge,
                        payoutDate: sellerPayout.createdAt,
                        status: sellerPayout.tnxStatus
                    } : null,
                    withdrawal: withdrawal ? {
                        amount: withdrawal.amount,
                        withdrawalFee: withdrawal.withdrawfee,
                        withdrawalDate: withdrawal.createdAt,
                        status: withdrawal.tnxStatus
                    } : null,
                    dispute: dispute ? {
                        disputeId: dispute.disputeId,
                        status: dispute.status,
                        type: dispute.disputeType,
                        financialImpact: dispute.adminReview?.disputeAmountPercent
                            ? (order.grandTotal * dispute.adminReview.disputeAmountPercent / 100)
                            : 0
                    } : null
                };
            });
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Product financial details fetched successfully", response);

    } catch (err) {
        console.error("getProductFinancialDetails error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to fetch product financial details");
    }
};

const getDetailedMoneyFlow = async (req, res) => {
    try {
        const {
            orderId,
            userId,
            dateFrom,
            dateTo,
            flowType = 'all' // 'all', 'buyer', 'seller', 'platform'
        } = req.query;

        let matchConditions = {};

        if (orderId) matchConditions._id = toObjectId(orderId);
        if (userId) {
            matchConditions.$or = [
                { userId: toObjectId(userId) },
                { sellerId: toObjectId(userId) }
            ];
        }
        if (dateFrom || dateTo) {
            matchConditions.createdAt = {};
            if (dateFrom) matchConditions.createdAt.$gte = new Date(dateFrom);
            if (dateTo) matchConditions.createdAt.$lte = new Date(dateTo);
        }

        // Get orders with complete financial flow (only completed payments)
        const orders = await Order.find({ ...matchConditions, paymentStatus: PAYMENT_STATUS.COMPLETED })
            .populate([
                {
                    path: 'userId',
                    select: 'userName email'
                },
                {
                    path: 'sellerId',
                    select: 'userName email'
                },
                {
                    path: 'items.productId',
                    select: 'title productImages'
                }
            ])
            .lean();

        // Get related data for each order
        const orderIds = orders.map(order => order._id);

        const [sellerTransactions, platformRevenues, disputes, paymentTransactions] = await Promise.all([
            WalletTnx.find({ orderId: { $in: orderIds } }).lean(),
            PlatformRevenue.find({ orderId: { $in: orderIds } }).lean(),
            Dispute.find({ orderId: { $in: orderIds } }).lean(),
            Transaction.find({ orderId: { $in: orderIds } }).lean()
        ]);

        // Create lookup maps
        const sellerTxnMap = {};
        const platformRevenueMap = {};
        const disputeMap = {};
        const paymentTxnMap = {};

        sellerTransactions.forEach(txn => {
            const orderId = txn.orderId.toString();
            if (!sellerTxnMap[orderId]) sellerTxnMap[orderId] = [];
            sellerTxnMap[orderId].push(txn);
        });

        platformRevenues.forEach(rev => {
            const orderId = rev.orderId.toString();
            if (!platformRevenueMap[orderId]) platformRevenueMap[orderId] = [];
            platformRevenueMap[orderId].push(rev);
        });

        disputes.forEach(dispute => {
            disputeMap[dispute.orderId.toString()] = dispute;
        });

        paymentTransactions.forEach(txn => {
            const orderId = txn.orderId.toString();
            if (!paymentTxnMap[orderId]) paymentTxnMap[orderId] = [];
            paymentTxnMap[orderId].push(txn);
        });

        // Build enhanced orders with money flow data
        const enhancedOrders = orders.map(order => {
            const orderIdStr = order._id.toString();
            const orderSellerTxns = sellerTxnMap[orderIdStr] || [];
            const orderPlatformRevs = platformRevenueMap[orderIdStr] || [];
            const orderDispute = disputeMap[orderIdStr];
            const orderPaymentTxns = paymentTxnMap[orderIdStr] || [];

            // Calculate platform revenue
            const serviceCharges = orderSellerTxns
                .filter(txn => txn.tnxType === 'credit')
                .reduce((sum, txn) => sum + (parseFloat(txn.serviceCharge) || 0), 0);

            const taxCharges = orderSellerTxns
                .filter(txn => txn.tnxType === 'credit')
                .reduce((sum, txn) => sum + (parseFloat(txn.taxCharge) || 0), 0);

            const withdrawalFees = orderSellerTxns
                .filter(txn => txn.tnxType === 'withdrawl')
                .reduce((sum, txn) => sum + (txn.withdrawfee || 0), 0);

            const buyerProtectionFee = order.BuyerProtectionFee || 0;
            const tax = order.Tax || 0;

            const totalPlatformRevenue = buyerProtectionFee + tax + serviceCharges + taxCharges + withdrawalFees;

            // Calculate dispute impact
            const disputeImpact = orderDispute && orderDispute.adminReview?.disputeAmountPercent > 0
                ? (order.grandTotal * orderDispute.adminReview.disputeAmountPercent / 100)
                : 0;

            return {
                orderId: order.orderId,
                orderDate: order.createdAt,
                status: order.status,
                buyer: {
                    id: order.userId._id,
                    name: order.userId.userName,
                    email: order.userId.email
                },
                seller: {
                    id: order.sellerId._id,
                    name: order.sellerId.userName,
                    email: order.sellerId.email
                },
                products: order.items.map(item => ({
                    title: item.productId?.title,
                    images: item.productId?.productImages
                })),
                moneyFlow: {
                    buyerPayment: {
                        productAmount: order.totalAmount,
                        shippingCharge: order.shippingCharge || 0,
                        buyerProtectionFee: buyerProtectionFee,
                        tax: tax,
                        grandTotal: order.grandTotal,
                        paymentMethod: order.paymentMethod,
                        paymentId: order.paymentId
                    },
                    platformRevenue: {
                        buyerProtectionFee: buyerProtectionFee,
                        tax: tax,
                        serviceCharges: serviceCharges,
                        taxCharges: taxCharges,
                        withdrawalFees: withdrawalFees,
                        totalPlatformRevenue: totalPlatformRevenue
                    },
                    sellerPayouts: orderSellerTxns,
                    disputeImpact: orderDispute ? [{
                        disputeId: orderDispute.disputeId,
                        status: orderDispute.status,
                        financialImpact: disputeImpact
                    }] : []
                },
                paymentTransactions: orderPaymentTxns,
                rawOrder: order // Include raw order data for detailed view
            };
        });

        // Calculate summary statistics
        const summary = {
            totalOrders: enhancedOrders.length,
            totalGMV: enhancedOrders.reduce((sum, order) => sum + order.moneyFlow.buyerPayment.grandTotal, 0),
            totalPlatformRevenue: enhancedOrders.reduce((sum, order) => sum + order.moneyFlow.platformRevenue.totalPlatformRevenue, 0),
            totalSellerPayouts: enhancedOrders.reduce((sum, order) => {
                return sum + order.moneyFlow.sellerPayouts
                    .filter(txn => txn.tnxType === 'credit')
                    .reduce((txnSum, txn) => txnSum + (txn.netAmount || 0), 0);
            }, 0),
            totalDisputeImpact: enhancedOrders.reduce((sum, order) => {
                return sum + order.moneyFlow.disputeImpact.reduce((disputeSum, dispute) => disputeSum + dispute.financialImpact, 0);
            }, 0)
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Detailed money flow fetched successfully", {
            summary,
            orders: enhancedOrders,
            filters: { orderId, userId, dateFrom, dateTo, flowType }
        });

    } catch (err) {
        console.error("getDetailedMoneyFlow error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to fetch money flow details");
    }
};

//////////////////////////////////////////////////////////////////////////////
/////////////////////////////******ADMIN FINANCIAL DASHBOARD******///////////////////////////////
router.get('/admin/financial-dashboard', perApiLimiter(), upload.none(), getAdminFinancialDashboard);
router.get('/admin/product-financial/:productId', perApiLimiter(), upload.none(), getProductFinancialDetails);
router.get('/admin/money-flow', perApiLimiter(), upload.none(), getDetailedMoneyFlow);

router.get('/admin/payoutCalculation/:orderId', perApiLimiter(), upload.none(), getSellerPayoutCalculation);
// router.post('/admin/markSellerPaid', perApiLimiter(), upload.none(), markSellerAsPaid);


// router.get('/admin/payoutStatus/:orderId', perApiLimiter(), upload.none(), getSellerPayoutStatus);

// Calculate full payout breakdown for admin/gateway


// ... existing code ...

// Add the new route for admin payout calculation
// ... existing code ...




// router.post('/updateOrder/:orderId', perApiLimiter(), upload.none(), updateOrderById);
// router.post('/cancelAndRelistProduct', perApiLimiter(), upload.none(), cancelOrderAndRelistProducts);



// PENDING -> CONFIRMED -> SHIPPED -> DELIVERED sor seller
// SHIPPED -> CONFIRM_RECEIPT 

const cancelOrderByBuyer = async (req, res) => {
    try {
        const buyerId = req.user?.userId;
        const { orderId } = req.params;
        const { cancellationReason } = req.body;


        // Input validation
        if (!buyerId) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Authentication required");
        }

        if (!cancellationReason) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Cancellation reason is required");
        }


        // Find the order and validate ownership
        const order = await Order.findOne({
            _id: orderId,
            $or: [
                { userId: buyerId },
                { sellerId: buyerId }
            ],
            isDeleted: false
        }).populate('items.productId');

        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Order not found");
        }

        const isBuyer = String(order.userId) === String(req.user?.userId);
        const isSeller = String(order.sellerId) === String(req.user?.userId);


        // Check if order is already in a terminal status
        const terminalStatuses = [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED, ORDER_STATUS.FAILED];
        if (terminalStatuses.includes(order.status)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Order is already ${order.status}`);
        }

        // Check if payment is completed (only allow cancellation of paid orders)
        if (order.paymentStatus !== PAYMENT_STATUS.COMPLETED) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Only paid orders can be cancelled");
        }



        // Populate product data to check delivery types
        const populatedOrder = await order.populate('items.productId');

        // Check if ALL products are local pickup
        const allLocalPickup = populatedOrder.items.every(
            item => item.productId?.deliveryType === "local pickup"
        );

        // Check if ANY product has shipping
        const hasShippingProducts = populatedOrder.items.some(
            item => item.productId?.deliveryType !== "local pickup"
        );

        // Validate cancellation based on delivery type and current status
        let canCancel = false;
        let reason = "";

        if (hasShippingProducts) {
            // For orders with shipping products
            if ([ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED].includes(order.status)) {
                canCancel = true;
            } else if (order.status === ORDER_STATUS.SHIPPED) {
                canCancel = false;
                reason = "Cannot cancel order after it has been shipped";
            } else {
                canCancel = false;
                reason = `Cannot cancel order in ${order.status} status`;
            }
        } else if (allLocalPickup) {
            // For local pickup orders - check 3-day rule
            const daysToCheck = parseInt(process.env.DAY || '3', 10);

            const orderDate = new Date(order.createdAt);
            const currentDate = new Date();
            const hoursDifference = (currentDate - orderDate) / (1000 * 60 * 60);
            const limitInHours = daysToCheck * 24;


            if (hoursDifference <= limitInHours) {
                if ([ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED].includes(order.status)) {
                    canCancel = true;
                } else {
                    canCancel = false;
                    reason = `Cannot cancel local pickup order in ${order.status} status`;
                }
            } else {
                canCancel = false;
                reason = "Cannot cancel local pickup order after 3 days of placement";
            }
        }

        if (!canCancel) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, reason);
        }

        // Start transaction for atomic operations
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Update order status and cancellation details
            const updatedOrder = await Order.findByIdAndUpdate(
                order._id,
                {
                    status: ORDER_STATUS.CANCELLED,
                    cancelledBy: buyerId,
                    cancellationReason,
                    cancelledAt: new Date(),

                    updatedAt: new Date()
                },
                {
                    session,
                    new: true
                }
            );

            // Create order status history
            await OrderStatusHistory.create([{
                orderId: order._id,
                oldStatus: order.status,
                newStatus: ORDER_STATUS.CANCELLED,
                changedBy: buyerId,
                note: `Cancelled by buyer. Reason: ${cancellationReason}`
            }], { session });

            // Reset product availability (set isSold = false)
            const productIds = order.items.map(item => item.productId._id);
            await SellProduct.updateMany(
                {
                    _id: { $in: productIds },
                    isSold: true
                },
                {
                    $set: {
                        isSold: false,
                        updatedAt: new Date()
                    }
                },
                { session }
            );

            // Create or get chat room for system message
            const { room } = await findOrCreateOneOnOneRoom(buyerId, order.sellerId);

            // Create system message for cancellation
            const systemMessage = new ChatMessage({
                chatRoom: room._id,
                messageType: 'TEXT',
                content: `Order cancelled by buyer`,
                systemMeta: {
                    statusType: 'ORDER',
                    status: ORDER_STATUS.CANCELLED,
                    orderId: order._id,
                    productId: order.items[0].productId,
                    title: 'Order Cancelled',
                    meta: createStandardizedChatMeta({
                        orderNumber: order._id.toString(),
                        previousStatus: order.status,
                        newStatus: ORDER_STATUS.CANCELLED,
                        totalAmount: `$${(order.grandTotal || 0).toFixed(2)}`,
                        amount: order.grandTotal,
                        itemCount: order.items.length,
                        sellerId: order.sellerId,
                        buyerId: buyerId,
                        orderStatus: ORDER_STATUS.CANCELLED,
                        paymentStatus: order.paymentStatus,
                        paymentMethod: order.paymentMethod,
                        cancellationReason: cancellationReason,
                    }),
                    actions: [
                        {
                            label: "View Order",
                            url: `/order/${order._id}`,
                            type: "primary"
                        }
                    ],
                    theme: 'warning',
                    content: `Order has been cancelled by the buyer. Reason: ${cancellationReason}`
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

            // Emit system message to both parties
            await emitSystemMessage(io, systemMessage, room, order.sellerId, buyerId);

            // Send notification to seller about cancellation
            const sellerNotification = [{
                recipientId: order.sellerId,
                userId: buyerId,
                orderId: order._id,
                productId: order.items[0].productId,
                type: NOTIFICATION_TYPES.ORDER,
                title: "Order Cancelled by Buyer",
                message: `A buyer has cancelled their order. Reason: ${cancellationReason}`,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    newStatus: ORDER_STATUS.CANCELLED,
                    oldStatus: order.status,
                    actionBy: 'buyer',
                    sellerId: order.sellerId,
                    buyerId: buyerId,
                    totalAmount: order.grandTotal,
                    amount: order.grandTotal,
                    itemCount: order.items.length,
                    paymentMethod: order.paymentMethod,
                    cancellationReason: cancellationReason,
                    status: ORDER_STATUS.CANCELLED
                }),
                redirectUrl: `/order/${order._id}`
            }];

            await saveNotification(sellerNotification);

            // Handle refund logic for paid orders
            let refundStatus = "not_required";
            let refundAmount = 0;

            if (order.paymentStatus === PAYMENT_STATUS.COMPLETED && order.grandTotal > 0) {
                // Create refund transaction for buyer
                refundAmount = order.grandTotal;

                const buyerRefundTnx = new WalletTnx({
                    orderId: order._id,
                    userId: buyerId,
                    amount: refundAmount,
                    netAmount: refundAmount,
                    tnxType: TNX_TYPE.CREDIT, // Credit to buyer wallet
                    tnxStatus: PAYMENT_STATUS.COMPLETED,
                    note: `Refund for cancelled order. Reason: ${cancellationReason}`,
                    createdAt: new Date()
                });

                await buyerRefundTnx.save({ session });

                // Update buyer wallet balance
                await User.findByIdAndUpdate(
                    buyerId,
                    { $inc: { walletBalance: refundAmount } },
                    { session }
                );

                refundStatus = "completed";

                console.log(`💰 Refund processed: ฿${refundAmount} credited to buyer wallet`);

                // Send refund notification to buyer
                const buyerRefundNotification = [{
                    recipientId: buyerId,
                    userId: buyerId,
                    orderId: order._id,
                    productId: order.items[0].productId,
                    type: NOTIFICATION_TYPES.PAYMENT,
                    title: "Refund Processed",
                    message: `Your refund of ฿${refundAmount.toFixed(2)} has been credited to your wallet for the cancelled order.`,
                    meta: createStandardizedNotificationMeta({
                        orderNumber: order._id.toString(),
                        orderId: order._id.toString(),
                        amount: refundAmount,
                        refundAmount: refundAmount,
                        cancellationReason: cancellationReason,
                        actionBy: 'buyer',
                        sellerId: order.sellerId,
                        buyerId: buyerId,
                        status: ORDER_STATUS.CANCELLED
                    }),
                    redirectUrl: `/order/${order._id}`
                }];

                await saveNotification(buyerRefundNotification);
            }

            // Commit transaction
            await session.commitTransaction();
            session.endSession();

            return apiSuccessRes(
                HTTP_STATUS.OK,
                res,
                "Order cancelled successfully",
                {
                    orderId: order._id,
                    status: ORDER_STATUS.CANCELLED,
                    cancellationReason: cancellationReason,
                    cancelledAt: new Date(),
                    refundStatus: refundStatus,
                    refundAmount: refundAmount,
                    productsRelisted: productIds.length
                }
            );

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }

    } catch (err) {
        console.error("Cancel order by buyer error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to cancel order",
            err
        );
    }
};

router.post('/cancelOrder/:orderId', perApiLimiter(), upload.none(), cancelOrderByBuyer);

module.exports = router;