
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { SellProduct, Order, Bid } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId, formatTimeRemaining } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { SALE_TYPE, DeliveryType, ORDER_STATUS } = require('../../utils/Role');
const { DateTime } = require('luxon');


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
        const timezone = req.body.timezone || 'UTC';

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
            // Clean array: remove empty strings or invalid ObjectId formats
            tagArray = raw
                .map(id => id.trim?.()) // optional chaining for safety
                .filter(id => id); // only valid Mongo ObjectIds
        }




        if (saleType === SALE_TYPE.AUCTION) {
            if (typeof req.body.auctionSettings === 'string') {
                try {
                    auctionSettings = JSON.parse(req.body.auctionSettings || "{}");
                } catch (e) {
                    console.error("❌ Failed to parse auctionSettings:", req.body.auctionSettings);
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid 'auctionSettings' JSON format.");
                }
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
            let biddingEndsAtDateTime;

            // CASE 1: endDate + endTime provided
            if (userEndDate && endTime) {
                // Combine date + time in the user's timezone
                biddingEndsAtDateTime = DateTime.fromISO(`${userEndDate}T${endTime}`, { zone: timezone });

                // Validate
                if (!biddingEndsAtDateTime.isValid) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid endDate or endTime with provided timezone.");
                }

                // CASE 2: Only duration provided
            } else if (duration) {
                const now = DateTime.now().setZone(timezone);
                biddingEndsAtDateTime = now.plus({ days: Number(duration) });

                if (endTime) {
                    const [hours, minutes] = endTime.split(':').map(Number);
                    biddingEndsAtDateTime = biddingEndsAtDateTime.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
                } else {
                    // No endTime specified, default to 23:59:59
                    biddingEndsAtDateTime = biddingEndsAtDateTime.set({ hour: 23, minute: 59, second: 59, millisecond: 0 });
                }
            } else {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Please provide either (endDate & endTime) or duration.");
            }

            auctionSettings.biddingEndsAt = biddingEndsAtDateTime.toJSDate(); // save as JS Date (UTC internally)
            auctionSettings.isBiddingOpen = DateTime.now().setZone('UTC') < biddingEndsAtDateTime.toUTC();
            auctionSettings.endDate = biddingEndsAtDateTime.toISODate();
            auctionSettings.endTime = biddingEndsAtDateTime.toFormat('HH:mm');
            auctionSettings.timezone = timezone; // Save timezone in DB if you want
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
            keyWord,
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

        if (keyWord) {
            filter.$or = [
                { title: { $regex: keyWord, $options: "i" } },
                { description: { $regex: keyWord, $options: "i" } },
                { tags: { $regex: keyWord, $options: "i" } },
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
                .select("title fixedPrice productImages condition  userId  tags originPriceView originPrice description specifics")
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage is_Id_verified isLive is_Preferred_seller")
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


const showAuctionProducts = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 20,
            keyWord,
            categoryId,
            subCategoryId,
            tags,
            specifics
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        // Step 1: Build filter
        const filter = {
            saleType: SALE_TYPE.AUCTION,
            isDeleted: false,
            isDisable: false,
            'auctionSettings.isBiddingOpen': true
        };

        if (keyWord) {
            filter.$or = [
                { title: { $regex: keyWord, $options: "i" } },
                { description: { $regex: keyWord, $options: "i" } },
                { tags: { $regex: keyWord, $options: "i" } }
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

        // Step 2: Query and paginate
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .sort({ 'auctionSettings.biddingEndsAt': 1 }) // Ending soonest first
                .skip(skip)
                .limit(limit)
                .select("title productImages condition auctionSettings tags description specifics")
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage is_Id_verified isLive is_Preferred_seller")
                .lean(),
            SellProduct.countDocuments(filter)
        ]);
        const productIds = products.map(p => toObjectId(p._id));
        // Aggregate bids count grouped by productId
        const bidsCounts = await Bid.aggregate([
            { $match: { productId: { $in: productIds } } },
            { $group: { _id: "$productId", totalBidsPlaced: { $sum: 1 } } }
        ]);

        // Create a map for quick lookup
        const bidsCountMap = bidsCounts.reduce((acc, curr) => {
            acc[curr._id.toString()] = curr.totalBidsPlaced;
            return acc;
        }, {});

        products.forEach(product => {
            product.totalBidsPlaced = bidsCountMap[product._id.toString()] || 0;
            const nowTimestamp = new Date()
            const offsetMinutes = nowTimestamp.getTimezoneOffset();
            const localNow = new Date(nowTimestamp.getTime() - offsetMinutes * 60 * 1000);
            const endTime = new Date(product.auctionSettings.biddingEndsAt).getTime();
            const timeLeftMs = endTime - localNow;
            product.timeRemaining = timeLeftMs > 0 ? formatTimeRemaining(timeLeftMs) : 0;
        });


        return apiSuccessRes(HTTP_STATUS.OK, res, "Auction products fetched successfully", {
            pageNo: page,
            size: limit,
            total,
            products
        });

    } catch (error) {
        console.error("showAuctionProducts error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};


const getLimitedTimeDeals = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            keyWord,
            categoryId,
            subCategoryId,
            tags,
            specifics
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const now = new Date();
        const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Step 1: Build filter
        const filter = {
            saleType: SALE_TYPE.AUCTION,
            isDeleted: false,
            isDisable: false,
            'auctionSettings.isBiddingOpen': true,
            'auctionSettings.biddingEndsAt': { $gte: now, $lte: next24Hours }
        };

        if (keyWord) {
            filter.$or = [
                { title: { $regex: keyWord, $options: "i" } },
                { description: { $regex: keyWord, $options: "i" } },
                { tags: { $regex: keyWord, $options: "i" } }
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

        // Step 2: Query and paginate
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .sort({ 'auctionSettings.biddingEndsAt': 1 }) // Soonest first
                .skip(skip)
                .limit(limit)
                .select("title productImages auctionSettings.fixedPrice condition tags description createdAt auctionSettings.biddingEndsAt")
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage is_Id_verified isLive")
                .lean(),
            SellProduct.countDocuments(filter)
        ]);

        // Step 3: Add time remaining and bid counts
        const productIds = products.map(p => toObjectId(p._id));

        const bidsCounts = await Bid.aggregate([
            { $match: { productId: { $in: productIds } } },
            { $group: { _id: "$productId", totalBidsPlaced: { $sum: 1 } } }
        ]);

        const bidsCountMap = bidsCounts.reduce((acc, curr) => {
            acc[curr._id.toString()] = curr.totalBidsPlaced;
            return acc;
        }, {});

        const nowTimestamp = Date.now();
        products.forEach(product => {
            const endTime = new Date(product.auctionSettings.biddingEndsAt).getTime();
            const timeLeftMs = endTime - nowTimestamp;
            product.timeRemaining = timeLeftMs > 0 ? timeLeftMs : 0;
            product.timeRemainingStr = formatTimeRemaining(product.timeRemaining);
            product.totalBidsPlaced = bidsCountMap[product._id.toString()] || 0;

        });


        return apiSuccessRes(HTTP_STATUS.OK, res, "Limited time deals fetched successfully", {
            pageNo: page,
            size: limit,
            total,
            products
        });

    } catch (error) {
        console.error("getLimitedTimeDeals error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};

const fetchCombinedProducts = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 20,
            keyWord,
            categoryId,
            subCategoryId,
            tags,
            specifics,
            saleType, // 'normal', 'auction', or 'all' (default)
            sortBy = 'createdAt', // 'createdAt', 'price', 'endingSoon', 'popularity'
            sortOrder = 'desc', // 'asc' or 'desc'
            priceMin,
            priceMax,
            condition, // 'new', 'used', 'refurbished'
            includeEndedAuctions = false
        } = req.query;



        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        // Step 1: Get sold product IDs for normal products (cached approach recommended)
        let soldProductIds = [];
        if (!saleType || saleType === 'all' || saleType === 'normal') {
            const soldProductResult = await Order.aggregate([
                {
                    $match: {
                        status: {
                            $in: [
                                ORDER_STATUS.PENDING,
                                ORDER_STATUS.CONFIRMED,
                                ORDER_STATUS.SHIPPED,
                                ORDER_STATUS.DELIVERED,
                                ORDER_STATUS.RETURNED
                            ]
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
            soldProductIds = soldProductResult[0]?.soldProductIds || [];
        }

        // Step 2: Build base filter
        const baseFilter = {
            isDeleted: false,
            isDisable: false,
        };

        // Step 3: Build sale type specific filters
        let saleTypeFilters = [];

        if (!saleType || saleType === 'all' || saleType === 'normal') {
            saleTypeFilters.push({
                ...baseFilter,
                saleType: SALE_TYPE.FIXED,
                _id: { $nin: soldProductIds }
            });
        }

        if (!saleType || saleType === 'all' || saleType === 'auction') {
            const auctionFilter = {
                ...baseFilter,
                saleType: SALE_TYPE.AUCTION,
            };

            if (!includeEndedAuctions) {
                auctionFilter['auctionSettings.isBiddingOpen'] = true;
            }

            saleTypeFilters.push(auctionFilter);
        }

        // Step 4: Apply common filters to all sale type filters
        saleTypeFilters = saleTypeFilters.map(filter => {
            const updatedFilter = { ...filter };

            // Keyword search
            if (keyWord) {
                updatedFilter.$or = [
                    { title: { $regex: keyWord, $options: "i" } },
                    { description: { $regex: keyWord, $options: "i" } },
                    { tags: { $regex: keyWord, $options: "i" } },
                ];
            }

            // Category filters
            if (categoryId && categoryId !== "") {
                updatedFilter.categoryId = toObjectId(categoryId);
            }

            if (subCategoryId && subCategoryId !== "") {
                updatedFilter.subCategoryId = toObjectId(subCategoryId);
            }

            // Tags filter
            if (tags) {
                const tagArray = Array.isArray(tags) ? tags : tags.split(',');
                updatedFilter.tags = { $in: tagArray };
            }

            // Specifics filter
            if (specifics) {
                const parsedSpecifics = Array.isArray(specifics) ? specifics : [specifics];
                updatedFilter['specifics.valueId'] = { $all: parsedSpecifics.map(id => toObjectId(id)) };
            }

            // Price range filter
            if (priceMin || priceMax) {
                const priceFilter = {};
                if (priceMin) priceFilter.$gte = parseFloat(priceMin);
                if (priceMax) priceFilter.$lte = parseFloat(priceMax);

                // Apply price filter based on sale type
                if (updatedFilter.saleType === SALE_TYPE.FIXED) {
                    updatedFilter.fixedPrice = priceFilter;
                } else if (updatedFilter.saleType === SALE_TYPE.AUCTION) {
                    updatedFilter['auctionSettings.startingPrice'] = priceFilter;
                }
            }

            // Condition filter
            if (condition) {
                updatedFilter.condition = condition;
            }

            return updatedFilter;
        });


        // Step 5: Build sort configuration
        let sortConfig = {};
        switch (sortBy) {
            case 'price':
                // For mixed results, we'll sort in aggregation
                sortConfig = { fixedPrice: sortOrder === 'desc' ? -1 : 1 };
                break;
            case 'endingSoon':
                sortConfig = { 'auctionSettings.biddingEndsAt': 1 }; // Always ascending for ending soon
                break;
            case 'popularity':
                sortConfig = { viewCount: sortOrder === 'desc' ? -1 : 1 };
                break;
            default:
                sortConfig = { createdAt: sortOrder === 'desc' ? -1 : 1 };
        }

        // Step 6: Create unified filter using $or for mixed sale types
        const unifiedFilter = {
            $or: saleTypeFilters,
        };

        // Step 7: Execute single unified query to get mixed products
        const [allProducts, totalCount] = await Promise.all([
            SellProduct.find(unifiedFilter)
                .select(`
                    title 
                    fixedPrice 
                    productImages 
                    condition 
                    userId 
                    tags 
                    description 
                    saleType 
                    createdAt
                    viewCount
                    auctionSettings
                `)
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage is_Id_verified isLive")
                .lean(),
            SellProduct.countDocuments(unifiedFilter)
        ]);

        // Step 8: Get auction product IDs for bid counting
        const auctionProductIds = allProducts
            .filter(p => p.saleType === SALE_TYPE.AUCTION)
            .map(p => toObjectId(p._id));

        // Step 9: Get bid counts for auction products
        let bidsCountMap = {};
        if (auctionProductIds.length > 0) {
            const bidsCounts = await Bid.aggregate([
                { $match: { productId: { $in: auctionProductIds } } },
                { $group: { _id: "$productId", totalBidsPlaced: { $sum: 1 } } }
            ]);

            bidsCountMap = bidsCounts.reduce((acc, curr) => {
                acc[curr._id.toString()] = curr.totalBidsPlaced;
                return acc;
            }, {});
        }

        // Step 10: Enhance products with additional data and ensure mixing
        let enhancedProducts = allProducts.map(product => {
            const enhancedProduct = {
                ...product,
                productType: product.saleType === SALE_TYPE.FIXED ? 'normal' : 'auction'
            };

            // Add bid count for auction products
            if (product.saleType === SALE_TYPE.AUCTION) {
                enhancedProduct.totalBidsPlaced = bidsCountMap[product._id.toString()] || 0;

                // Add auction status
                if (product.auctionSettings) {
                    const now = new Date();
                    const endTime = new Date(product.auctionSettings.biddingEndsAt);
                    const timeRemainingMs = endTime > now ? endTime - now : 0;

                    enhancedProduct.timeRemainingFormatted = formatTimeRemaining(timeRemainingMs);
                    enhancedProduct.auctionStatus = {
                        isActive: product.auctionSettings.isBiddingOpen && endTime > now,
                        timeRemaining: timeRemainingMs,
                        timeRemainingFormatted: formatTimeRemaining(timeRemainingMs),
                        hasEnded: endTime <= now,
                        endTime: product.auctionSettings.biddingEndsAt
                    };
                }
            }

            // Add price for sorting (normalize between fixed and auction)
            enhancedProduct.sortPrice = product.saleType === SALE_TYPE.FIXED
                ? product.fixedPrice
                : product.auctionSettings?.startingPrice || 0;

            return enhancedProduct;
        });

        // Step 11: Apply sorting to mixed products for natural mixing
        enhancedProducts.sort((a, b) => {
            switch (sortBy) {
                case 'price':
                    const sortResult = sortOrder === 'desc'
                        ? (b.sortPrice || 0) - (a.sortPrice || 0)
                        : (a.sortPrice || 0) - (b.sortPrice || 0);
                    // If prices are equal, mix by creation date for variety
                    return sortResult === 0 ? new Date(b.createdAt) - new Date(a.createdAt) : sortResult;
                case 'endingSoon':
                    // Prioritize auction products ending soon, then mix with normal products
                    if (a.saleType === SALE_TYPE.AUCTION && b.saleType === SALE_TYPE.AUCTION) {
                        return new Date(a.auctionSettings?.biddingEndsAt || 0) - new Date(b.auctionSettings?.biddingEndsAt || 0);
                    } else if (a.saleType === SALE_TYPE.AUCTION && a.auctionStatus?.isActive) {
                        return -1; // Active auctions first
                    } else if (b.saleType === SALE_TYPE.AUCTION && b.auctionStatus?.isActive) {
                        return 1; // Active auctions first
                    }
                    // For same type or non-active auctions, sort by creation date to ensure mixing
                    return new Date(b.createdAt) - new Date(a.createdAt);
                case 'popularity':
                    const popularityResult = sortOrder === 'desc'
                        ? (b.viewCount || 0) - (a.viewCount || 0)
                        : (a.viewCount || 0) - (b.viewCount || 0);
                    // If popularity is equal, mix by creation date
                    return popularityResult === 0 ? new Date(b.createdAt) - new Date(a.createdAt) : popularityResult;
                default: // createdAt - ensures natural chronological mixing
                    return sortOrder === 'desc'
                        ? new Date(b.createdAt) - new Date(a.createdAt)
                        : new Date(a.createdAt) - new Date(b.createdAt);
            }
        });

        // Step 12: Apply pagination to naturally mixed results
        const paginatedProducts = enhancedProducts.slice(skip, skip + limit);

        const finalProducts = paginatedProducts.map(p => {
            const {
                createdAt,
                categoryId,
                auctionSettings,
                auctionStatus,
                sortPrice,
                productType,
                ...rest
            } = p;

            return {
                ...rest,
                ...(p.timeRemainingFormatted && { timeRemainingFormatted: p.timeRemainingFormatted }),
                ...(typeof p.totalBidsPlaced !== 'undefined' && { totalBidsPlaced: p.totalBidsPlaced }),
            };
        });



        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
            pageNo: page,
            size: limit,
            total: totalCount,
            products: finalProducts,
        });

    } catch (error) {
        console.error("showAllProducts error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};



const fetchUserProducts = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 20,
            userId,
            sortBy = 'createdAt', // only allowed: 'createdAt', 'price'
            sortOrder = 'desc',   // 'asc' or 'desc'
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        // Get logged-in user ID from auth (assumes middleware sets req.user._id)
        const requesterId = req.user?._id?.toString();

        const isSelfProfile = userId && requesterId && userId === requesterId;

        // Base filter
        let filter = {};

        if (userId) {
            filter.userId = toObjectId(userId);
        }

        // For other users, show all products even if sold, deleted, or disabled
        if (isSelfProfile) {
            filter.isDeleted = false;
            filter.isDisable = false;
        }

        // Allowed sorting options
        let sortConfig = {};
        if (sortBy === 'price') {
            // Sort by normalized price
            sortConfig = { fixedPrice: sortOrder === 'desc' ? -1 : 1 };
        } else {
            // Default or createdAt
            sortConfig = { createdAt: sortOrder === 'desc' ? -1 : 1 };
        }

        // Get sold product IDs
        let soldProductIds = [];
        const soldProductResult = await Order.aggregate([
            {
                $match: {
                    status: {
                        $in: [
                            ORDER_STATUS.PENDING,
                            ORDER_STATUS.CONFIRMED,
                            ORDER_STATUS.SHIPPED,
                            ORDER_STATUS.DELIVERED,
                            ORDER_STATUS.RETURNED
                        ],
                    },
                    isDeleted: false
                }
            },
            { $unwind: "$items" },
            {
                $group: {
                    _id: null,
                    soldProductIds: { $addToSet: "$items.productId" }
                }
            },
            {
                $project: {
                    _id: 0,
                    soldProductIds: 1
                }
            }
        ]);
        soldProductIds = soldProductResult[0]?.soldProductIds || [];

        // Fetch Products
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .select(`
                    title 
                    fixedPrice 
                    saleType 
                    condition 
                    productImages 
                    auctionSettings 
                    createdAt
                `)
                .sort(sortConfig)
                .skip(skip)
                .limit(limit)
                .lean(),
            SellProduct.countDocuments(filter)
        ]);

        // Enhance products with isSold flag
        const finalProducts = products.map(product => {
            const isSold = soldProductIds.some(id => id.toString() === product._id.toString());

            return {
                ...product,
                isSold
            };
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, "User products fetched successfully", {
            pageNo: page,
            size: limit,
            total,
            products: finalProducts
        });
    } catch (error) {
        console.error("fetchUserProducts error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};




router.post('/addSellerProduct', perApiLimiter(), upload.array('files', 10), addSellerProduct);
//List api for the Home Screen // thread controller
router.get('/showNormalProducts', perApiLimiter(), showNormalProducts);
router.get('/showAuctionProducts', perApiLimiter(), showAuctionProducts);
//Category detail Page
router.get('/limited-time', perApiLimiter(), getLimitedTimeDeals);
router.get('/fetchCombinedProducts', perApiLimiter(), fetchCombinedProducts);
// inside userProfile
router.get('/fetchUserProducts', perApiLimiter(), fetchUserProducts);

// router.get('/productList ', perApiLimiter(), productList);










module.exports = router;
