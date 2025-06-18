
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { SellProduct } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { SALE_TYPE, DeliveryType } = require('../../utils/Role');

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
    // Step 1: Find all ordered productIds from orders (exclude cancelled/returned/failed)
    const orderedProductIds = await Order.aggregate([
      {
        $match: {
          status: { $nin: ['CANCELLED', 'RETURNED', 'FAILED'] },
          isDeleted: false
        }
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: null,
          productIds: { $addToSet: "$items.productId" }
        }
      },
      {
        $project: {
          _id: 0,
          productIds: 1
        }
      }
    ]);

    const soldProductIds = orderedProductIds?.[0]?.productIds || [];

    // Step 2: Fetch only available (unsold) fixed-price products that are not disabled/deleted
    const products = await SellProduct.find({
      saleType: 'fixed',
      isDisable: false,
      isDeleted: false,
      _id: { $nin: soldProductIds }
    })
      .select("title description fixedPrice productImages condition categoryId userId createdAt")
      .populate("categoryId", "name")
      .populate("userId", "username avatar")
      .sort({ createdAt: -1 })
      .limit(50); // Optional limit

    return apiSuccessRes(HTTP_STATUS.OK, res, "Unsold products listed", products);
  } catch (error) {
    console.error("Error listing normal products:", error);
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};


router.post('/addSellerProduct', perApiLimiter(), upload.array('files', 10), addSellerProduct);
//List api





module.exports = router;
