
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { SellProduct, Order } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { SALE_TYPE, DeliveryType, ORDER_STATUS } = require('../../utils/Role');

const addSellerProduct = async (req, res) => {
    try {
        const {
            categoryId,
            subCategoryId,
            title,
            description,
            condition,
            saleType,
            fixedPrice,
            originPriceView,
            originPrice,
            deliveryType,
            shippingCharge
        } = req.body;

        console.log("req.body11", req.body)


        let specifics = [];
        let auctionSettings = {};

        // Parse JSON fields from form-data
        try {

            if (req.body.specifics) {
                const raw = Array.isArray(req.body.specifics)
                    ? req.body.specifics
                    : [req.body.specifics];

                specifics = raw
                    .map(item => {
                        try {
                            return JSON.parse(item);
                        } catch {
                            return null;
                        }
                    })
                    .filter(item => item && typeof item === 'object');
            }
        } catch (e) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid 'specifics' JSON format.");
        }

        let tagArray = [];
        if (req.body.tags) {
            const raw = Array.isArray(req.body.tags)
                ? req.body.tags
                : [req.body.tags];
            console.log("raw", raw)
            // Clean array: remove empty strings or invalid ObjectId formats
            tagArray = raw
                .map(id => id.trim?.()) // optional chaining for safety
                .filter(id => id); // only valid Mongo ObjectIds
        }




        if (saleType === SALE_TYPE.AUCTION) {
            try {
                auctionSettings = JSON.parse(req.body.auctionSettings || "{}");
                console.log("Parsed auctionSettings ✅:", auctionSettings);
            } catch (e) {
                console.error("❌ Failed to parse auctionSettings:", req.body.auctionSettings);
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid 'auctionSettings' JSON format.");
            }

            const {
                startingPrice,
                reservePrice,
                duration,
                endDate: userEndDate,
                endTime,
                biddingIncrementPrice
            } = auctionSettings;

            if (!startingPrice || !reservePrice) {
                console.warn("❌ Missing startingPrice or reservePrice in auctionSettings:", auctionSettings);
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Auction settings are required when saleType is 'auction'");
            }

            let endDate;

            if (userEndDate) {
                endDate = new Date(userEndDate);
                if (endTime) {
                    const [hours, minutes] = endTime.split(':').map(Number);
                    endDate.setHours(hours || 0, minutes || 0, 0, 0);
                }
            } else if (duration) {
                const now = new Date();
                endDate = new Date(now);
                endDate.setDate(now.getDate() + Number(duration));
                if (endTime) {
                    const [hours, minutes] = endTime.split(':').map(Number);
                    endDate.setHours(hours || 0, minutes || 0, 0, 0);
                }
            } else {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Either duration or endDate is required.");
            }

            auctionSettings.endDate = endDate;
            auctionSettings.biddingIncrementPrice = Number(biddingIncrementPrice || 0);
        }



        // === Validate required fields ===
        if (!categoryId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required field: categoryId.");
        }
        if (!subCategoryId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required field: subCategoryId.");
        }
        if (!title) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required field: title.");
        }
        if (!condition) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required field: condition.");
        }
        if (!saleType) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required field: saleType.");
        }
        if (!deliveryType) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required field: deliveryType.");
        }
        if (!Array.isArray(specifics) || specifics.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing or invalid field: specifics must be a non-empty array.");
        }


        const validConditions = ['brand_new', 'like_new', 'good', 'fair', 'works'];
        if (!validConditions.includes(condition)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid condition value.");
        }

        if (saleType === SALE_TYPE.FIXED && (!fixedPrice || isNaN(fixedPrice))) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Fixed price is required.");
        }



        if (deliveryType === DeliveryType.CHARGE_SHIPPING && (shippingCharge == null || isNaN(shippingCharge))) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Shipping charge required.");
        }

        // === Specifics validation ===
        for (const spec of specifics) {
            const keys = ['parameterId', 'parameterName', 'valueId', 'valueName'];
            for (const key of keys) {
                if (!spec[key]) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Missing '${key}' in specifics.`);
                }
            }
        }

        // === Upload Images to Cloudinary ===
        let productImages = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'product-images');
                if (imageUrl) productImages.push(imageUrl);
            }
        }

        const productData = {
            userId: req.user?.userId,
            categoryId,
            subCategoryId,
            title,
            description: description || '',
            productImages,
            specifics,
            condition,
            tags: tagArray,
            saleType,
            fixedPrice: saleType === SALE_TYPE.FIXED ? fixedPrice : undefined,
            originPriceView: originPriceView === 'true', // from form-data
            originPrice,
            auctionSettings: saleType === SALE_TYPE.AUCTION ? auctionSettings : undefined,
            deliveryType,
            shippingCharge: deliveryType === DeliveryType.CHARGE_SHIPPING ? shippingCharge : undefined
        };

        const newProduct = new SellProduct(productData);
        const saved = await newProduct.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, saved);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};













const showNormalProducts = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 20,
            keyword,
            categoryId,
            subCategoryId,
            tags,
            specifics
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        // Step 1: Get sold product IDs (products part of confirmed/pending orders etc.)
        const soldProductResult = await Order.aggregate([
            {
                $match: {
                    status: {
                        $in: [ORDER_STATUS.PENDING,
                        ORDER_STATUS.CONFIRMED,
                        ORDER_STATUS.SHIPPED,
                        ORDER_STATUS.DELIVERED,
                        ORDER_STATUS.RETURNED]
                    },
                    isDeleted: false,
                },
            },
            { $unwind: "$items" },
            {
                $group: {
                    _id: null,
                    soldProductIds: { $addToSet: "$items.productId" },
                },
            },
            {
                $project: {
                    _id: 0,
                    soldProductIds: 1,
                },
            },
        ]);

        const soldProductIds = soldProductResult[0]?.soldProductIds || [];

        // Step 2: Build the query filter
        const filter = {
            saleType: SALE_TYPE.FIXED,
            isDeleted: false,
            isDisable: false,
            _id: { $nin: soldProductIds }
        };

        if (keyword) {
            filter.$or = [
                { title: { $regex: keyword, $options: "i" } },
                { description: { $regex: keyword, $options: "i" } },
                { tags: { $regex: keyword, $options: "i" } },
            ];
        }

        if (categoryId && categoryId !== "") {
            filter.categoryId = toObjectId(categoryId);
        }

        if (subCategoryId && subCategoryId !== "") {
            filter.subCategoryId = toObjectId(subCategoryId);
        }

        if (tags) {
            const tagArray = Array.isArray(tags) ? tags : tags.split(',');
            filter.tags = { $in: tagArray };
        }

        if (specifics) {
            const parsedSpecifics = Array.isArray(specifics) ? specifics : [specifics];
            filter['specifics.valueId'] = { $all: parsedSpecifics.map(id => toObjectId(id)) };
        }

        // Step 3: Query with pagination, sorting, projection
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select("title fixedPrice productImages condition  userId  tags originPriceView originPrice")
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage is_Id_verified")
                .lean(),

            SellProduct.countDocuments(filter)
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
            pageNo: page,
            size: limit,
            total,
            products
        });

    } catch (error) {
        console.error("showNormalProducts error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};


router.post('/addSellerProduct', perApiLimiter(), upload.array('files', 10), addSellerProduct);
//List api
router.get('/showNormalProducts', perApiLimiter(), showNormalProducts);
// router.get('/showAuctionProducts', perApiLimiter(), showAuctionProducts);







module.exports = router;
