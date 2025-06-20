
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const moment = require("moment")
const { UserAddress, Order, SellProduct, Bid } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes, parseItems } = require('../../utils/globalFunction');
const { SALE_TYPE, DEFAULT_AMOUNT, PAYMENT_METHOD, ORDER_STATUS, PAYMENT_STATUS } = require('../../utils/Role');
const { default: mongoose } = require('mongoose');


const createOrder = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        let { items, paymentMethod = PAYMENT_METHOD.ONLINE } = req.body;
        let totalShippingCharge = 0;
        const userId = req.user.userId;

        if (req.body.items) {
            items = parseItems(req.body.items)
        }

        console.log("req.body", req.body)

        if (!Array.isArray(items) || items.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid order data');
        }
        const address = await UserAddress.findOne({ userId, isActive: true });
        if (!address) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Address not found');
        }

        const productIds = items.map(i => toObjectId(i.productId));
        const existingOrders = await Order.find({
            userId: toObjectId(userId),
            'items.productId': { $in: productIds },
            isDeleted: { $ne: true }    // Assuming soft deletes
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



        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await SellProduct.findOne({ _id: toObjectId(item.productId), isDeleted: false, isDisable: false }).session(session);
            if (!product) {
                await session.abortTransaction();
                return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `Product not found or unavailable: ${item.productId}`);
            }

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
        const shippingCharge = totalShippingCharge
        const plateFormFee = Number(DEFAULT_AMOUNT.PLATFORM_FEE)
        const grandTotal = totalAmount + shippingCharge + plateFormFee;


        const order = new Order({
            userId,
            addressId: address._id,
            addressSnapshot: {
                fullName: address.fullName,
                phone: address.phone,
                line1: address.line1,
                line2: address.line2,
                city: address.city,
                state: address.state,
                country: address.country,
                postalCode: address.postalCode
            },
            items: orderItems,
            totalAmount,
            shippingCharge,
            grandTotal,
            paymentMethod,
            platformFee: plateFormFee
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

            value.addressSnapshot = {
                fullName: address.fullName,
                phone: address.phone,
                line1: address.line1,
                line2: address.line2,
                city: address.city,
                state: address.state,
                country: address.country,
                postalCode: address.postalCode
            };
        }

        // ---------------------------
        // Update Order Document
        // ---------------------------
        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            { $set: value },
            { new: true }
        );

        return res.status(HTTP_STATUS.OK).json(apiSuccessRes(updatedOrder, "Order updated successfully"));
    } catch (err) {
        console.error("Update Order Error:", err);
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(apiErrorRes(CONSTANTS_MSG.INTERNAL_SERVER_ERROR));
    }
};

router.post('/placeOrder', perApiLimiter(), upload.none(), createOrder);
router.post('/updateOrder/:orderId', perApiLimiter(), upload.none(), updateOrderById);


module.exports = router;
