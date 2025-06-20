
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Thread, ThreadComment, SellProduct, Bid, Follow, ThreadLike } = require('../../db');
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



const closeThread = async (req, res) => {
    try {
        let { threadId } = req.params
        let { userId } = req.user
        let thread = await Thread.findOne({
            _id: toObjectId(threadId), userId: toObjectId(userId)
        })
        if (!thread) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, CONSTANTS_MSG.THREAD_NOT_FOUND, null)
        }
        thread.isClosed = true
        await thread.save()
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, thread)

    } catch (error) {
        console.error(error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
}



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
        const page = parseInt(req.query.pageNo) || 1;
        const limit = parseInt(req.query.size) || 10;
        const skip = (page - 1) * limit;
        const totalCount = await ThreadComment.countDocuments({ thread: toObjectId(threadId), parent: null });

        // Fetch top-level comments
        const comments = await ThreadComment.find({ thread: toObjectId(threadId), parent: null })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('author', 'username profilePic')
            .populate('associatedProducts')
            .lean();

        const commentIds = comments.map(comment => comment._id);

        // Aggregation for replies with associatedProducts populated
        const replies = await ThreadComment.aggregate([
            { $match: { parent: { $in: commentIds } } },
            { $sort: { createdAt: 1 } },
            {
                $lookup: {
                    from: 'SellProduct', // make sure this is the correct collection name
                    localField: 'associatedProducts',
                    foreignField: '_id',
                    as: 'associatedProducts'
                }
            },
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

        return apiSuccessRes(HTTP_STATUS.OK, res, "Comments fetched successfully", {
            pageNo: page,
            size: limit,
            total: totalCount,
            commentList: enrichedComments,
        });
    } catch (err) {
        console.error('Error fetching comments:', err);
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



const getThreads = async (req, res) => {
    try {
        let {
            pageNo = 1,
            size = 10,
            keyWord = '',
            categoryId,
            subCategoryId,
            userId,
            sortBy = 'createdAt', // 'createdAt' | 'budget' | 'comments'
            sortOrder = 'desc'    // 'asc' | 'desc'
        } = req.query;

        let page = parseInt(pageNo);
        let limit = parseInt(size);
        const sortDir = sortOrder === 'asc' ? 1 : -1;


        const filters = { isDeleted: false };

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            filters.categoryId = categoryId;
        }

        if (subCategoryId && mongoose.Types.ObjectId.isValid(subCategoryId)) {
            filters.subCategoryId = subCategoryId;
        }

        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
            filters.userId = userId; // 👈 filter by userId
        }
        if (keyWord?.trim()) {
            filters.title = { $regex: keyWord.trim(), $options: 'i' };
        }

        let sortStage = {};
        if (sortBy === 'budget') {
            sortStage = { 'budgetRange.min': sortDir };
        } else {
            sortStage = { createdAt: sortDir }; // default
        }

        const threads = await Thread.find(filters)
            .populate('userId', 'userName profileImage isLive is_Id_verified is_Preferred_seller')
            .populate('categoryId', 'name') // populate but remove later
            .populate('subCategoryId', 'name') // populate but remove later
            .sort(sortStage)
            .skip((page - 1) * limit)
            .limit(limit)
            .select('-createdAt -updatedAt -__v')
            .lean();

        const threadIds = threads.map(t => t._id);
        const userIds = [...new Set(threads.map(t => t.userId?._id?.toString()).filter(Boolean))];

        const [followerCounts, commentCounts, likeCounts, productCounts] = await Promise.all([
            Follow.aggregate([
                { $match: { userId: { $in: userIds.map(id => toObjectId(id)) }, isDeleted: false, isDisable: false } },
                { $group: { _id: '$userId', count: { $sum: 1 } } }
            ]),
            ThreadComment.aggregate([
                { $match: { thread: { $in: threadIds }, parent: null } },
                { $group: { _id: '$thread', count: { $sum: 1 } } }
            ]),
            ThreadLike.aggregate([
                { $match: { threadId: { $in: threadIds }, isDeleted: false, isDisable: false } },
                { $group: { _id: '$threadId', count: { $sum: 1 } } }
            ]),
            ThreadComment.aggregate([
                { $match: { thread: { $in: threadIds }, associatedProducts: { $exists: true, $not: { $size: 0 } } } },
                {
                    $group: {
                        _id: '$thread',
                        productSet: { $addToSet: '$associatedProducts' }
                    }
                },
                {
                    $project: {
                        count: {
                            $size: {
                                $reduce: {
                                    input: '$productSet',
                                    initialValue: [],
                                    in: { $setUnion: ['$$value', '$$this'] }
                                }
                            }
                        }
                    }
                }
            ])
        ]);

        const followerMap = Object.fromEntries(followerCounts.map(f => [f._id.toString(), f.count]));
        const commentMap = Object.fromEntries(commentCounts.map(c => [c._id.toString(), c.count]));
        const likeMap = Object.fromEntries(likeCounts.map(l => [l._id.toString(), l.count]));
        const productMap = Object.fromEntries(productCounts.map(p => [p._id.toString(), p.count]));

        const enrichedThreads = threads.map(thread => {
            const tid = thread._id.toString();
            const uid = thread.userId?._id?.toString() || '';
            const currentUserId = req.user?.userId?.toString();

            // Remove populated category data
            delete thread.categoryId;
            delete thread.subCategoryId;

            return {
                ...thread,
                totalFollowers: followerMap[uid] || 0,
                totalComments: commentMap[tid] || 0,
                totalLikes: likeMap[tid] || 0,
                totalAssociatedProducts: productMap[tid] || 0,
                myThread: currentUserId && uid === currentUserId
            };
        });

        const total = await Thread.countDocuments(filters);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
            pageNo: page,
            size: limit,
            total: total,
            products: enrichedThreads,
        });

    } catch (error) {
        console.error('Error in getThreads:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");

    }
};

//thread
router.post('/create', perApiLimiter(), upload.array('files', 10), addThread);
router.post('/getThreadByUserId', perApiLimiter(), getThreadByUserId);
router.post('/closeThread/:threadId', perApiLimiter(), closeThread);



//List api for the Home Screen // product controller
router.get('/getThreads', perApiLimiter(), upload.none(), getThreads);

//comment 
router.post('/addComment', perApiLimiter(), upload.array('files', 2), addComment);
router.post('/associatedProductByThreadId/:threadId', perApiLimiter(), upload.none(), associatedProductByThreadId);
router.get('/getThreadComments/:threadId', perApiLimiter(), getThreadComments);
router.get('/getCommentByParentId/:parentId', perApiLimiter(), upload.none(), getCommentByParentId);







module.exports = router;
