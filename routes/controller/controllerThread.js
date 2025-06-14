
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Thread, ThreadComment } = require('../../db');
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
const { addCommentSchema } = require('../services/validations/threadValidation');


// Add a new thread
const addThread = async (req, res) => {
    try {
        const {
            categoryId,
            subCategoryId,
            title,
            description,
            budgetFlexible,
            min,
            max,
            tags
        } = req.body;

        // === Validate Required Fields ===
        if (!categoryId || !subCategoryId || !title) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required fields.");
        }



        let = [];


        let tagArray = [];
        if (tags) {
            const raw = Array.isArray(tags)
                ? tags
                : [tags];
            console.log("raw", raw)
            // Clean array: remove empty strings or invalid ObjectId formats
            tagArray = raw
                .map(id => id.trim?.()) // optional chaining for safety
                .filter(id => id); // only valid Mongo ObjectIds
        }


        // === Upload Photos to Cloudinary ===
        let photoUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'thread-photos');
                if (imageUrl) photoUrls.push(imageUrl);
            }
        }

        const threadData = {
            userId: req.user?.userId,
            categoryId,
            subCategoryId,
            title,
            description: description || '',
            budgetFlexible: budgetFlexible === 'true',
            budgetRange: {
                min: budgetFlexible === 'true' ? undefined : Number(min),
                max: budgetFlexible === 'true' ? undefined : Number(max)
            },
            tags: tagArray,
            photos: photoUrls
        };

        const thread = new Thread(threadData);
        const saved = await thread.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, saved);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


// Get all threads
const getAllThreads = async (req, res) => {
    try {
        const threads = await Thread.find({ isDeleted: false }).sort({ createdAt: -1 });
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, threads);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


// Get single thread by ID
const getThreadById = async (req, res) => {
    try {
        const thread = await Thread.findOne({ _id: req.params.id, isDeleted: false });
        if (!thread) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Thread not found");
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, thread);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


// Get my threads
const getMyThreads = async (req, res) => {
    try {
        const threads = await Thread.find({ userId: req.user.userId, isDeleted: false }).sort({ createdAt: -1 });
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, threads);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


// Update thread
const updateThread = async (req, res) => {
    try {
        const thread = await Thread.findOne({ _id: req.params.id, userId: req.user.userId, isDeleted: false });
        if (!thread) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Thread not found");

        const {
            title,
            description,
            budgetFlexible,
            min,
            max,
            tags
        } = req.body;

        if (title) thread.title = title;
        if (description) thread.description = description;
        if (budgetFlexible !== undefined) thread.budgetFlexible = budgetFlexible === 'true';
        if (budgetFlexible !== 'true') {
            thread.budgetRange = {
                min: Number(min),
                max: Number(max)
            };
        }

        if (tags) {
            thread.tags = tags.split(',').map(tag => tag.trim()).filter(Boolean);
        }

        if (req.files && req.files.length > 0) {
            let photoUrls = [];
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'thread-photos');
                if (imageUrl) photoUrls.push(imageUrl);
            }
            thread.photos = photoUrls;
        }

        const updated = await thread.save();
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, updated);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


// Close thread
const closeThread = async (req, res) => {
    try {
        const thread = await Thread.findOne({ _id: req.params.id, userId: req.user.userId });
        if (!thread) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Thread not found");

        thread.isClosed = true;
        await thread.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, thread);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


// Soft delete
const deleteThread = async (req, res) => {
    try {
        const thread = await Thread.findOne({ _id: req.params.id, userId: req.user.userId });
        if (!thread) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Thread not found");

        thread.isDeleted = true;
        await thread.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, "Thread deleted successfully", thread);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


const addComment = async (req, res) => {
    try {
        let value = req.body
        console.log("req.body111", req.body)
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

        const comment = new ThreadComment({
            content: value.content || '',
            thread: value.thread,
            parent: value.parent || null,
            associatedProducts: productIds,
            photos: imageList,
            author: req.user?.userId
        });

        const saved = await comment.save();
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, saved);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};


router.post('/create', perApiLimiter(), upload.array('files', 10), addThread);

//comment 
router.post('/addComment', perApiLimiter(), upload.array('files', 10), addComment);



module.exports = router;
