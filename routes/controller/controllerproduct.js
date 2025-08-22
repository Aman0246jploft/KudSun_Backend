const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { SellProduct, Bid, SearchHistory, Follow, User, ProductComment, SellProductDraft, Category, ProductLike, ProductReview } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId, formatTimeRemaining, isNewItem, getBlockedUserIds } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary, deleteImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { SALE_TYPE, DeliveryType, ORDER_STATUS, roleId, conditions, NOTIFICATION_TYPES, createStandardizedNotificationMeta } = require('../../utils/Role');
const { DateTime } = require('luxon');
const { default: mongoose } = require('mongoose');
// Import Algolia service
const { indexProduct, deleteProducts } = require('../services/serviceAlgolia');
// Import notification service
const { saveNotification } = require('../services/serviceNotification');

async function ensureParameterAndValue(categoryId, subCategoryId, key, value, userId = null, role) {
    const category = await Category.findById(categoryId);
    if (!category) throw new Error('Invalid categoryId');

    const subCat = category.subCategories.id(subCategoryId);
    if (!subCat) throw new Error('Invalid subCategoryId');

    let parameter = subCat.parameters.find(p => p.key === key.toLowerCase().trim());

    // If parameter doesn't exist, add it
    if (!parameter) {
        parameter = {
            key: key.toLowerCase().trim(),
            values: [{
                value: value.toLowerCase().trim(),
                isAddedByAdmin: role == roleId.SUPER_ADMIN,
                addedByUserId: userId || null
            }],
            isAddedByAdmin: role == roleId.SUPER_ADMIN,
            addedByUserId: userId || null
        };
        subCat.parameters.push(parameter);
        await category.save();
        parameter = subCat.parameters.find(p => p.key === key.toLowerCase().trim()); // re-fetch
    } else {
        const existingValue = parameter.values.find(v => v.value === value.toLowerCase().trim());
        if (!existingValue) {
            parameter.values.push({
                value: value.toLowerCase().trim(),
                isAddedByAdmin: role == roleId.SUPER_ADMIN,
                addedByUserId: userId || null
            });
            await category.save();
        }
    }

    const paramRef = subCat.parameters.find(p => p.key === key.toLowerCase().trim());
    const valueRef = paramRef.values.find(v => v.value === value.toLowerCase().trim());

    return {
        parameterId: paramRef._id,
        parameterName: paramRef.key,
        valueId: valueRef._id,
        valueName: valueRef.value
    };
}

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
            shippingCharge,
            isDraft,
            draftId // Add this parameter to identify which draft to delete
        } = req.body;


        let specifics = [];
        let auctionSettings = {};


        // Parse JSON fields from form-data



        try {
            if (req.body.specifics) {
                const parsed = typeof req.body.specifics === 'string'
                    ? JSON.parse(req.body.specifics)
                    : req.body.specifics;

                if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Specifics must be a key-value object.");
                }

                for (const [key, value] of Object.entries(parsed)) {
                    if (!key || !value) continue;
                    const spec = await ensureParameterAndValue(
                        categoryId,
                        subCategoryId,
                        key,
                        value,
                        req.user?.userId,
                        req.user?.roleId
                    );
                    specifics.push(spec);
                }
            } else {
                specifics = null;

            }
        } catch (e) {
            console.error("❌ Error in specifics handling:", e);
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid specifics format or processing failed.");
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
                biddingIncrementPrice,
                timeZone
            } = auctionSettings;

            if (!startingPrice || !reservePrice || !biddingIncrementPrice) {
                console.warn("❌ Missing startingPrice or reservePrice or biddingIncrementPrice in auctionSettings:", auctionSettings);
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Auction settings are required when saleType is 'auction'");
            }
            let biddingEndsAtDateTime;

            // CASE 1: endDate + endTime provided
            if (userEndDate && endTime) {
                // Combine date + time and interpret it in user's timeZone correctly
                const dateTimeString = `${userEndDate}T${endTime}`;
                biddingEndsAtDateTime = DateTime.fromISO(dateTimeString, { zone: timeZone });

                // Validate
                if (!biddingEndsAtDateTime.isValid) {
                    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid endDate or endTime with provided timeZone.");
                }
            }
            else if (duration) {
                const now = DateTime.now().setZone(timeZone);
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




            // Test timeZone conversion
            const testDateTime = DateTime.fromISO('2025-07-12T18:44:00', { zone: 'Asia/Kolkata' });




            auctionSettings.biddingEndsAt = new Date(biddingEndsAtDateTime.toUTC().toISO());
            auctionSettings.isBiddingOpen = DateTime.now().setZone('UTC') < biddingEndsAtDateTime.toUTC();
            auctionSettings.endDate = biddingEndsAtDateTime.toISODate();
            auctionSettings.endTime = biddingEndsAtDateTime.toFormat('HH:mm');
            auctionSettings.timeZone = timeZone; // Save timeZone in DB if you want



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
        if (specifics !== null && !Array.isArray(specifics) || specifics?.length === 0) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing or invalid field: specifics must be a non-empty array.");
        }




        if (saleType === SALE_TYPE.FIXED && (!fixedPrice || isNaN(fixedPrice))) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Fixed price is required.");
        }



        if (deliveryType === DeliveryType.CHARGE_SHIPPING && (shippingCharge == null || isNaN(shippingCharge))) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Shipping charge required.");
        }

        if (specifics !== null) {

            // === Specifics validation ===
            for (const spec of specifics) {
                const keys = ['parameterId', 'parameterName', 'valueId', 'valueName'];
                for (const key of keys) {
                    if (!spec[key]) {
                        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Missing '${key}' in specifics.`);
                    }
                }
            }
        }

        // === Upload Images to Cloudinary ===
        let productImages = [];
        let imageArray = req.body.imageArray;
        if (imageArray) {
            if (typeof imageArray === 'string') {
                try {
                    imageArray = JSON.parse(imageArray);
                } catch (err) {
                    return apiErrorRes(400, res, "Invalid imageArray format. Must be a JSON stringified array of URLs.");
                }
            }

            const bodyUrls = (Array.isArray(imageArray) ? imageArray : [imageArray]);
            productImages = bodyUrls.filter(url => typeof url === 'string' && url.trim() !== '');
        }

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

        let savedProduct;
        if (isDraft === 'true' || isDraft === true) {
            // Save to draft collection
            const draft = new SellProductDraft(productData);
            savedProduct = await draft.save();
        } else {
            // Save to main collection
            const product = new SellProduct(productData);
            savedProduct = await product.save();

            // 🔍 Index the product in Algolia after successful save
            try {
                await indexProduct(savedProduct);
            } catch (algoliaError) {
                console.error('Algolia indexing failed for product:', savedProduct._id, algoliaError);
                // Don't fail the main operation if Algolia fails
            }

            // If this is publishing a draft (draftId provided), delete the draft
            if (draftId) {
                try {
                    const deletedDraft = await SellProductDraft.findOneAndDelete({
                        _id: draftId,
                        userId: req.user?.userId // Ensure user owns the draft
                    });

                    if (deletedDraft) {
                        console.log(`Draft product ${draftId} deleted after publishing`);
                    } else {
                        console.warn(`Draft product ${draftId} not found or user doesn't own it`);
                    }
                } catch (draftDeleteError) {
                    console.error("Error deleting draft after publishing:", draftDeleteError);
                    // Don't fail the main operation if draft deletion fails
                }
            }
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, savedProduct);
    } catch (error) {
        console.log(error)
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};



const updateSellerProduct = async (req, res) => {
    try {

        const productId = req.params.id;
        const isDraftUpdate = req?.body?.isDraft === 'true' || req?.body?.isDraft === true || false

        // Find existing product - draft or published depending on isDraftUpdate flag
        const Model = isDraftUpdate ? SellProductDraft : SellProduct;
        const existingProduct = await Model.findById(productId);

        if (!existingProduct) {
            return apiErrorRes(404, res, "Product not found");
        }

        // Prepare fields to update from req.body
        let {
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
            shippingCharge,
            specifics,
            tags,
            auctionSettings,
            timeZone,
            removePhotos,

            isDisable
        } = req.body;


        let processedSpecifics = null;

        if (req.body.specifics && req.body.specifics !== "") {
            try {
                let parsedSpecifics = typeof req.body.specifics === 'string'
                    ? JSON.parse(req.body.specifics)
                    : req.body.specifics;

                if (typeof parsedSpecifics !== 'object' || Array.isArray(parsedSpecifics)) {
                    return apiErrorRes(400, res, "Specifics must be a key-value object.");
                }

                processedSpecifics = [];

                for (const [key, value] of Object.entries(parsedSpecifics)) {
                    if (!key || !value) continue;
                    const spec = await ensureParameterAndValue(
                        categoryId,
                        subCategoryId,
                        key,
                        value,
                        req.user?.userId,
                        req.user?.roleId
                    );
                    processedSpecifics.push(spec);
                }
            } catch (err) {
                console.error("❌ Error processing specifics:", err);
                return apiErrorRes(400, res, "Invalid specifics format or processing failed.");
            }
        }





        // Optional: do the same for auctionSettings
        try {
            if (typeof auctionSettings === 'string') {
                auctionSettings = JSON.parse(auctionSettings);
            }
        } catch (err) {
            return apiErrorRes(400, res, "Invalid JSON in auctionSettings field.");
        }
        specifics = processedSpecifics ?? null;

        // Validate required fields ONLY for published (non-draft) products
        if (!isDraftUpdate) {
            if (!categoryId) return apiErrorRes(400, res, "Missing required field: categoryId.");
            if (!subCategoryId) return apiErrorRes(400, res, "Missing required field: subCategoryId.");
            if (!title) return apiErrorRes(400, res, "Missing required field: title.");
            if (!condition) return apiErrorRes(400, res, "Missing required field: condition.");
            if (!saleType) return apiErrorRes(400, res, "Missing required field: saleType.");
            if (!deliveryType) return apiErrorRes(400, res, "Missing required field: deliveryType.");

            // Condition must be valid

            // specifics must be array and non-empty
            // specifics is optional; validate only if provided
            if (req.body.specifics) {
                if (!Array.isArray(processedSpecifics)) {
                    return apiErrorRes(400, res, "Specifics must be an array if provided.");
                }

                for (const spec of processedSpecifics) {
                    const keys = ['parameterId', 'parameterName', 'valueId', 'valueName'];
                    for (const key of keys) {
                        if (!spec[key]) {
                            return apiErrorRes(400, res, `Missing '${key}' in specifics.`);
                        }
                    }
                }
            } else {
                // if not provided or empty, explicitly set to null
                processedSpecifics = null;
            }

            // saleType specific validations
            if (saleType === SALE_TYPE.FIXED && (fixedPrice == null || isNaN(fixedPrice))) {
                return apiErrorRes(400, res, "Fixed price is required and must be a number.");
            }

            if (saleType === SALE_TYPE.AUCTION) {
                if (!auctionSettings) {
                    return apiErrorRes(400, res, "Auction settings are required.");
                }
                const { startingPrice, reservePrice, duration, endDate, endTime, biddingIncrementPrice, timeZone } = auctionSettings;


                if (startingPrice == null || reservePrice == null || !biddingIncrementPrice) {
                    return apiErrorRes(400, res, "Auction settings must include startingPrice , reservePrice and biddingIncrementPrice.");
                }

                // Validate biddingEndsAt calculation like in add product API
                let biddingEndsAtDateTime;
                const auctionTimezone = timeZone || auctionSettings.timeZone || 'UTC';

                if (endDate && endTime) {
                    biddingEndsAtDateTime = DateTime.fromISO(`${endDate}T${endTime}`, { zone: auctionTimezone });
                    if (!biddingEndsAtDateTime.isValid) {
                        return apiErrorRes(400, res, "Invalid auction endDate or endTime.");
                    }
                } else if (duration != null) {
                    const now = DateTime.now().setZone(auctionTimezone);
                    biddingEndsAtDateTime = now.plus({ days: Number(duration) });
                    if (endTime) {
                        const [h, m] = endTime.split(':').map(Number);
                        biddingEndsAtDateTime = biddingEndsAtDateTime.set({ hour: h, minute: m, second: 0, millisecond: 0 });
                    } else {
                        biddingEndsAtDateTime = biddingEndsAtDateTime.set({ hour: 23, minute: 59, second: 59, millisecond: 0 });
                    }
                } else {
                    return apiErrorRes(400, res, "Auction settings must include either (endDate & endTime) or duration.");
                }

                // console.log('🔍 Update Timezone Debug:', {
                //     timezone: timeZone,
                //     auctionSettingsTimeZone: auctionSettings.timeZone,
                //     finalTimezone: auctionTimezone,
                //     endDate: endDate,
                //     endTime: endTime
                // });


                // auctionSettings.biddingEndsAt = biddingEndsAtDateTime.toJSDate();
                auctionSettings.biddingEndsAt = biddingEndsAtDateTime.toUTC().toJSDate();
                auctionSettings.isBiddingOpen = DateTime.now().setZone('UTC') < biddingEndsAtDateTime.toUTC();
                auctionSettings.endDate = biddingEndsAtDateTime.toISODate();
                auctionSettings.endTime = biddingEndsAtDateTime.toFormat('HH:mm');
                auctionSettings.timeZone = auctionTimezone;
            }

            if (deliveryType === DeliveryType.CHARGE_SHIPPING && (shippingCharge == null || isNaN(shippingCharge))) {
                return apiErrorRes(400, res, "Shipping charge is required and must be a number when delivery type is shipping.");
            }
        }

        // For draft update, allow partial update, no strict validations
        let photoUrls = existingProduct.productImages || [];


        let imageArray = req.body.imageArray;
        if (imageArray) {
            if (typeof imageArray === 'string') {
                try {
                    imageArray = JSON.parse(imageArray);
                } catch (err) {
                    return apiErrorRes(400, res, "Invalid imageArray format, must be JSON-parsable array.");
                }
            }

            const bodyUrls = Array.isArray(imageArray) ? imageArray : [imageArray];

            // Validate all entries are strings
            const cleanBodyUrls = bodyUrls.filter(url => typeof url === 'string' && url.trim() !== '');

            if (!Array.isArray(cleanBodyUrls)) {
                return apiErrorRes(400, res, "imageArray must be an array of valid image URLs.");
            }

            // Delete any images that are not in bodyUrls
            const imagesToDelete = photoUrls.filter(url => !cleanBodyUrls.includes(url));
            for (const url of imagesToDelete) {
                try {
                    await deleteImageCloudinary(url);
                } catch (err) {
                    console.error("Failed to delete image:", url, err);
                }
            }

            // Retain only the requested images
            photoUrls = cleanBodyUrls;
        }







        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'product-images');
                if (imageUrl) photoUrls.push(imageUrl);
            }
        }


        // Update product data
        if (categoryId !== undefined) existingProduct.categoryId = categoryId;
        if (subCategoryId !== undefined) existingProduct.subCategoryId = subCategoryId;
        if (title !== undefined) existingProduct.title = title;
        if (description !== undefined) existingProduct.description = description;
        if (condition !== undefined) existingProduct.condition = condition;
        if (saleType !== undefined) existingProduct.saleType = saleType;
        if (fixedPrice !== undefined) existingProduct.fixedPrice = fixedPrice;
        if (originPriceView !== undefined) existingProduct.originPriceView = originPriceView === 'true' || originPriceView === true;
        if (originPrice !== undefined) existingProduct.originPrice = originPrice;
        if (deliveryType !== undefined) existingProduct.deliveryType = deliveryType;
        if (shippingCharge !== undefined) existingProduct.shippingCharge = shippingCharge;
        if (specifics !== undefined) existingProduct.specifics = specifics;
        if (tags !== undefined) existingProduct.tags = Array.isArray(tags) ? tags : [tags];
        if (auctionSettings !== undefined) existingProduct.auctionSettings = auctionSettings;
        if (isDisable !== undefined) existingProduct.isDisable = isDisable === 'true' || isDisable === true;
        existingProduct.productImages = photoUrls;

        // Save updated product
        const updatedProduct = await existingProduct.save();

        // 🔍 Update the product in Algolia after successful update (only for published products)
        if (!isDraftUpdate) {
            try {
                await indexProduct(updatedProduct);
            } catch (algoliaError) {
                console.error('Algolia update failed for product:', updatedProduct._id, algoliaError);
                // Don't fail the main operation if Algolia fails
            }
        }

        return apiSuccessRes(200, res, "Product updated successfully", updatedProduct);

    } catch (error) {
        console.log(error)
        return apiErrorRes(500, res, error.message, error);
    }
};



const toggleProductDisable = async (req, res) => {
    try {
        const productId = req.params.id;
        const isDraftUpdate = req.body.isDraft === 'true' || req.body.isDraft === true;

        // Find the correct product model based on draft flag
        const Model = isDraftUpdate ? SellProductDraft : SellProduct;
        const product = await Model.findById(productId);

        if (!product) {
            return apiErrorRes(404, res, "Product not found");
        }

        if (typeof req.body.isDisable === 'undefined') {
            return apiErrorRes(400, res, "Missing isDisable field");
        }

        product.isDisable = !product.isDisable

        await product.save();

        const notifications = [];
        const actionByAdmin = req.user?.userId;
        const isNowDisabled = product.isDisable;
        const productImage = product.productImages?.[0] || product.photo || null;

        const productPrice = product.saleType === SALE_TYPE.AUCTION
            ? (product.auctionSettings?.startingBid || 0)
            : (product.fixedPrice || 0);
        const productTitle = product.title;
        // Notify the product owner
        notifications.push({
            recipientId: product.userId, // product owner
            userId: actionByAdmin,
            type: NOTIFICATION_TYPES.ACTIVITY,
            title: isNowDisabled
                ? "Your Product Has Been Deactivated"
                : "Your Product Has Been Activated",
            message: isNowDisabled
                ? `An admin has deactivated your product "${product.title.length > 50 ? product.title.substring(0, 50) + '...' : product.title}".`
                : `An admin has activated your product "${product.title.length > 50 ? product.title.substring(0, 50) + '...' : product.title}".`,
            meta: createStandardizedNotificationMeta({
                productId: product._id.toString(),
                productTitle: product.title,
                productImage: productImage,
                productPrice: productPrice,
                productFixedPrice: product.fixedPrice || null,
                productDeliveryType: product.deliveryType || null,
                productSaleType: product.saleType || null,
                productCondition: product.condition || null,
                sellerId: product.userId._id.toString(),
                actionBy: 'admin',
                timestamp: new Date().toISOString(),
            }),
            redirectUrl: `/products/${product._id}`
        });
        if (notifications.length > 0) {
            try {
                const allowedRecipients = await User.find({
                    _id: { $in: notifications.map(n => n.recipientId) },
                    activityNotification: true
                }).select('_id');

                const allowedIdsSet = new Set(allowedRecipients.map(u => u._id.toString()));

                const filteredNotifications = notifications.filter(n =>
                    allowedIdsSet.has(n.recipientId.toString())
                );

                if (filteredNotifications.length > 0) {
                    await saveNotification(filteredNotifications);
                    console.log(`✅ Notification sent: product ${isNowDisabled ? 'deactivated' : 'activated'}`);
                } else {
                    console.log('⚠️ Product owner has disabled activity notifications. Skipping dispatch.');
                }
            } catch (notificationError) {
                console.error('❌ Failed to send toggle product notifications:', notificationError);
            }
        }


        return apiSuccessRes(200, res, "Product disable status toggled successfully", product);
    } catch (error) {
        return apiErrorRes(500, res, error.message, error);
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
            deliveryFilter,
            specifics,
            isTrending,
            sortBy = 'createdAt',
            orderBy = 'asc',
            includeSold,
            isSold = false,
            condition,
            minPrice,   // NEW
            maxPrice    // NEW
        } = req.query;


        const allowedSortFields = ['createdAt', 'fixedPrice', "commentCount", 'viewCount'];


        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
        const sortOrder = orderBy.toLowerCase() === 'desc' ? -1 : 1;
        const sortOptions = {};
        sortOptions[sortField] = sortOrder;


        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;
        let isAdmin = req.user.roleId == roleId?.SUPER_ADMIN || false

        const filter = {
            saleType: SALE_TYPE.FIXED,
            isDeleted: false,
            // isSold: false
            // _id: { $nin: soldProductIds }
        };

        const blockedUserIds = await getBlockedUserIds(req.user?.userId);
        if (blockedUserIds.length) {
            filter.userId = { $nin: blockedUserIds };
        }


        if (!isAdmin) {
            filter.isDisable = false
        }


        // Price range filter:
        const hasMinPrice = minPrice !== null && minPrice !== undefined && minPrice !== "";
        const hasMaxPrice = maxPrice !== null && maxPrice !== undefined && maxPrice !== "";

        if (hasMinPrice && hasMaxPrice) {
            filter.fixedPrice = {
                $gte: parseFloat(minPrice),
                $lte: parseFloat(maxPrice),
            };
        } else if (hasMinPrice) {
            filter.fixedPrice = {
                $gte: parseFloat(minPrice),
            };
        } else if (hasMaxPrice) {
            filter.fixedPrice = {
                $lte: parseFloat(maxPrice),
            };
        }


        if (includeSold == true || includeSold == "true") {
            // Do not filter isSold — return both sold and unsold
        } else if (isSold === 'true' || isSold === true) {
            filter.isSold = true;
        } else {
            filter.isSold = false; // default
        }

        if (deliveryFilter === "free") {
            filter.deliveryType = { $in: [DeliveryType.FREE_SHIPPING, DeliveryType.LOCAL_PICKUP] };
        } else if (deliveryFilter === "charged") {
            filter.deliveryType = DeliveryType.CHARGE_SHIPPING;
        }

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

        if (typeof isTrending !== "undefined" && isTrending !== "") {
            filter.isTrending = isTrending === true || isTrending === "true";
        }



        if (subCategoryId && subCategoryId !== "") {
            filter.subCategoryId = toObjectId(subCategoryId);
        }
        if (condition && condition !== "") {
            filter.condition = condition;
        }



        if (tags) {
            const tagArray = Array.isArray(tags) ? tags : tags.split(',');
            filter.tags = { $in: tagArray };
        }

        if (specifics) {
            const parsedSpecifics = Array.isArray(specifics) ? specifics : [specifics];
            filter['specifics.valueId'] = { $all: parsedSpecifics.map(id => toObjectId(id)) };
        }



        if (req.query.provinceId || req.query.districtId || req.query.averageRatting) {
            const userFilter = {
                isDeleted: false,
            };

            if (req.query.provinceId) {
                userFilter.provinceId = toObjectId(req.query.provinceId);
            }

            if (req.query.districtId) {
                userFilter.districtId = toObjectId(req.query.districtId);
            }

            if (req.query.averageRatting) {
                const avgRating = parseFloat(req.query.averageRatting);
                if (!isNaN(avgRating)) {
                    userFilter.averageRatting = { $gte: avgRating };
                }
            }

            const matchedUsers = await User.find(userFilter).select("_id").lean();
            const matchedUserIds = matchedUsers.map(user => user._id);

            // Apply user filter if any users matched
            if (matchedUserIds.length > 0) {
                filter.userId = { $in: matchedUserIds };
            } else {
                // If no users match, return empty
                return apiSuccessRes(HTTP_STATUS.OK, res, "Auction products fetched successfully", {
                    pageNo: page,
                    size: limit,
                    total: 0,
                    products: []
                });
            }
        }

        console.log(filter.userId)




        // Special case: commentCount sorting requires aggregation
        if (sortBy === 'commentCount') {
            const matchStage = { ...filter };

            const aggregationPipeline = [
                { $match: matchStage },
                {
                    $lookup: {
                        from: "ProductComment",
                        localField: "_id",
                        foreignField: "product",
                        as: "comments"
                    }
                },
                {
                    $addFields: {
                        commentCount: {
                            $size: {
                                $filter: {
                                    input: "$comments",
                                    as: "comment",
                                    cond: {
                                        $and: [
                                            { $eq: ["$$comment.isDeleted", false] },
                                            { $eq: ["$$comment.isDisable", false] }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                },
                { $sort: { commentCount: sortOrder } },
                { $skip: skip },
                { $limit: limit },
                {
                    $project: {
                        title: 1,
                        fixedPrice: 1,
                        saleType: 1,
                        shippingCharge: 1,
                        deliveryType: 1,
                        isTrending: 1,
                        isDisable: 1,
                        productImages: 1,

                        condition: 1,
                        subCategoryId: 1,
                        isSold: 1,
                        userId: 1,
                        tags: 1,
                        originPriceView: 1,
                        originPrice: 1,
                        description: 1,
                        specifics: 1,
                        categoryId: 1,
                        createdAt: 1
                    }
                }
            ];

            const [products, total] = await Promise.all([
                SellProduct.aggregate(aggregationPipeline),
                SellProduct.countDocuments(matchStage)
            ]);

            // Populate manually (same fields as .populate())
            await SellProduct.populate(products, [
                { path: "categoryId", select: "name" },
                { path: "userId", select: "userName profileImage averageRatting is_Id_verified isLive is_Preferred_seller" }
            ]);

            // Add subCategoryName
            if (products.length) {
                const categoryIds = [...new Set(products.map(p => p.categoryId?._id?.toString()))];

                const categories = await Category.find({ _id: { $in: categoryIds } })
                    .select("subCategories.name subCategories._id")
                    .lean();

                for (const product of products) {
                    const category = categories.find(cat => cat?._id.toString() === product?.categoryId?._id.toString());
                    const subCat = category?.subCategories?.find(sub => sub?._id.toString() === product?.subCategoryId?.toString());
                    product["subCategoryName"] = subCat ? subCat.name : null;
                    product.isNew = isNewItem(product.createdAt);
                }
            }

            // Add isLiked
            if (req.user?.userId && products.length) {
                const productIds = products.map(p => p._id);

                const likedProducts = await ProductLike.find({
                    likeBy: req.user.userId,
                    productId: { $in: productIds },
                    isDeleted: false,
                    isDisable: false
                }).select("productId").lean();

                const likedProductIds = new Set(likedProducts.map(like => like.productId.toString()));
                for (const product of products) {
                    product.isLiked = likedProductIds.has(product._id.toString());
                }
            }

            return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
                pageNo: page,
                size: limit,
                total,
                products
            });
        }




        // Step 3: Query with pagination, sorting, projection
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .select("title fixedPrice saleType shippingCharge deliveryType isTrending isDisable productImages condition subCategoryId isSold userId  tags originPriceView originPrice description specifics createdAt")
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage averageRatting is_Id_verified isLive is_Preferred_seller")
                .lean(),

            SellProduct.countDocuments(filter)
        ]);

        if (products.length) {
            const categoryIds = [...new Set(products.map(p => p.categoryId?._id?.toString()))];

            const categories = await Category.find({ _id: { $in: categoryIds } })
                .select("subCategories.name subCategories._id")
                .lean();

            for (const product of products) {
                const category = categories.find(cat => cat?._id.toString() === product?.categoryId?._id.toString());
                const subCat = category?.subCategories?.find(sub => sub?._id.toString() === product?.subCategoryId?.toString());
                product.isNew = isNewItem(product.createdAt);
                if (subCat) {
                    product["subCategoryName"] = subCat.name;
                } else {
                    product["subCategoryName"] = null;
                }
            }
        }

        if (req.user?.userId && products.length) {
            const productIds = products.map(p => p._id);

            const likedProducts = await ProductLike.find({
                likeBy: req.user.userId,
                productId: { $in: productIds },
                isDeleted: false,
                isDisable: false
            }).select("productId").lean();

            const likedProductIds = new Set(likedProducts.map(like => like.productId.toString()));
            for (const product of products) {
                product.isLiked = likedProductIds.has(product._id.toString());
            }
        }

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
            specifics,
            deliveryFilter,
            isSold = false,
            condition,
            includeSold = false,
            isTrending,
            sortBy = 'auctionSettings.biddingEndsAt',
            orderBy = 'asc',
        } = req.query;






        const allowedSortFields = ['auctionSettings.biddingEndsAt', 'createdAt', "commentCount", "viewCount"];

        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'auctionSettings.biddingEndsAt';
        const sortOrder = orderBy.toLowerCase() === 'desc' ? -1 : 1;

        const sortOptions = {};
        sortOptions[sortField] = sortOrder;

        let isAdmin = req.user.roleId == roleId?.SUPER_ADMIN || false
        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;






        // Step 1: Build filter
        const filter = {
            saleType: SALE_TYPE.AUCTION,
            isDeleted: false,

        };

        const blockedUserIds = await getBlockedUserIds(req.user?.userId);
        if (blockedUserIds.length) {
            filter.userId = { $nin: blockedUserIds };
        }

        if (req.query.spec) {
            const specParams = Array.isArray(req.query.spec) ? req.query.spec : [req.query.spec];
            const specFilters = specParams.map((pair) => {
                const [keyId, valueId] = pair.split(':');
                if (!keyId || !valueId) return null;
                return {
                    specifics: {
                        $elemMatch: {
                            parameterId: toObjectId(keyId),
                            valueId: toObjectId(valueId)
                        }
                    }
                };
            }).filter(Boolean);



            if (specFilters.length) {
                filter.$and = [...(filter.$and || []), ...specFilters];
            }
        }

        if (!isAdmin) {
            filter.isDisable = false
        }

        if (includeSold == true || includeSold == "true") {
            // Do not filter isSold — return both sold and unsold
        } else {
            filter['auctionSettings.isBiddingOpen'] = true

        }

        if (deliveryFilter === "free") {
            filter.deliveryType = { $in: [DeliveryType.FREE_SHIPPING, DeliveryType.LOCAL_PICKUP] };
        } else if (deliveryFilter === "charged") {
            filter.deliveryType = DeliveryType.CHARGE_SHIPPING;
        }

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

        if (typeof isTrending !== "undefined" && isTrending !== "") {
            filter.isTrending = isTrending === true || isTrending === "true";
        }


        if (condition && condition !== "") {
            filter.condition = condition;
        }


        if (tags) {
            const tagArray = Array.isArray(tags) ? tags : tags.split(',');
            filter.tags = { $in: tagArray };
        }

        if (specifics) {
            const parsedSpecifics = Array.isArray(specifics) ? specifics : [specifics];
            filter['specifics.valueId'] = { $all: parsedSpecifics.map(id => toObjectId(id)) };
        }

        if (req.query.provinceId || req.query.districtId || req.query.averageRatting) {
            const userFilter = {
                isDeleted: false,
            };

            if (req.query.provinceId) {
                userFilter.provinceId = toObjectId(req.query.provinceId);
            }

            if (req.query.districtId) {
                userFilter.districtId = toObjectId(req.query.districtId);
            }

            if (req.query.averageRatting) {
                const avgRating = parseFloat(req.query.averageRatting);
                if (!isNaN(avgRating)) {
                    userFilter.averageRatting = { $gte: avgRating };
                }
            }

            const matchedUsers = await User.find(userFilter).select("_id").lean();
            const matchedUserIds = matchedUsers.map(user => user._id);

            // Apply user filter if any users matched
            if (matchedUserIds.length > 0) {
                filter.userId = { $in: matchedUserIds };
            } else {
                // If no users match, return empty
                return apiSuccessRes(HTTP_STATUS.OK, res, "Auction products fetched successfully", {
                    pageNo: page,
                    size: limit,
                    total: 0,
                    products: []
                });
            }
        }





        if (sortBy === 'commentCount') {
            const matchStage = { ...filter };

            const aggregationPipeline = [
                { $match: matchStage },
                {
                    $lookup: {
                        from: "ProductComment",
                        localField: "_id",
                        foreignField: "product",
                        as: "comments"
                    }
                },
                {
                    $addFields: {
                        commentCount: {
                            $size: {
                                $filter: {
                                    input: "$comments",
                                    as: "comment",
                                    cond: {
                                        $and: [
                                            { $eq: ["$$comment.isDeleted", false] },
                                            { $eq: ["$$comment.isDisable", false] }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                },
                { $sort: { commentCount: sortOrder } },
                { $skip: skip },
                { $limit: limit },
                {
                    $project: {
                        title: 1,
                        productImages: 1,
                        condition: 1,
                        isDisable: 1,
                        subCategoryId: 1,
                        auctionSettings: 1,
                        tags: 1,
                        description: 1,
                        specifics: 1,
                        categoryId: 1,
                        userId: 1
                    }
                }
            ];

            const [products, total] = await Promise.all([
                SellProduct.aggregate(aggregationPipeline),
                SellProduct.countDocuments(matchStage)
            ]);

            await SellProduct.populate(products, [
                { path: "categoryId", select: "name" },
                { path: "userId", select: "userName profileImage is_Id_verified isLive is_Preferred_seller" }
            ]);

            // Add subCategoryName
            if (products.length) {
                const categoryIds = [...new Set(products.map(p => p.categoryId?._id?.toString()))];
                const categories = await Category.find({ _id: { $in: categoryIds } }).select("subCategories.name subCategories._id").lean();

                for (const product of products) {
                    const category = categories.find(cat => cat?._id.toString() === product?.categoryId?._id.toString());
                    const subCat = category?.subCategories?.find(sub => sub?._id.toString() === product?.subCategoryId?.toString());
                    product["subCategoryName"] = subCat ? subCat.name : null;
                }
            }

            // Add bid counts
            const productIds = products.map(p => toObjectId(p._id));
            const bidsCounts = await Bid.aggregate([
                { $match: { productId: { $in: productIds } } },
                { $group: { _id: "$productId", totalBidsPlaced: { $sum: 1 } } }
            ]);
            const bidsCountMap = bidsCounts.reduce((acc, curr) => {
                acc[curr._id.toString()] = curr.totalBidsPlaced;
                return acc;
            }, {});

            // Add timeRemaining & bids count
            for (const product of products) {
                const utcEnd = DateTime.fromJSDate(product.auctionSettings.biddingEndsAt, { zone: 'utc' });
                const utcDate = DateTime.fromJSDate(product.auctionSettings.biddingEndsAt, { zone: 'utc' });
                const localDate = utcDate.setZone(product.auctionSettings.timeZone || 'Asia/Kolkata');

                const utcNow = DateTime.utc();
                const timeLeftMs = utcEnd.diff(utcNow).toMillis();
                product.totalBidsPlaced = bidsCountMap[product._id.toString()] || 0;
                const nowTimestamp = new Date()
                const offsetMinutes = nowTimestamp.getTimezoneOffset();
                const localNow = new Date(nowTimestamp.getTime() - offsetMinutes * 60 * 1000);
                const endTime = new Date(product.auctionSettings.biddingEndsAt).getTime();
                product.timeRemaining = timeLeftMs > 0 ? formatTimeRemaining(timeLeftMs) : 0;
                product.auctionSettings.biddingEndsAt = localDate.toISO();
                product.isNew = isNewItem(product.createdAt);

            }

            // Add isLiked
            let likedProductIds = new Set();
            if (req.user && req.user.userId) {
                const likes = await ProductLike.find({
                    likeBy: req.user.userId,
                    productId: { $in: productIds },
                    isDisable: false,
                    isDeleted: false,
                }).select("productId").lean();
                likedProductIds = new Set(likes.map(like => like.productId.toString()));
            }
            products.forEach(product => {
                product.isLiked = likedProductIds.has(product._id.toString());
            });

            return apiSuccessRes(HTTP_STATUS.OK, res, "Auction products fetched successfully", {
                pageNo: page,
                size: limit,
                total,
                products
            });
        }



        if (sortBy === 'bidCount') {
            const matchStage = { ...filter };

            const aggregationPipeline = [
                { $match: matchStage },
                {
                    $lookup: {
                        from: "Bid", // change to actual collection name if needed
                        localField: "_id",
                        foreignField: "productId",
                        as: "bids"
                    }
                },
                {
                    $addFields: {
                        bidCount: { $size: "$bids" }
                    }
                },
                { $sort: { bidCount: sortOrder } },
                { $skip: skip },
                { $limit: limit },
                {
                    $project: {
                        title: 1,
                        productImages: 1,
                        condition: 1,
                        isDisable: 1,
                        subCategoryId: 1,
                        auctionSettings: 1,
                        tags: 1,
                        description: 1,
                        specifics: 1,
                        categoryId: 1,
                        userId: 1,
                        createdAt: 1
                    }
                }
            ];

            const [products, total] = await Promise.all([
                SellProduct.aggregate(aggregationPipeline),
                SellProduct.countDocuments(matchStage)
            ]);

            await SellProduct.populate(products, [
                { path: "categoryId", select: "name" },
                { path: "userId", select: "userName profileImage is_Id_verified isLive is_Preferred_seller" }
            ]);

            if (products.length) {
                const categoryIds = [...new Set(products.map(p => p.categoryId?._id?.toString()))];
                const categories = await Category.find({ _id: { $in: categoryIds } }).select("subCategories.name subCategories._id").lean();

                for (const product of products) {
                    const category = categories.find(cat => cat?._id.toString() === product?.categoryId?._id.toString());
                    const subCat = category?.subCategories?.find(sub => sub._id.toString() === product?.subCategoryId?.toString());
                    product["subCategoryName"] = subCat ? subCat.name : null;
                }
            }

            const productIds = products.map(p => toObjectId(p._id));
            const bidsCounts = await Bid.aggregate([
                { $match: { productId: { $in: productIds } } },
                { $group: { _id: "$productId", totalBidsPlaced: { $sum: 1 } } }
            ]);
            const bidsCountMap = bidsCounts.reduce((acc, curr) => {
                acc[curr._id.toString()] = curr.totalBidsPlaced;
                return acc;
            }, {});

            for (const product of products) {
                const utcEnd = DateTime.fromJSDate(product.auctionSettings.biddingEndsAt, { zone: 'utc' });
                const localDate = utcEnd.setZone(product.auctionSettings.timeZone || 'Asia/Kolkata');
                const utcNow = DateTime.utc();
                const timeLeftMs = utcEnd.diff(utcNow).toMillis();
                product.totalBidsPlaced = bidsCountMap[product._id.toString()] || 0;
                product.timeRemaining = timeLeftMs > 0 ? formatTimeRemaining(timeLeftMs) : 0;
                product.auctionSettings.biddingEndsAt = localDate.toISO();
                product.isNew = isNewItem(product.createdAt);
            }

            let likedProductIds = new Set();
            if (req.user && req.user.userId) {
                const likes = await ProductLike.find({
                    likeBy: req.user.userId,
                    productId: { $in: productIds },
                    isDisable: false,
                    isDeleted: false,
                }).select("productId").lean();

                likedProductIds = new Set(likes.map(like => like.productId.toString()));
            }

            products.forEach(product => {
                product.isLiked = likedProductIds.has(product._id.toString());
            });

            return apiSuccessRes(HTTP_STATUS.OK, res, "Auction products fetched successfully", {
                pageNo: page,
                size: limit,
                total,
                products
            });
        }




        // Step 2: Query and paginate
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .sort(sortOptions) // Ending soonest first
                .skip(skip)
                .limit(limit)
                .select("title productImages isSold condition isDisable subCategoryId auctionSettings tags description specifics createdAt")
                .populate("categoryId", "name")
                .populate("userId", "userName profileImage averageRatting is_Id_verified isLive is_Preferred_seller")
                .lean(),
            SellProduct.countDocuments(filter)
        ]);

        if (products.length) {
            const categoryIds = [...new Set(products.map(p => p.categoryId?._id?.toString()))];

            const categories = await Category.find({ _id: { $in: categoryIds } })
                .select("subCategories.name subCategories._id")
                .lean();

            for (const product of products) {
                product.isNew = isNewItem(product.createdAt);

                const category = categories.find(cat => cat?._id.toString() === product?.categoryId?._id.toString());
                const subCat = category?.subCategories?.find(sub => sub?._id.toString() === product?.subCategoryId?.toString());
                if (subCat) {
                    product["subCategoryName"] = subCat.name;
                } else {
                    product["subCategoryName"] = null;
                }
            }
        }

        const productIds = products.map(p => toObjectId(p._id));
        // Aggregate bids count grouped by productId
        const bidsCounts = await Bid.aggregate([
            { $match: { productId: { $in: productIds } } },
            { $group: { _id: "$productId", totalBidsPlaced: { $sum: 1 }, highestBidAmount: { $max: "$amount" } } }
        ]);

        // Create a map for quick lookup
        const bidsCountMap = bidsCounts.reduce((acc, curr) => {
            acc[curr._id.toString()] = {
                totalBidsPlaced: curr.totalBidsPlaced,
                highestBidAmount: curr.highestBidAmount || 0
            };
            return acc;
        }, {});


        products.forEach(product => {
            const utcEnd = DateTime.fromJSDate(product.auctionSettings.biddingEndsAt, { zone: 'utc' });
            const utcDate = DateTime.fromJSDate(product.auctionSettings.biddingEndsAt, { zone: 'utc' });
            const localDate = utcDate.setZone(product.auctionSettings.timeZone || 'Asia/Kolkata');
            const utcNow = DateTime.utc();
            const timeLeftMs = utcEnd.diff(utcNow).toMillis();
            const bidData = bidsCountMap[product._id.toString()] || { totalBidsPlaced: 0, highestBidAmount: 0 };
            product.totalBidsPlaced = bidData.totalBidsPlaced;
            product.highestBidAmount = bidData.highestBidAmount; // <--- Just add this line
            const nowTimestamp = new Date()
            const offsetMinutes = nowTimestamp.getTimezoneOffset();
            const localNow = new Date(nowTimestamp.getTime() - offsetMinutes * 60 * 1000);
            const endTime = new Date(product.auctionSettings.biddingEndsAt).getTime();
            // const timeLeftMs = endTime - localNow;
            product.timeRemaining = timeLeftMs > 0 ? formatTimeRemaining(timeLeftMs) : 0;
            product.auctionSettings.biddingEndsAt = localDate.toISO(); // with offset
            product.isSold = product.isSold;
        })

        let likedProductIds = new Set();
        if (req.user && req.user.userId) {
            const likes = await ProductLike.find({
                likeBy: req.user.userId,
                productId: { $in: productIds },
                isDisable: false,
                isDeleted: false,
            }).select("productId").lean();

            likedProductIds = new Set(likes.map(like => like.productId.toString()));
        }
        products.forEach(product => {
            product.isLiked = likedProductIds.has(product._id.toString());
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
            isSold: false,
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
                .select("title productImages auctionSettings.reservePrice condition tags description createdAt auctionSettings.biddingEndsAt")
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



const getProductsPerSubCategory = async ({
    categoryId,
    sizePerSub = 10,
    extraMatch = {},        // keyword / tags / specifics / condition …
}) => {
    const catId = toObjectId(categoryId);

    /*  We start from the Category collection, unwind its subCategories,
     *  and then $lookup the products (LEFT‑OUTER join ➜ empty array if none).
     */
    const pipeline = [
        { $match: { _id: catId } },
        { $unwind: '$subCategories' },

        // keep only the meta we need
        {
            $project: {
                _id: 0,
                subCategoryId: '$subCategories._id',
                subCategory: {
                    name: '$subCategories.name',
                    slug: '$subCategories.slug',
                    image: '$subCategories.image'
                }
            }
        },

        // LEFT JOIN SellProduct ➜ 'products' (slice to 10)
        {
            $lookup: {
                from: 'SellProduct',
                let: { subId: '$subCategoryId' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$subCategoryId', '$$subId'] },
                                    { $eq: ['$isDeleted', false] },
                                    { $eq: ['$isDisable', false] },
                                    { $eq: ['$isSold', false] },
                                ]
                            },
                            ...extraMatch       // same filters you build in the controller
                        }
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: sizePerSub }
                ],
                as: 'products'
            }
        },

        // tidy ordering
        { $sort: { 'subCategory.slug': 1 } }
    ];

    return Category.aggregate(pipeline);
};








const fetchCombinedProducts = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            keyWord,
            categoryId,
            subCategoryId,// Can be single ID, comma-separated string, or array
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
        const LIMITED_DEALS_LIMIT = 10;
        const now = new Date();
        const next24Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);


        const parseSubCategoryIds = (subCategoryId) => {
            if (!subCategoryId) return null;

            if (Array.isArray(subCategoryId)) {
                return subCategoryId.map(id => toObjectId(id));
            }

            if (typeof subCategoryId === 'string') {
                // Handle comma-separated string
                const ids = subCategoryId.split(',').map(id => id.trim()).filter(id => id);
                return ids.length > 0 ? ids.map(id => toObjectId(id)) : null;
            }

            return [toObjectId(subCategoryId)];
        };

        const subCategoryIds = parseSubCategoryIds(subCategoryId);



        const limitedFilter = {
            saleType: SALE_TYPE.AUCTION,
            isDeleted: false,
            isSold: false,
            isDisable: false,
            'auctionSettings.isBiddingOpen': true,
            'auctionSettings.biddingEndsAt': { $gte: now, $lte: next24Hours },

            // Keep UI filters consistent
            ...(categoryId && { categoryId: toObjectId(categoryId) }),
            ...(subCategoryIds && { subCategoryId: { $in: subCategoryIds } }),
            ...(condition && { condition })
        };

        if (keyWord) {
            limitedFilter.$or = [
                { title: { $regex: keyWord, $options: 'i' } },
                { description: { $regex: keyWord, $options: 'i' } },
                { tags: { $regex: keyWord, $options: 'i' } }
            ];
        }
        if (tags) {
            const tagArray = Array.isArray(tags) ? tags : tags.split(',');
            limitedFilter.tags = { $in: tagArray };
        }
        if (specifics) {
            const parsed = Array.isArray(specifics) ? specifics : [specifics];
            limitedFilter['specifics.valueId'] = { $all: parsed.map(id => toObjectId(id)) };
        }

        // -- pull at most 10 deals
        const limitedProductsRaw = await SellProduct.find(limitedFilter)
            .sort({ 'auctionSettings.biddingEndsAt': 1 })
            .limit(LIMITED_DEALS_LIMIT)               // 👈 hard‑coded cap
            .select(`
        title productImages auctionSettings.reservePrice condition
        tags description originPriceView specifics originPrice createdAt auctionSettings.biddingEndsAt
      `)
            .populate('categoryId', 'name')
            .populate('userId', 'userName averageRatting profileImage is_Id_verified is_Verified_Seller isLive')
            .lean();

        // Enhance with bid counts & timers (same helper you already use)
        if (limitedProductsRaw.length) {
            const ids = limitedProductsRaw.map(p => toObjectId(p._id));
            const bidAgg = await Bid.aggregate([
                { $match: { productId: { $in: ids } } },
                { $group: { _id: '$productId', totalBidsPlaced: { $sum: 1 } } }
            ]);
            const bidsMap = bidAgg.reduce((a, c) => ({ ...a, [c._id]: c.totalBidsPlaced }), {});
            const nowTs = Date.now();
            limitedProductsRaw.forEach(p => {
                const end = new Date(p.auctionSettings.biddingEndsAt).getTime();
                const left = Math.max(end - nowTs, 0);
                p.timeRemaining = left;
                p.timeRemainingStr = formatTimeRemaining(left);
                p.totalBidsPlaced = bidsMap[p._id.toString()] || 0;
            });
        }



        // Step 1: Get sold product IDs for normal products (cached approach recommended)
        const page = Number.isInteger(+pageNo) && +pageNo > 0 ? +pageNo : 1;
        const limit = parseInt(size);
        const skip = (page - 1) * limit;



        // Step 2: Build base filter
        const baseFilter = {
            isDeleted: false,
            isDisable: false,
            isSold: false
        };

        // Step 3: Build sale type specific filters
        let saleTypeFilters = [];

        if (!saleType || saleType === 'all' || saleType === 'normal') {
            saleTypeFilters.push({
                ...baseFilter,
                saleType: SALE_TYPE.FIXED,
                isSold: false,
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

            // Enhanced subcategory filter - supports multiple IDs
            if (subCategoryIds && subCategoryIds.length > 0) {
                updatedFilter.subCategoryId = { $in: subCategoryIds };
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
                .populate("userId", "userName averageRatting profileImage is_Id_verified is_Verified_Seller isLive")
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
                        isBiddingOpen: product.auctionSettings.isBiddingOpen,
                        endTime: product.auctionSettings.biddingEndsAt,
                        biddingEndsAt: product.auctionSettings.biddingEndsAt,
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
                auctionSettings: p.auctionSettings || null,
                ...(p.timeRemainingFormatted && { timeRemainingFormatted: p.timeRemainingFormatted }),
                ...(typeof p.totalBidsPlaced !== 'undefined' && { totalBidsPlaced: p.totalBidsPlaced }),
            };
        });





        let subCategoryGroups = [];
        if (categoryId) {
            subCategoryGroups = await getProductsPerSubCategory({
                categoryId,
                sizePerSub: 10,      // hard cap – tweak or make another query param
            });
        }


        let output = {
            products: finalProducts,

            limitedProducts: limitedProductsRaw,
            ...(subCategoryGroups.length && { subCategoryGroups })
        }


        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
            pageNo: page,
            size: limit,
            total: totalCount,
            data: output
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
            saleType = 'fixed',
            sortBy = 'createdAt',
            orderBy = 'desc',
            categoryId,
            subCategoryId,
            condition,
            minPrice,   // NEW
            maxPrice,    // NEW
            tags,
            specifics,
            keyWord,
        } = req.query;


        const allowedSortFields = ['auctionSettings.biddingEndsAt', 'createdAt', "viewCount", "fixedPrice"];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
        const sortOrder = orderBy.toLowerCase() === 'desc' ? -1 : 1;
        const sortOptions = {};
        sortOptions[sortField] = sortOrder;



        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const requesterId = req.user?.userId?.toString();
        const isSelfProfile = userId && requesterId && userId === requesterId || false;

        let filter = {};
        if (saleType === 'auction') {
            filter.saleType = SALE_TYPE.AUCTION;
        } else if (saleType === 'all') {
            filter.saleType = { $in: [SALE_TYPE.FIXED, SALE_TYPE.AUCTION] };
        } else {
            filter.saleType = SALE_TYPE.FIXED;
        }

        if (userId) {
            filter.userId = toObjectId(userId);
        }
        if (condition && condition !== "") {
            filter.condition = condition;
        }

        if (categoryId && categoryId !== "") {
            filter.categoryId = toObjectId(categoryId);
        }

        if (subCategoryId && subCategoryId !== "") {
            filter.subCategoryId = toObjectId(subCategoryId);
        }

        if (keyWord && keyWord.trim() !== "") {
            const regex = new RegExp(keyWord.trim(), "i");
            filter.$or = [
                { title: regex },
                { description: regex },
                { tags: regex }, // if tags is an array of strings
            ];
        }


        if (isSelfProfile) {
            filter.isDeleted = false;
            filter.isDisable = false;
        }

        // Price range filter:
        const hasMinPrice = minPrice !== null && minPrice !== undefined && minPrice !== "";
        const hasMaxPrice = maxPrice !== null && maxPrice !== undefined && maxPrice !== "";

        if (hasMinPrice && hasMaxPrice) {
            filter.fixedPrice = {
                $gte: parseFloat(minPrice),
                $lte: parseFloat(maxPrice),
            };
        } else if (hasMinPrice) {
            filter.fixedPrice = {
                $gte: parseFloat(minPrice),
            };
        } else if (hasMaxPrice) {
            filter.fixedPrice = {
                $lte: parseFloat(maxPrice),
            };
        }


        if (req.query.provinceId || req.query.districtId || req.query.averageRatting) {
            const userFilter = {
                isDeleted: false,
            };

            if (req.query.provinceId) {
                userFilter.provinceId = toObjectId(req.query.provinceId);
            }

            if (req.query.districtId) {
                userFilter.districtId = toObjectId(req.query.districtId);
            }

            if (req.query.averageRatting) {
                const avgRating = parseFloat(req.query.averageRatting);
                if (!isNaN(avgRating)) {
                    userFilter.averageRatting = { $gte: avgRating };
                }
            }

            const matchedUsers = await User.find(userFilter).select("_id").lean();
            const matchedUserIds = matchedUsers.map(user => user._id);

            // Apply user filter if any users matched
            if (matchedUserIds.length > 0) {
                filter.userId = { $in: matchedUserIds };
            } else {
                // If no users match, return empty
                return apiSuccessRes(HTTP_STATUS.OK, res, "Auction products fetched successfully", {
                    pageNo: page,
                    size: limit,
                    total: 0,
                    products: []
                });
            }
        }



        // Fetch products and total count
        const [products, total] = await Promise.all([
            SellProduct.find(filter)
                .select(`
                    title 
                    description
                    fixedPrice 
                    originPrice
                    specifics
                    saleType    
                    condition 
                    productImages 
                    auctionSettings 
                    createdAt
                    isSold
                `)
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .lean(),
            SellProduct.countDocuments(filter)
        ]);

        // Get all product IDs for auction products
        const auctionProductIds = products
            .filter(p => p.saleType === SALE_TYPE.AUCTION)
            .map(p => p._id);

        let bidCountsMap = {};
        if (auctionProductIds.length > 0) {
            // Aggregate bid counts grouped by productId
            const bidCounts = await Bid.aggregate([
                { $match: { productId: { $in: auctionProductIds } } },
                { $group: { _id: "$productId", count: { $sum: 1 } } }
            ]);
            // Map productId to count
            bidCountsMap = bidCounts.reduce((acc, curr) => {
                acc[curr._id.toString()] = curr.count;
                return acc;
            }, {});
        }
        const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        const now = Date.now();
        // Enhance products with totalBidCount for auctions
        const finalProducts = products.map(product => ({
            ...product,
            totalBidsPlaced: product.saleType === SALE_TYPE.AUCTION
                ? (bidCountsMap[product._id.toString()] || 0)
                : undefined,
            isNew: now - new Date(product.createdAt).getTime() <= ONE_DAY_MS
        }));

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




const createHistory = async (req, res) => {
    const { searchQuery, pageNo = 1, size = 10 } = req.query;
    const { userId } = req.user;

    if (!searchQuery) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Search query is required");
    }

    const page = parseInt(pageNo);
    const limit = parseInt(size);
    const skip = (page - 1) * limit;

    let history = await SearchHistory.findOne({
        searchQuery,
        userId,
        type: 'search'
    });

    if (history) {
        history.searchCount = (history.searchCount || 0) + 1;
        history.lastSearched = new Date();
        if (history.isDeleted || history.isDisable) {
            history.isDeleted = false;
            history.isDisable = false;
        }
        await history.save();
    } else {
        // Only create if it doesn't already exist
        await SearchHistory.create({
            userId,
            searchQuery,
            type: 'search',
            searchCount: 1,
            lastSearched: new Date()
        });
    }

    const total = await SearchHistory.countDocuments({
        userId,
        type: 'search',
        isDeleted: false,
        isDisable: false,
    });

    const allHistories = await SearchHistory.find({
        userId,
        type: 'search',
        isDeleted: false,
        isDisable: false,
    })
        .select('-createdAt -updatedAt')
        .sort({ lastSearched: -1 })
        .skip(skip)
        .limit(limit);

    return apiSuccessRes(HTTP_STATUS.CREATED, res, 'History updated', {
        pageNo: page,
        size: limit,
        total,
        data: allHistories,
    });
};

/**
 * Track when user clicks on or views a product
 */
const trackProductView = async (req, res) => {
    try {
        const { productId } = req.params;
        const { userId } = req.user;
        const { source = 'search' } = req.query; // where they came from

        if (!productId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Product ID is required");
        }

        // Find the product to get its title
        const product = await SellProduct.findById(productId)
            .select('title categoryId')
            .lean();

        if (!product) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Product not found");
        }

        // Track the product view
        if (userId) {
            await SearchHistory.create({
                userId: toObjectId(userId),
                searchQuery: product.title,
                type: 'product_view',
                productId: toObjectId(productId),
                categoryId: product.categoryId,
                searchCount: 1,
                lastSearched: new Date(),
                filters: { source }
            });
        }

        // Increment product view count
        await SellProduct.findByIdAndUpdate(
            productId,
            { $inc: { viewCount: 1 } }
        );

        return apiSuccessRes(HTTP_STATUS.OK, res, "Product view tracked");

    } catch (error) {
        console.error('Track product view error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to track view");
    }
};

/**
 * Get user's view history (recently viewed products)
 */
const getViewHistory = async (req, res) => {
    try {
        const { userId } = req.user;
        const { pageNo = 1, size = 20 } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const viewHistory = await SearchHistory.find({
            userId: toObjectId(userId),
            type: 'product_view',
            isDeleted: false
        })
            .populate({
                path: 'productId',
                select: 'title productImages fixedPrice saleType condition isSold userId',
                populate: {
                    path: 'userId',
                    select: 'userName profileImage'
                }
            })
            .sort({ lastSearched: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await SearchHistory.countDocuments({
            userId: toObjectId(userId),
            type: 'product_view',
            isDeleted: false
        });

        // Filter out products that may have been deleted
        const validHistory = viewHistory.filter(item => item.productId);

        return apiSuccessRes(HTTP_STATUS.OK, res, "View history fetched", {
            pageNo: page,
            size: limit,
            total,
            data: validHistory
        });

    } catch (error) {
        console.error('Get view history error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to fetch view history");
    }
};



const clearAllHistory = async (req, res) => {
    try {
        const { userId } = req.user;

        await SearchHistory.updateMany(
            { userId, isDeleted: false },
            { $set: { isDeleted: true } }
        );

        return apiSuccessRes(HTTP_STATUS.OK, res, "All search history cleared");
    } catch (error) {
        console.error("clearAllHistory error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Internal server error");
    }
};

const clearOneHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.user;

        const result = await SearchHistory.findOneAndUpdate(
            { _id: id, userId, isDeleted: false },
            { $set: { isDeleted: true } }
        );

        if (!result) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "History not found or already deleted");
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Search history item deleted");
    } catch (error) {
        console.error("clearOneHistory error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Internal server error");
    }
};



const getSearchHistory = async (req, res) => {
    try {
        const { userId } = req.user;
        const { pageNo = 1, size = 10 } = req.query;

        const skip = (parseInt(pageNo) - 1) * parseInt(size);
        const limit = parseInt(size);

        const [history, total] = await Promise.all([
            SearchHistory.find({ userId, isDeleted: false })
                .select('-createdAt -updatedAt')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            SearchHistory.countDocuments({ userId, isDeleted: false })
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Fetched search history", {
            pageNo: parseInt(pageNo),
            size: parseInt(size),
            total,
            data: history
        });
    } catch (error) {
        console.error("getSearchHistory error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Internal server error");
    }
};


const getProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const loginUserId = req.user?.userId;
        const isDraft = req.query.draft === 'true';

        let query = {
            _id: id,
            // isDeleted: false,
            // isDisable: false,
        };

        if (req.query.isDeleted) {
            query.isDeleted = true;
        }
        if (req.query.isDisable) {
            query.isDisable = true;
        }

        if (isDraft) {
            query.isDraft = true;
        } else {
            // query.isSold = false;
            query.isDraft = { $ne: true };
        }

        const product = await SellProduct.findOne(query)
            .populate([
                {
                    path: 'categoryId',
                    select: 'name',
                },
                {
                    path: 'userId',
                    select: 'userName profileImage is_Id_verified is_Preferred_seller isLive averageRatting provinceId districtId',
                    populate: [
                        {
                            path: 'provinceId',
                            select: 'value', // adjust as needed
                        },
                        {
                            path: 'districtId',
                            select: 'value', // adjust as needed
                        },
                    ],
                },
            ])
            .lean();


        if (!product) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Product not found or unavailable.");
        }

        // Increment view count (only for non-draft products)
        if (!isDraft) {
            await SellProduct.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });

            // Trigger trending update job
            const { addTrendingUpdateJob } = require('../services/serviceTrending');
            addTrendingUpdateJob(id);
        }

        // --- Seller Info
        const user = await User.findById(product.userId)
            .select('userName profileImage is_Id_verified is_Preferred_seller isLive averageRatting ')
            .lean();

        const followersCount = await Follow.countDocuments({
            userId: toObjectId(product.userId?._id),
            // isDeleted: false,
            // isDisable: false
        });

        let isFollowing = false;
        if (loginUserId) {
            const followDoc = await Follow.findOne({
                userId: toObjectId(product.userId?._id),
                followedBy: toObjectId(loginUserId),
                isDeleted: false,
                isDisable: false
            });
            isFollowing = !!followDoc;
        }

        product.seller = {
            ...user,
            ...product.userId,
            followers: followersCount,
            isFollowing
        };

        // --- Auction Info (if applicable)
        if (product.saleType === SALE_TYPE.AUCTION) {
            const allBids = await Bid.find({ productId: id }).populate({
                path: 'userId',
                select: '_id userName profileImage isLive createdAt'
            }).sort({ placedAt: -1 }).lean({ getters: true });

            const totalBids = allBids.length;
            const isReserveMet = allBids.some(bid => bid.isReserveMet === true);
            const currentHighestBid = allBids.reduce((max, bid) => bid.amount > max.amount ? bid : max, { amount: 0 });

            const bidders = allBids.map(bid => {
                const uid = bid.userId._id.toString();
                return {
                    ...bid.userId,                 // populated user info
                    bidAmount: bid.amount,
                    myBid: loginUserId?.toString() === uid,
                    createdAt: bid.createdAt
                };
            });



            product.auctionDetails = {
                ...product.auctionSettings,
                totalBids,
                isReserveMet,
                isLiveAuction: product.auctionSettings?.isBiddingOpen || false,
                currentHighestBid: {
                    userId: currentHighestBid.userId,
                    amount: currentHighestBid.amount,
                    placedAt: currentHighestBid.placedAt
                },
                bidders
            };
        }

        const [totalComments, topComments] = await Promise.all([
            ProductComment.countDocuments({
                product: product?._id,
                parent: null,
                isDeleted: false,
                isDisable: false
            }),
            ProductComment.aggregate([
                {
                    $match: {
                        product: toObjectId(product?._id),
                        parent: null,
                        isDeleted: false,
                        isDisable: false
                    }
                },
                { $sort: { createdAt: -1 } },
                { $limit: 2 },
                {
                    $lookup: {
                        from: 'User',
                        localField: 'author',
                        foreignField: '_id',
                        as: 'author'
                    }
                },
                { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },

                {
                    $lookup: {
                        from: 'ProductComment',
                        let: { commentId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$parent', '$$commentId'] },
                                    isDeleted: false,
                                    isDisable: false
                                }
                            },
                            { $sort: { createdAt: 1 } },
                            { $limit: 2 }, // Limit to top 2 replies
                            {
                                $lookup: {
                                    from: 'User',
                                    localField: 'author',
                                    foreignField: '_id',
                                    as: 'author'
                                }
                            },
                            {
                                $unwind: {
                                    path: '$author',
                                    preserveNullAndEmptyArrays: true
                                }
                            },
                            {
                                $project: {
                                    _id: 1,
                                    content: 1,
                                    createdAt: 1,
                                    photos: 1,
                                    author: {
                                        _id: '$author._id',
                                        userName: '$author.userName',
                                        profileImage: '$author.profileImage'
                                    }
                                }
                            }
                        ],
                        as: 'replies'
                    }
                },
                {
                    $addFields: {
                        totalReplies: { $size: '$replies' }
                    }
                },
                {
                    $project: {
                        _id: 1,
                        content: 1,
                        createdAt: 1,
                        photos: 1,
                        totalReplies: 1,
                        replies: 1,
                        author: {
                            _id: '$author._id',
                            userName: '$author.userName',
                            profileImage: '$author.profileImage'
                        }
                    }
                }
            ])
        ]);

        product.commentData = {
            totalComments,
            topComments
        };

        const latestProducts = await SellProduct.find({
            userId: product.userId?._id,
            _id: { $ne: product._id },
            isDeleted: false,
            isDisable: false,
            isDraft: { $ne: true },
            isSold: false,
        })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('fixedPrice auctionSettings productImages isSold') // select fields you want to return
            .lean();
        product.latestUserProducts = latestProducts;



        const recommendedProducts = await SellProduct.find({
            categoryId: product?.categoryId?._id || product?.categoryId || product?.subCategoryId,
            _id: { $ne: product._id },
            isDeleted: false,
            // saleType:SALE_TYPE.FIXED / AUCTION ,
            isDisable: false,
            isSold: false,
            isDraft: { $ne: true },
            $or: [
                { saleType: SALE_TYPE.FIXED },
                { saleType: SALE_TYPE.AUCTION, "auctionSettings.isBiddingOpen": true }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('fixedPrice auctionSettings productImages isSold title saleType userId') // include userId to populate it
            .populate({
                path: 'userId',
                select: 'averageRatting userName isLive profileImage is_Verified_Seller is_Id_verified'
            })
            .lean();



        product.recommendedProducts = recommendedProducts;

        const auctionProductIds = recommendedProducts
            .filter(p => p.saleType === SALE_TYPE.AUCTION)
            .map(p => p._id);

        const totalLike = await ProductLike.countDocuments({
            productId: toObjectId(id)
        })

        const bidCounts = await Bid.aggregate([
            {
                $match: {
                    productId: { $in: auctionProductIds }
                }
            },
            {
                $group: {
                    _id: '$productId',
                    totalBids: { $sum: 1 }
                }
            }
        ]);
        // Create a map for quick lookup
        const bidCountMap = new Map();
        bidCounts.forEach(b => {
            bidCountMap.set(b._id.toString(), b.totalBids);
        });
        // Add totalBids to auction products only
        product.recommendedProducts = recommendedProducts.map(p => {
            if (p.saleType === SALE_TYPE.AUCTION) {
                const count = bidCountMap.get(p._id.toString()) || 0;
                return {
                    ...p,
                    totalBids: count
                };
            }
            return p;
        });

        if (loginUserId) {

            const isLike = await ProductLike.exists({
                productId: toObjectId(id),
                likeBy: toObjectId(loginUserId)
            })
            product.isLike = !!isLike

        }

        product.totalLike = totalLike

        return apiSuccessRes(HTTP_STATUS.OK, res, "Product fetched successfully.", product);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


const addComment = async (req, res) => {
    try {
        let value = req.body
        let imageList = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const image = await uploadImageCloudinary(file, 'comment-images');
                if (image) imageList.push(image);
            }
        }
        let productIds = [];
        if (value.associatedProducts) {
            const raw = Array.isArray(value.associatedProducts)
                ? value.associatedProducts
                : [value.associatedProducts];

            // Clean array: remove empty strings or invalid ObjectId formats
            productIds = raw
                .map(id => id.trim?.()) // optional chaining for safety
                .filter(id => id && /^[a-f\d]{24}$/i.test(id)); // only valid Mongo ObjectIds
        }
        const comment = new ProductComment({
            content: value.content || '',
            product: value.product,
            parent: value.parent || null,
            associatedProducts: productIds,
            photos: imageList,
            author: req.user?.userId
        });
        const saved = await comment.save();

        // Get product and commenter details for notifications
        const product = await SellProduct.findById(value.product).populate('userId', 'userName profileImage');
        const commenter = await User.findById(req.user?.userId).select('userName profileImage');

        if (product && commenter) {
            const notifications = [];

            // Get the first product image
            const productImage = product.productImages && product.productImages.length > 0
                ? product.productImages[0]
                : product.photo || null;

            // Get product price based on sale type
            const productPrice = product.saleType === 'auction'
                ? (product.auctionSettings?.startingBid || 0)
                : (product.fixedPrice || 0);

            // Case 1: Comment on a product (not a reply)
            if (!value.parent) {
                // Notify product owner if someone else commented
                if (product.userId._id.toString() !== req.user.userId.toString()) {
                    notifications.push({
                        recipientId: product.userId._id,
                        userId: req.user?.userId,
                        type: NOTIFICATION_TYPES.ACTIVITY,
                        title: "New Comment on Your Product",
                        message: `${commenter.userName} commented on your product "${product.title.length > 50 ? product.title.substring(0, 50) + '...' : product.title}"`,
                        meta: createStandardizedNotificationMeta({
                            productId: product._id.toString(),
                            productTitle: product.title,
                            productImage: productImage,
                            productPrice: productPrice,
                            productFixedPrice: product.fixedPrice || null,
                            productDeliveryType: product.deliveryType || null,
                            productSaleType: product.saleType || null,
                            productCondition: product.condition || null,
                            commentId: saved._id.toString(),
                            commentContent: value.content || '',
                            commenterName: commenter.userName,
                            commenterId: req.user?.userId,
                            commenterImage: commenter.profileImage || null,
                            userImage: commenter.profileImage || null,
                            sellerId: product.userId._id.toString(),
                            actionBy: 'user',
                            timestamp: new Date().toISOString(),
                            associatedProductsCount: productIds.length || 0
                        }),
                        redirectUrl: `/products/${product._id}#comment-${saved._id}`
                    });
                }
            }
            // Case 2: Reply to a comment
            else {
                const parentComment = await ProductComment.findById(value.parent).populate('author', 'userName profileImage');

                if (parentComment && parentComment.author) {
                    // Notify parent comment author if someone else replied
                    if (parentComment.author._id.toString() !== req.user.userId.toString()) {
                        notifications.push({
                            recipientId: parentComment.author._id,
                            userId: req.user?.userId,
                            type: NOTIFICATION_TYPES.ACTIVITY,
                            title: "New Reply to Your Comment",
                            message: `${commenter.userName} replied to your comment on "${product.title.length > 50 ? product.title.substring(0, 50) + '...' : product.title}"`,
                            meta: createStandardizedNotificationMeta({
                                productId: product._id.toString(),
                                productTitle: product.title,
                                productImage: productImage,
                                productPrice: productPrice,
                                productFixedPrice: product.fixedPrice || null,
                                productDeliveryType: product.deliveryType || null,
                                productSaleType: product.saleType || null,
                                productCondition: product.condition || null,
                                commentId: saved._id.toString(),
                                parentCommentId: value.parent,
                                commentContent: value.content || '',
                                commenterName: commenter.userName,
                                commenterId: req.user?.userId,
                                commenterImage: commenter.profileImage || null,
                                userImage: commenter.profileImage || null,
                                sellerId: product.userId._id.toString(),
                                actionBy: 'user',
                                timestamp: new Date().toISOString(),
                                associatedProductsCount: productIds.length || 0
                            }),
                            redirectUrl: `/products/${product._id}#comment-${saved._id}`
                        });
                    }

                    // Also notify product owner if it's a reply and they're not the commenter or parent comment author
                    if (product.userId._id.toString() !== req.user.userId.toString() &&
                        product.userId._id.toString() !== parentComment.author._id.toString()) {
                        notifications.push({
                            recipientId: product.userId._id,
                            userId: req.user?.userId,
                            type: NOTIFICATION_TYPES.ACTIVITY,
                            title: "New Activity on Your Product",
                            message: `${commenter.userName} replied to a comment on your product "${product.title.length > 50 ? product.title.substring(0, 50) + '...' : product.title}"`,
                            meta: createStandardizedNotificationMeta({
                                productId: product._id.toString(),
                                productTitle: product.title,
                                productImage: productImage,
                                productPrice: productPrice,
                                productFixedPrice: product.fixedPrice || null,
                                productDeliveryType: product.deliveryType || null,
                                productSaleType: product.saleType || null,
                                productCondition: product.condition || null,
                                commentId: saved._id.toString(),
                                parentCommentId: value.parent,
                                commentContent: value.content || '',
                                commenterName: commenter.userName,
                                commenterId: req.user?.userId,
                                commenterImage: commenter.profileImage || null,
                                userImage: commenter.profileImage || null,
                                sellerId: product.userId._id.toString(),
                                actionBy: 'user',
                                timestamp: new Date().toISOString(),
                                associatedProductsCount: productIds.length || 0
                            }),
                            redirectUrl: `/products/${product._id}#comment-${saved._id}`
                        });
                    }
                }
            }

            // Case 3: Associated Products Notifications (if any products are associated with the comment)
            if (productIds.length > 0) {
                try {
                    // Fetch associated product details and their owners
                    const associatedProducts = await SellProduct.find({
                        _id: { $in: productIds.map(id => toObjectId(id)) }
                    }).populate('userId', 'userName profileImage').lean();

                    for (const assocProduct of associatedProducts) {
                        // Notify associated product owner if someone else mentioned their product
                        if (assocProduct.userId._id.toString() !== req.user.userId.toString()) {
                            const assocProductImage = assocProduct.productImages && assocProduct.productImages.length > 0
                                ? assocProduct.productImages[0]
                                : assocProduct.photo || null;

                            const assocProductPrice = assocProduct.saleType === 'auction'
                                ? (assocProduct.auctionSettings?.startingBid || 0)
                                : (assocProduct.fixedPrice || 0);

                            notifications.push({
                                recipientId: assocProduct.userId._id,
                                userId: req.user?.userId,
                                type: NOTIFICATION_TYPES.ACTIVITY,
                                title: "Your Product Was Mentioned",
                                message: `${commenter.userName} mentioned your product "${assocProduct.title.length > 40 ? assocProduct.title.substring(0, 40) + '...' : assocProduct.title}" in a product comment`,
                                meta: createStandardizedNotificationMeta({
                                    productId: assocProduct._id.toString(),
                                    productTitle: assocProduct.title,
                                    productImage: assocProductImage,
                                    productPrice: assocProductPrice,
                                    productFixedPrice: assocProduct.fixedPrice || null,
                                    productDeliveryType: assocProduct.deliveryType || null,
                                    productSaleType: assocProduct.saleType || null,
                                    productCondition: assocProduct.condition || null,
                                    commentId: saved._id.toString(),
                                    commentContent: value.content || '',
                                    commenterName: commenter.userName,
                                    commenterId: req.user?.userId,
                                    commenterImage: commenter.profileImage || null,
                                    userImage: commenter.profileImage || null,
                                    sellerId: assocProduct.userId._id.toString(),
                                    actionBy: 'user',
                                    timestamp: new Date().toISOString(),
                                    associatedProductsCount: productIds.length
                                }),
                                redirectUrl: `/products/${product._id}#comment-${saved._id}`
                            });
                        }
                    }
                } catch (productError) {
                    console.error('❌ Failed to fetch associated products for notifications:', productError);
                    // Don't fail the main operation if product fetching fails
                }
            }

            // Send notifications if any

            if (notifications.length > 0) {
                try {
                    const recipientIds = notifications.map(n => n.recipientId);

                    const allowedRecipients = await User.find({
                        _id: { $in: recipientIds },
                        activityNotification: true
                    }).select('_id');




                    const allowedIdsSet = new Set(allowedRecipients.map(u => u._id.toString()));


                    const filteredNotifications = notifications.filter(n =>
                        allowedIdsSet.has(n.recipientId.toString())
                    );


                    if (filteredNotifications.length > 0) {
                        await saveNotification(filteredNotifications);
                        console.log(`✅ ${filteredNotifications.length} notification(s) sent for product comment and associations`);
                    } else {
                        console.log('⚠️ All users have disabled activity notifications. Skipping notification dispatch.');
                    }
                } catch (notificationError) {
                    console.error('❌ Failed to send product comment notifications:', notificationError);
                }
            }

        }

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, saved);
    } catch (error) {
        console.error('Error in addComment:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const getProductComment = async (req, res) => {
    try {
        const { productId } = req.params;
        const page = parseInt(req.query.pageNo) || 1;
        const limit = parseInt(req.query.size) || 10;
        const skip = (page - 1) * limit;

        const filter = {
            product: toObjectId(productId),
            parent: null,
            isDeleted: false
        };

        const totalCount = await ProductComment.countDocuments(filter);

        // Fetch top-level comments
        const comments = await ProductComment.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('author', 'userName profileImage isLive')
            .populate('associatedProducts')
            .lean();

        const commentIds = comments.map(comment => comment._id);

        // Fetch all replies for these top-level comments
        const replies = await ProductComment.find({
            parent: { $in: commentIds },
            isDeleted: false
        })
            .sort({ createdAt: 1 })
            .populate('author', 'userName profileImage isLive')
            .populate('associatedProducts')
            .lean();

        // Group replies under their parent comment
        const replyMap = {};
        const replyCountMap = {};
        replies.forEach(reply => {
            const parentId = reply.parent.toString();
            if (!replyMap[parentId]) replyMap[parentId] = [];
            replyMap[parentId].push(reply);
            replyCountMap[parentId] = (replyCountMap[parentId] || 0) + 1;
        });

        // Attach replies to each comment
        const enrichedComments = comments.map(comment => ({
            ...comment,
            replies: replyMap[comment._id.toString()] || [],
            totalReplies: replyCountMap[comment._id.toString()] || 0,
        }));

        return apiSuccessRes(HTTP_STATUS.OK, res, "Comments fetched successfully", {
            pageNo: page,
            size: limit,
            total: totalCount,
            commentList: enrichedComments,
        });

    } catch (err) {
        console.error('Error fetching product comments:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};





const getCommentByParentId = async (req, res) => {
    try {
        const { parentId } = req.params;
        const page = parseInt(req.query.pageNo) || 1;
        const limit = parseInt(req.query.size) || 10;
        const skip = (page - 1) * limit;

        if (!mongoose.Types.ObjectId.isValid(parentId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid parentId");
        }

        // Fetch replies (direct children) with author and products
        const replies = await ProductComment.find({ parent: toObjectId(parentId), isDeleted: false })
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(limit)
            .populate("author", "username profilePic isLive")
            .populate(
                "associatedProducts",
                "title _id description productImages condition saleType"
            )
            .lean();

        // For each reply, fetch total replies count & first reply
        const enrichedReplies = await Promise.all(
            replies.map(async (reply) => {
                const totalRepliesCount = await ProductComment.countDocuments({
                    parent: reply._id, isDeleted: false
                });

                const firstReply = await ProductComment.findOne({
                    parent: reply._id, isDeleted: false
                })
                    .sort({ createdAt: 1 })
                    .populate("author", "username profilePic")
                    .lean();

                return {
                    ...reply,
                    totalReplies: totalRepliesCount,
                    firstReply: firstReply
                        ? {
                            _id: firstReply._id,
                            content: firstReply.content,
                            author: firstReply.author,
                            createdAt: firstReply.createdAt,
                        }
                        : null,
                };
            })
        );

        // Count total replies for pagination
        const totalReplies = await ProductComment.countDocuments({
            parent: toObjectId(parentId), isDeleted: false
        });

        const responseObj = {
            pageNo: page,
            size: limit,
            total: totalReplies,
            data: enrichedReplies,
        };

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "Replies fetched successfully",
            responseObj
        );
    } catch (error) {
        console.error("Error in getCommentByParentId:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Server error");
    }
};


const getDraftProducts = async (req, res) => {
    try {
        const loginUserId = req.user?.userId;

        // Pagination params with defaults
        const pageNo = Math.max(1, parseInt(req.query.pageNo) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
        const skip = (pageNo - 1) * pageSize;

        // Query for draft products (not deleted, not disabled, isDraft = true)
        const query = {
            isDeleted: false,
            isDisable: false,
            userId: toObjectId(loginUserId)
        };

        // Get total count for pagination
        const totalDraftCount = await SellProductDraft.countDocuments(query);

        // Fetch draft products with pagination, populate category name, lean() for plain JS objects
        const drafts = await SellProductDraft.find(query)
            .populate('categoryId', 'name')
            .skip(skip)
            .limit(pageSize)
            .lean();


        return apiSuccessRes(HTTP_STATUS.OK, res, "Draft products fetched successfully.", {
            pageNo,
            size: pageSize,
            total: totalDraftCount,
            drafts: drafts,
        });

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};

const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const loginUserId = req.user?.userId;
        const roleIds = req.user?.roleId;

        if (!id) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Product ID is required.");
        }

        // Find product and check existence
        const product = await SellProduct.findOne({ _id: id, isDeleted: false });
        if (!product) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Product not found.");
        }

        // Check if user is owner or super admin
        const isOwner = product.userId.toString() === loginUserId;
        const isSuperAdmin = roleIds === roleId.SUPER_ADMIN;

        if (!isOwner && !isSuperAdmin) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "You are not authorized to delete this product.");
        }

        // Delete images from Cloudinary
        if (product.photos && product.photos.length > 0) {
            for (const url of product.photos) {
                try {
                    await deleteImageCloudinary(url);
                } catch (err) {
                    console.error("Failed to delete image from Cloudinary:", url, err);
                }
            }
        }

        // Soft delete the product
        product.isDeleted = true;
        await product.save();

        // 🔍 Remove from Algolia index after successful deletion
        try {
            await deleteProducts(product._id);
        } catch (algoliaError) {
            console.error('Algolia deletion failed for product:', product._id, algoliaError);
            // Don't fail the main operation if Algolia fails
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Product deleted successfully.");
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


const deleteProductDraft = async (req, res) => {
    try {
        const { id } = req.params;
        const loginUserId = req.user?.userId;
        const roleIds = req.user?.roleId;

        if (!id) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Product ID is required.");
        }

        // Find product and check existence
        const product = await SellProductDraft.findOne({ _id: id, isDeleted: false });
        if (!product) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Product not found.");
        }

        // Check if user is owner or super admin
        const isOwner = product.userId.toString() === loginUserId;
        const isSuperAdmin = roleIds === roleId.SUPER_ADMIN;

        if (!isOwner && !isSuperAdmin) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "You are not authorized to delete this product.");
        }

        // Delete images from Cloudinary
        if (product.photos && product.photos.length > 0) {
            for (const url of product.photos) {
                try {
                    await deleteImageCloudinary(url);
                } catch (err) {
                    console.error("Failed to delete image from Cloudinary:", url, err);
                }
            }
        }

        // Soft delete the product
        product.isDeleted = true;
        await product.save();

        // 🔍 Remove from Algolia index after successful deletion
        try {
            await deleteProducts(product._id);
        } catch (algoliaError) {
            console.error('Algolia deletion failed for product:', product._id, algoliaError);
            // Don't fail the main operation if Algolia fails
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Product deleted successfully.");
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


const trending = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await SellProduct.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `Product not found.`);
        }

        existing.isTrending = !existing.isTrending;
        await existing.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, `Product updated successfully.`);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};

const updateAllTrending = async (req, res) => {
    try {
        const { updateAllTrendingStatus } = require('../services/serviceTrending');
        const result = await updateAllTrendingStatus();

        return apiSuccessRes(HTTP_STATUS.OK, res, "Trending status updated successfully", result);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};




const otherUserReview = async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "userId query param is required");
        }

        // Parse pagination params, default values
        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (pageNo - 1) * size;

        // Count total matching reviews for pagination metadata
        const totalReviews = await ProductReview.countDocuments({
            userId,
            isDeleted: false,
            isDisable: false
        });

        // Fetch paginated reviews
        const reviews = await ProductReview.find({
            userId: toObjectId(userId),
            isDeleted: false,
            isDisable: false
        })
            .skip(skip)
            .limit(size)
            .populate({
                path: 'productId',
                select: '_id title description price',
            })
            .populate({
                path: 'userId',
                select: 'userName profileImage provinceId districtId',
                populate: [
                    { path: 'provinceId', select: 'value' },
                    { path: 'districtId', select: 'value' }
                ]
            })
            .lean();
        return apiSuccessRes(HTTP_STATUS.OK, res, `ProductReview List`, {
            pageNo,
            size,
            total: totalReviews,
            data: reviews,
        });


    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};



const getProductsWithDraft = async (req, res) => {
    try {
        const {
            // Search
            keyWord,

            // Categories
            categoryId,
            subCategoryId,

            // Price Range
            minPrice,
            maxPrice,

            // Product Type
            saleType,

            // Status Filters
            isNew,
            isSold,

            // Location
            location,

            // Seller Filters
            sellerId,
            minSellerRating,
            isVerifiedSeller,

            // Auction Specific
            isAuctionOpen,

            isDraft = false,

            // Sorting
            sortBy = 'createdAt',
            orderBy = 'desc',

            // Pagination
            pageNo: page = 1,
            size: limit = 10
        } = req.query;
        const isDraftMode = isDraft === 'true' || isDraft === true;

        const Model = isDraftMode ? SellProductDraft : SellProduct;
        const allowedSortFields = ['createdAt', 'fixedPrice', "commentCount", 'viewCount'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
        const sortOrder = orderBy.toLowerCase() === 'desc' ? -1 : 1;
        const sortOptions = {};
        sortOptions[sortField] = sortOrder;


        // Build filter object
        const filter = {
            isDeleted: false,
            isDisable: false,
            userId: req.user.userId
        };


        // Text Search
        if (keyWord&&keyWord.trim()!=="") {
            filter.$or = [
                { title: { $regex: keyWord, $options: 'i' } },
                { description: { $regex: keyWord, $options: 'i' } }
            ];
        }

        // Category Filters
        if (categoryId&&categoryId.trim()!=="") {
            filter.categoryId = new mongoose.Types.ObjectId(categoryId);
        }
        if (subCategoryId&&subCategoryId.trim()!=="") {
            filter.subCategoryId = new mongoose.Types.ObjectId(subCategoryId);
        }

        // Price Range
        if ((minPrice !== undefined&&minPrice!=="") || (maxPrice !== undefined&&maxPrice!=="")) {
            filter.fixedPrice = {};
            if (minPrice !== undefined&&minPrice!=="") filter.fixedPrice.$gte = Number(minPrice);
            if (maxPrice !== undefined&&maxPrice!=="") filter.fixedPrice.$lte = Number(maxPrice);
        }

        // Sale Type
        if (saleType) {
            filter.saleType = saleType;
        }

        // Product Status
        if (isNew !== undefined) {
            filter.isNew = isNew === 'true';
        }
        if (isSold !== undefined) {
            filter.isSold = isSold === 'true';
        }

        // Location
        if (location) {
            filter.location = { $regex: location, $options: 'i' };
        }

        // Seller ID
        if (sellerId) {
            filter.userId = new mongoose.Types.ObjectId(sellerId);
        }

        // Auction Status
        if (isAuctionOpen !== undefined && saleType === SALE_TYPE.AUCTION) {
            filter['auctionSettings.isBiddingOpen'] = isAuctionOpen === 'true';
        }

        // Calculate skip value for pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Fetch products with populated fields
        const products = await Model.find(filter)
            .populate({
                path: 'userId',
                select: 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting',
                match: {
                    isDeleted: false,
                    isDisable: false,
                    ...(minSellerRating && { averageRatting: { $gte: Number(minSellerRating) } }),
                    ...(isVerifiedSeller && { is_Verified_Seller: true })
                }
            })
            .populate('categoryId', 'name image')
            .populate('subCategoryId', 'name')
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        if (sortField === 'commentCount') {
            const productIds = products.map(p => p._id);

            const commentsCountMap = await ProductComment.aggregate([
                {
                    $match: {
                        product: { $in: productIds },
                        isDeleted: false,
                        isDisable: false
                    }
                },
                {
                    $group: {
                        _id: "$product",
                        count: { $sum: 1 }
                    }
                }
            ]);

            const commentCountLookup = {};
            commentsCountMap.forEach(item => {
                commentCountLookup[item._id.toString()] = item.count;
            });

            for (const product of products) {
                product._commentCount = commentCountLookup[product._id.toString()] || 0;
            }

            // In-memory sort
            products.sort((a, b) => {
                if (sortOrder === -1) return b._commentCount - a._commentCount;
                else return a._commentCount - b._commentCount;
            });
        }



        // Filter out products where seller doesn't match criteria
        const filteredProducts = products.filter(product => product.userId !== null);
        const categoryIds = filteredProducts
            .map(p => p.categoryId?._id?.toString() || p.categoryId?.toString())
            .filter(Boolean);
        const categories = await Category.find({ _id: { $in: categoryIds } })
            .select("subCategories.name subCategories._id")
            .lean();
        for (const product of filteredProducts) {
            const categoryId = product.categoryId?._id?.toString() || product.categoryId?.toString();
            const subCategoryId = product.subCategoryId?._id?.toString() || product.subCategoryId?.toString();

            const category = categories.find(cat => cat?._id.toString() === categoryId);
            const subCat = category?.subCategories?.find(sub => sub?._id.toString() === subCategoryId);

            product.subCategoryName = subCat?.name || null;
        }


        // Get total count for pagination
        const total = await Model.countDocuments(filter);

        // Format response
        const response = {
            pageNo: parseInt(page),
            total,
            size: parseInt(limit),
            products: filteredProducts.map(product => {
                return {
                    ...product,
                    _id: product._id,
                    title: product.title,
                    description: product.description,
                    price: product.fixedPrice,
                    saleType: product.saleType,
                    productImages: product.productImages,
                    category: product.categoryId?.name,
                    subCategory: product.subCategoryId?.name,
                    location: product.location,
                    condition: product.condition,
                    seller: {
                        _id: product.userId?._id,
                        name: product.userId?.userName,
                        image: product.userId?.profileImage,
                        rating: product.userId?.averageRatting,
                        isVerified: product.userId?.is_Verified_Seller,
                        isLive: product.userId?.isLive
                    },

                    isSold: product.isSold,

                    auctionSettings: product.auctionSettings,
                    createdAt: product.createdAt,
                    updatedAt: product.updatedAt
                }
            }),

        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", response);
    } catch (err) {
        console.error("Get products error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch products");
    }
};


const adminSearchProducts = async (req, res) => {
    try {
        const { q = '', limit = 10 } = req.query;

        if (!q || q.length < 2) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "Search results", []);
        }

        const searchFilter = {
            isDeleted: false,
            $or: [
                { title: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
                { _id: q.match(/^[0-9a-fA-F]{24}$/) ? toObjectId(q) : null }
            ].filter(Boolean)
        };

        const products = await SellProduct.find(searchFilter)
            .select('title productImages fixedPrice saleType isSold createdAt userId')
            .populate('userId', 'userName')
            .limit(parseInt(limit))
            .sort({ createdAt: -1 })
            .lean();

        return apiSuccessRes(HTTP_STATUS.OK, res, "Products found", products);
    } catch (error) {
        console.error('Admin product search error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to search products");
    }
};



router.post('/addSellerProduct', perApiLimiter(), upload.array('files', 10), addSellerProduct);

router.post('/updateSellerProduct/:id', perApiLimiter(), upload.array('files', 10), updateSellerProduct);
router.post('/toggleProductDisable/:id', perApiLimiter(), upload.none(), toggleProductDisable);


router.get('/getDraftProducts', perApiLimiter(), getDraftProducts);
router.get('/deleteProduct/:id', perApiLimiter(), deleteProduct);
router.get('/deleteProductDraft/:id', perApiLimiter(), deleteProductDraft);

router.post('/trending/:id', perApiLimiter(), trending);
router.post('/update-all-trending', perApiLimiter(), updateAllTrending);




//List api for the Home Screen // thread controller
router.get('/showNormalProducts', perApiLimiter(), showNormalProducts);
router.get('/showAuctionProducts', perApiLimiter(), showAuctionProducts);
router.get('/getProducts/:id', perApiLimiter(), getProduct);



router.get('/getProductsWithDraft', perApiLimiter(), getProductsWithDraft);


//Category detail Page
router.get('/limited-time', perApiLimiter(), getLimitedTimeDeals);
router.get('/fetchCombinedProducts', perApiLimiter(), fetchCombinedProducts);
// inside userProfile

router.get('/fetchUserProducts', perApiLimiter(), fetchUserProducts);
router.get('/otherUserReviewlist', perApiLimiter(), otherUserReview);

//Search Panel
router.get('/createHistory', perApiLimiter(), createHistory);
router.get('/clearAllHistory', perApiLimiter(), clearAllHistory);
router.get('/clearOneHistory/:id', perApiLimiter(), clearOneHistory);
router.get('/getSearchHistory', perApiLimiter(), getSearchHistory);

// Product View Tracking
router.post('/track-view/:productId', perApiLimiter(), trackProductView);
router.get('/view-history', perApiLimiter(), getViewHistory);

//comment
router.post('/addComment', perApiLimiter(), upload.array('files', 2), addComment);
router.get('/getProductComment/:productId', perApiLimiter(), getProductComment);
router.get('/getCommentByParentId/:parentId', perApiLimiter(), getCommentByParentId);

// Admin search endpoint for financial dashboard

router.get('/search', perApiLimiter(), adminSearchProducts);

module.exports = router;
