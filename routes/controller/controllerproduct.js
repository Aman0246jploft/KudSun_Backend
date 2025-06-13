
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Module, SellProduct } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchema } = require('../services/validations/moduleValidation');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { addProductSchema } = require('../services/validations/productValidation');
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
                specifics = typeof req.body.specifics === 'string'
                    ? JSON.parse(req.body.specifics)
                    : req.body.specifics;
            }
        } catch (e) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid 'specifics' JSON format.");
        }

        let tags = [];
        const tagArray = typeof req.body.tags === 'string'
            ? req.body.tags.split(',').map(tag => tag.trim()).filter(Boolean)
            : [];




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

        console.log("545454", auctionSettings)




        // === Validate required fields ===
        if (!categoryId || !subCategoryId || !title || !condition || !saleType || !deliveryType || !Array.isArray(specifics) || specifics.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required fields.");
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








router.post('/addSellerProduct', perApiLimiter(), upload.array('files', 10), addSellerProduct);




router.get('/getList', perApiLimiter(), globalCrudController.getList(Module));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(Module));
router.post('/create', perApiLimiter(), upload.none(), validateRequest(moduleSchema), globalCrudController.create(Module));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(Module));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(Module));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(Module));

module.exports = router;
