
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const moment = require("moment");
const { SellProduct, Bid, Order } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { bidSchema } = require('../services/validations/bidValidation');
const HTTP_STATUS = require('../../utils/statusCode');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const { SALE_TYPE } = require('../../utils/Role');
const { default: mongoose } = require('mongoose');

const placeBid = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {

        const userId = req.user.userId; // assuming auth middleware sets this
        const { productId, amount } = req.body;

        // Validate product with session
        const product = await SellProduct.findOne({ _id: productId, isDeleted: false, isDisable: false }).session(session);

        if (!product) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Product not found or not available');
        }

        const { auctionSettings = {} } = product;
        const { endDate, endTime } = auctionSettings;

        if (!endDate || !endTime) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Auction end date and time not properly set.");
        }
        const auctionEnd = moment(`${moment(endDate).format("YYYY-MM-DD")} ${endTime}`, "YYYY-MM-DD HH:mm");

        if (moment().isAfter(auctionEnd)) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "The auction has already ended. You cannot place a bid.");
        }

        if (String(product.userId) === String(userId)) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "You cannot bid on your own product");
        }

        if (product.saleType !== SALE_TYPE.AUCTION) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Bids can only be placed on auction products');
        }

        const { startingPrice, biddingIncrementPrice, reservePrice } = auctionSettings;

        if (startingPrice == null) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Product auction settings are incomplete');
        }

        // Get current highest bid within the session
        const highestBid = await Bid.findOne({ productId }).sort({ amount: -1 }).session(session);

        // Validate bid amount
        const minAllowed = highestBid ? highestBid.amount + (biddingIncrementPrice || 1) : startingPrice;
        if (amount < minAllowed) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Your bid must be at least ${minAllowed}`);
        }

        // Unmark previous winning bid
        if (highestBid) {
            await Bid.updateOne(
                { _id: highestBid._id },
                { $set: { currentlyWinning: false } },
                { session }
            );
        }

        // Determine if reserve price is met
        const isReserveMet = reservePrice != null ? amount >= reservePrice : false;

        // Create new bid
        const newBid = new Bid({
            userId,
            productId,
            amount,
            currentlyWinning: true,
            isReserveMet
        });
        await newBid.save({ session });

        // Update product auctionSettings (inside session)
        product.auctionSettings.isBiddingOpen = moment().isBefore(auctionEnd);
        await product.save({ session });

        // Commit transaction
        await session.commitTransaction();
        session.endSession();

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Bid placed successfully', newBid);

    } catch (err) {
        await session.abortTransaction();
        session.endSession();

        console.error("Bid placement error:", err);
        return res.status(500).json(apiErrorRes("Something went wrong while placing the bid"));
    }
};


const productBidList = async (req, res) => {
    try {
        const { id: productId } = req.params;
        const userId = req?.user?.userId; // Logged-in user
        const pageno = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (pageno - 1) * size;

        // Check if product exists
        const product = await SellProduct.findOne({ _id: productId, isDeleted: false });
        if (!product) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Product not found');
        }

        // Get total count
        const totalBids = await Bid.countDocuments({ productId });

        // Fetch paginated bids
        const bids = await Bid.find({ productId })
            .populate("userId", "name email") // basic user info
            .sort({ amount: -1 })
            .skip(skip)
            .limit(size)
            .lean();

        const userBidIds = bids
            .filter(b => String(b.userId._id) === String(userId))
            .map(b => b._id);

        const userOrders = await Order.find({
            userId: toObjectId(userId),
            'items.productId': productId
        }).select('_id').lean();

        const orderPlaced = userOrders.length > 0;
        const orderId = orderPlaced ? userOrders[0]._id : null;


        // Enhance bids with user-specific info
        for (const bid of bids) {
            if (String(bid.userId._id) === String(userId)) {
                // Check if reserve price met for this bid
                const isReserveMet = bid.amount >= (reservePrice ?? 0);

                // Check if this bid is currently winning
                const isWinning = !!bid.currentlyWinning;

                const canPlaceOrder = auctionEnded && isWinning && isReserveMet && !orderPlaced;

                bid.isMine = true;
                bid.auctionEnded = auctionEnded;
                bid.isReserveMet = isReserveMet;
                bid.canPlaceOrder = canPlaceOrder;
                bid.alreadyOrdered = orderPlaced;
                bid.orderId = orderId;
            } else {
                bid.isMine = false;
            }
        }


        let obj = {
            total: totalBids,
            pageNo: pageno,
            size,
            data: bids
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Bid list', obj);



    } catch (err) {
        console.error("Error fetching product bids:", err);
        return res.status(500).json(apiErrorRes("Internal server error"));
    }
};


const myBids = async (req, res) => {
    try {
        const userId = req.user.userId; // from auth middleware
        const { productId, pageNo = 1, size = 10 } = req.query;

        const page = parseInt(pageNo) || 1;
        const limit = parseInt(size) || 10;
        const skip = (page - 1) * limit;

        // Build filter query
        const query = { userId };
        if (productId) query.productId = productId;

        // Get total bid count for the user
        const total = await Bid.countDocuments(query);

        // Fetch bids with pagination
        const bids = await Bid.find(query)
            .populate("productId", "title saleType fixedPrice auctionSettings")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
        for (const bid of bids) {
            const product = bid.productId;
            const { auctionSettings = {} } = product;
            const { endDate, endTime } = auctionSettings;

            let auctionEnded = false;
            if (endDate && endTime) {
                const endTimestamp = moment(`${moment(endDate).format("YYYY-MM-DD")} ${endTime}`, "YYYY-MM-DD HH:mm");
                auctionEnded = moment().isAfter(endTimestamp);
            }

            const isEligible = auctionEnded && bid.currentlyWinning && bid.isReserveMet;

            let alreadyOrdered = false;
            let existingOrder = null;

            if (isEligible) {
                existingOrder = await Order.findOne({
                    userId: toObjectId(userId),
                    'items.productId': toObjectId(bid.productId._id)
                }).select('_id');
                alreadyOrdered = !!existingOrder;
            }

            bid.auctionEnded = auctionEnded;
            bid.canPlaceOrder = isEligible && !alreadyOrdered;
            bid.alreadyOrdered = alreadyOrdered;
            bid.orderId = existingOrder?._id || null;
        }

        const result = {
            total,
            pageNo: page,
            size: limit,
            data: bids
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Your bids", result);
    } catch (err) {
        console.error("Error in myBids:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Internal server error");
    }
};

router.post('/placeBid', perApiLimiter(), upload.none(), validateRequest(bidSchema), placeBid);
router.get('/productBid/:id', perApiLimiter(), upload.none(), productBidList);
router.get('/myBids', perApiLimiter(), upload.none(), myBids);

module.exports = router;
