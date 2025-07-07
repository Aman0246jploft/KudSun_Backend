const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const moment = require("moment")
const { UserAddress, Order, SellProduct, Bid, FeeSetting, User, Shipping, OrderStatusHistory } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes, parseItems } = require('../../utils/globalFunction');
const { SALE_TYPE, DEFAULT_AMOUNT, PAYMENT_METHOD, ORDER_STATUS, PAYMENT_STATUS, CHARGE_TYPE, PRICING_TYPE, SHIPPING_STATUS } = require('../../utils/Role');
const { default: mongoose } = require('mongoose');
const Joi = require('joi');


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
        await session.commitTransaction();
        session.endSession();
        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Order placed successfully", order);
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error("Order creation error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to place order");
    }
};


// Sample callback for successful payment
const paymentCallback = async (req, res) => {
    const schema = Joi.object({
        orderId: Joi.string().required(),
        paymentStatus: Joi.string().valid(PAYMENT_STATUS.COMPLETED, PAYMENT_STATUS.FAILED).required(),
        paymentId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);
    }

    const { orderId, paymentStatus, paymentId } = value;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const order = await Order.findOne({ _id: orderId }).session(session);

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
        }

        await order.save({ session });
        await session.commitTransaction();
        session.endSession();

        if (order.status !== ORDER_STATUS.FAILED) {
            await OrderStatusHistory.create({
                orderId: order._id,
                oldStatus: order.status,
                newStatus: order.status,
                // changedBy: req.user?.userId,
                note: 'Payment status updated'
            });
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Payment status updated", {
            orderId: order._id,
            paymentStatus: order.paymentStatus,
            orderStatus: order.status,
        });
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error("Payment callback error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to update payment status");
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

        // Query for active orders by user
        const query = {
            userId,
            isDeleted: false,
            isDisable: false
        };
        const total = await Order.countDocuments(query);


        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(pageSize)
            .populate({
                path: 'items.productId',
                model: 'SellProduct',
                select: 'title productImages fixedPrice saleType auctionSettings'
            })
            .lean();

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
        let { addressId, items } = req.body;
        let totalShippingCharge = 0;
        const userId = req.user.userId;

        if (req.body.items) {
            items = parseItems(req.body.items);
        }

        if (!Array.isArray(items) || items.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid order items');
        }

        const address = await UserAddress.findOne({ userId, isActive: true, _id: toObjectId(addressId) });
        if (!address) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Address not found');
        }

        const productIds = items.map(i => toObjectId(i.productId));

        let totalAmount = 0;
        const previewItems = [];
        console.log("itemsitems", items)

        for (const item of items) {
            const product = await SellProduct.findOne({ _id: toObjectId(item.productId), isDeleted: false, isDisable: false });
            console.log("product", product)
            if (!product) {
                return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `Product not found or unavailable: ${item.productId}`);
            }

            const seller = await User.findOne({ _id: product.userId });
            console.log("seller", seller)
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
            paymentStatus: PAYMENT_STATUS.COMPLETED
        };

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
        for (const order of orders) {
            order.items = order.items.filter(item => {
                return item.productId?.userId?.toString() === sellerId.toString();
            });
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

        const order = await Order.findOne({ _id: orderId, sellerId });
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

        if (currentStatus !== newStatus) {
            await OrderStatusHistory.create({
                orderId: order._id,
                oldStatus: currentStatus,
                newStatus,
                changedBy: req.user?.userId,
                note: 'Status updated by seller'
            });
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Order status updated successfully", {
            orderId: order._id,
            status: order.status,
        });
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

        const order = await Order.findOne({ _id: orderId, userId: buyerId });
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
            // After shipped, buyer can confirm delivery or request return
            allowedTransitions = [ORDER_STATUS.CONFIREM_RECEIPT];
            // allowedTransitions = [ORDER_STATUS.CONFIREM_RECEIPT, ORDER_STATUS.RETURNED];
        } else if (currentStatus === ORDER_STATUS.DELIVERED) {
            // After delivery, buyer can request return
            allowedTransitions = [ORDER_STATUS.RETURNED];
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

        // Save new status
        order.status = newStatus;
        await order.save();

        if (currentStatus !== newStatus) {
            await OrderStatusHistory.create({
                orderId: order._id,
                oldStatus: currentStatus,
                newStatus,
                changedBy: req.user?.userId,
                note: 'Status updated by buyer'
            });
        }

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            newStatus === ORDER_STATUS.DELIVERED
                ? "Order marked as delivered. Thank you for confirming receipt!"
                : "Order status updated successfully",
            {
                orderId: order._id,
                status: order.status,
            }
        );
    } catch (err) {
        console.error("Update order status by buyer error:", err);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            err.message || "Failed to update order status"
        );
    }
};



//////////////////////////////////////////////////////////////////////////////
router.get('/previewOrder', perApiLimiter(), upload.none(), previewOrder);
router.post('/placeOrder', perApiLimiter(), upload.none(), createOrder);
router.post('/paymentCallback', paymentCallback);
router.post('/updateOrderStatusBySeller/:orderId', perApiLimiter(), upload.none(), updateOrderStatusBySeller);
router.post('/updateOrderStatusByBuyer/:orderId', perApiLimiter(), upload.none(), updateOrderStatusByBuyer);
router.get('/getSoldProducts', perApiLimiter(), upload.none(), getSoldProducts);
router.get('/getBoughtProduct', perApiLimiter(), upload.none(), getBoughtProducts);
//////////////////////////////////////////////////////////////////////////////
router.post('/updateOrder/:orderId', perApiLimiter(), upload.none(), updateOrderById);
router.post('/cancelAndRelistProduct', perApiLimiter(), upload.none(), cancelOrderAndRelistProducts);





module.exports = router;
