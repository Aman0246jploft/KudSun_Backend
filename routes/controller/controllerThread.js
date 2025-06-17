
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Thread, ThreadComment, SellProduct, Bid } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { default: mongoose } = require('mongoose');
const { SALE_TYPE } = require('../../utils/Role');

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
        if (!categoryId || !subCategoryId || !title) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required fields.");
        }
        let tagArray = [];
        if (tags) {
            const raw = Array.isArray(tags)
                ? tags
                : [tags];
            console.log("raw", raw)
            tagArray = raw
                .map(id => id.trim?.())
                .filter(id => id);
        }
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
const getThreadByUserId = async (req, res) => {
    try {
        const userId = req.body.userId || req.user.userId;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid userId");
        }

        const page = parseInt(req.body.pageNo) || 1;
        const size = parseInt(req.body.size) || 10;
        const skip = (page - 1) * size;

        const threadsWithProductCount = await Thread.aggregate([
            { $match: { userId: toObjectId(userId), isDeleted: false } },
            {
                $lookup: {
                    from: "ThreadComment",
                    localField: "_id",
                    foreignField: "thread",
                    as: "comments",
                },
            },
            { $unwind: { path: "$comments", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$comments.associatedProducts", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: "$_id",
                    title: { $first: "$title" },
                    description: { $first: "$description" },
                    createdAt: { $first: "$createdAt" },
                    updatedAt: { $first: "$updatedAt" },
                    userId: { $first: "$userId" },
                    totalAssociatedProducts: { $sum: 1 },
                },
            },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: size },
            {
                $project: {
                    _id: 1,
                    title: 1,
                    description: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    userId: 1,
                    totalAssociatedProducts: 1,
                },
            },
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, threadsWithProductCount);
    } catch (error) {
        console.error(error);
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

const associatedProductByThreadId = async (req, res) => {
    try {
        const { threadId } = req.params;
        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        if (!threadId || threadId.length !== 24) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid thread ID');
        }

        // Step 1: Find all associated product IDs from comments
        const comments = await ThreadComment.find({ thread: toObjectId(threadId) }).select('associatedProducts').lean();
        const productIds = comments.flatMap(c => c.associatedProducts).filter(Boolean);
        const uniqueProductIds = [...new Set(productIds.map(id => id.toString()))];

        const total = uniqueProductIds.length;
        const paginatedIds = uniqueProductIds.slice((pageNo - 1) * size, pageNo * size);

        // Step 2: Fetch products with user info
        const products = await SellProduct.find({ _id: { $in: paginatedIds } })
            .populate({ path: 'userId', select: 'userName email profileImage' }) // user info
            .sort({ [sortBy]: sortOrder })
            .lean();

        // Step 3: Add bid count if product is auction
        const productWithBidInfo = await Promise.all(products.map(async (product) => {
            let bidCount = 0;
            if (product.saleType === SALE_TYPE.AUCTION) {
                bidCount = await Bid.countDocuments({ productId: toObjectId(product._id) });
            }

            return {
                ...product,
                bidCount,
                user: product.userId, // keep userInfo under `user` key
                userId: undefined // remove raw userId
            };
        }));

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Associated products fetched successfully', {
            total,
            pageNo,
            size,
            totalPages: Math.ceil(total / size),
            sortBy,
            sortOrder: sortOrder === 1 ? 'asc' : 'desc',
            products: productWithBidInfo
        });

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};






// GET /api/comments/:threadId
const getThreadComments = async (req, res) => {
    try {
        const { threadId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Fetch top-level comments (parent: null)
        const comments = await ThreadComment.find({ thread: toObjectId(threadId), parent: null })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('author', 'username profilePic') // You can add more user fields
            .populate('associatedProducts')
            .lean();

        const commentIds = comments.map(comment => comment._id);

        // Fetch 1 child reply for each top-level comment
        const replies = await ThreadComment.aggregate([
            { $match: { parent: { $in: commentIds } } },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: "$parent",
                    firstReply: { $first: "$$ROOT" },
                    replyCount: { $sum: 1 },
                },
            },
        ]);

        const replyMap = {};
        replies.forEach(r => {
            replyMap[r._id.toString()] = {
                reply: r.firstReply,
                count: r.replyCount,
            };
        });

        // Attach replies to top-level comments
        const enrichedComments = comments.map(comment => {
            const match = replyMap[comment._id.toString()];
            return {
                ...comment,
                firstReply: match ? match.reply : null,
                totalReplies: match ? match.count : 0,
            };
        });

        return res.status(200).json({
            success: true,
            data: enrichedComments,
            pagination: {
                page,
                limit,
            },
        });
    } catch (err) {
        console.error('Error fetching comments:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);

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
        const replies = await ThreadComment.find({ parent: toObjectId(parentId) })
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(limit)
            .populate("author", "username profilePic")
            .populate(
                "associatedProducts",
                "title _id description productImages condition saleType"
            )
            .lean();

        // For each reply, fetch total replies count & first reply
        const enrichedReplies = await Promise.all(
            replies.map(async (reply) => {
                const totalRepliesCount = await ThreadComment.countDocuments({
                    parent: reply._id,
                });

                const firstReply = await ThreadComment.findOne({
                    parent: reply._id,
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
        const totalReplies = await ThreadComment.countDocuments({
            parent: toObjectId(parentId),
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



//thread
router.post('/create', perApiLimiter(), upload.array('files', 10), addThread);
router.post('/getThreadByUserId', perApiLimiter(), getThreadByUserId);


//comment 
router.post('/addComment', perApiLimiter(), upload.array('files', 2), addComment);
router.post('/associatedProductByThreadId/:threadId', perApiLimiter(), upload.none(), associatedProductByThreadId);
router.get('/getThreadComments/:threadId', perApiLimiter(), getThreadComments);
router.get('/getCommentByParentId/:parentId', perApiLimiter(), upload.none(), getCommentByParentId);


module.exports = router;
