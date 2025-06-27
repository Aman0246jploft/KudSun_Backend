
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Thread, ThreadComment, SellProduct, Bid, Follow, ThreadLike, ThreadDraft, User } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { default: mongoose } = require('mongoose');
const { SALE_TYPE } = require('../../utils/Role');

// Add a new thread // Draft also
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
            tags,
            isDraft
        } = req.body;
        const draftMode = isDraft === 'true' || isDraft === true;

        if (!draftMode) {
            if (!categoryId || !subCategoryId || !title) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required fields.");
            }
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


        const budgetRange = {};
        if (budgetFlexible === 'true' || budgetFlexible === true) {
            budgetRange.min = undefined;
            budgetRange.max = undefined;
        } else if (!draftMode) {
            // Only enforce if not draft
            budgetRange.min = Number(min);
            budgetRange.max = Number(max);
        } else {
            // draft mode: optionally save min/max if present
            if (min) budgetRange.min = Number(min);
            if (max) budgetRange.max = Number(max);
        }




        const threadData = {
            userId: req.user?.userId,
            categoryId: categoryId || undefined,
            subCategoryId: subCategoryId || undefined,
            title: title || undefined,
            description: description || '',
            budgetFlexible: budgetFlexible === 'true' || budgetFlexible === true,
            budgetRange,
            tags: tagArray,
            photos: photoUrls,

        };
        let saved;

        if (draftMode) {
            const draft = new ThreadDraft(threadData);
            saved = await draft.save();
        } else {
            const thread = new Thread(threadData);
            saved = await thread.save();
        }
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, saved);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};



const updateThread = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            categoryId,
            subCategoryId,
            title,
            description,
            budgetFlexible,
            min,
            max,
            tags,
            isDraft,
            removePhotos // <--- new field (array of photo URLs to remove)
        } = req.body;

        const draftMode = isDraft === 'true' || isDraft === true;
        const Model = draftMode ? ThreadDraft : Thread;

        const existing = await Model.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `${draftMode ? 'Draft' : 'Thread'} not found.`);
        }

        if (existing.userId.toString() !== req.user.userId) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "You are not authorized to update this thread.");
        }

        if (!draftMode) {
            if (!categoryId || !subCategoryId || !title) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing required fields for published thread.");
            }
        }

        let tagArray = [];
        if (tags) {
            const raw = Array.isArray(tags) ? tags : [tags];
            tagArray = raw.map(t => t.trim?.()).filter(t => t);
        }

        // Remove photos as requested
        let photoUrls = existing.photos || [];
        if (removePhotos) {
            const photosToRemove = Array.isArray(removePhotos) ? removePhotos : [removePhotos];
            photoUrls = photoUrls.filter(url => !photosToRemove.includes(url));
        }

        // Upload new photos and append
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'thread-photos');
                if (imageUrl) photoUrls.push(imageUrl);
            }
        }

        const budgetRange = {};
        if (budgetFlexible === 'true' || budgetFlexible === true) {
            budgetRange.min = undefined;
            budgetRange.max = undefined;
        } else if (!draftMode) {
            budgetRange.min = Number(min);
            budgetRange.max = Number(max);
        } else {
            budgetRange.min = min !== undefined ? Number(min) : existing.budgetRange?.min;
            budgetRange.max = max !== undefined ? Number(max) : existing.budgetRange?.max;
        }

        const updateData = {
            categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
            subCategoryId: subCategoryId !== undefined ? subCategoryId : existing.subCategoryId,
            title: title !== undefined ? title : existing.title,
            description: description !== undefined ? description : existing.description,
            budgetFlexible: (budgetFlexible !== undefined)
                ? (budgetFlexible === 'true' || budgetFlexible === true)
                : existing.budgetFlexible,
            budgetRange,
            tags: tagArray.length > 0 ? tagArray : existing.tags,
            photos: photoUrls,
            isDeleted: existing.isDeleted || false
        };

        const updated = await Model.findByIdAndUpdate(id, updateData, { new: true });

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, updated);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};



const deleteThread = async (req, res) => {
    try {
        const { id } = req.params;
        const { isDraft } = req.body; // pass ?isDraft=true if deleting draft
        const draftMode = isDraft === 'true';

        const Model = draftMode ? ThreadDraft : Thread;

        const existing = await Model.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `${draftMode ? 'Draft' : 'Thread'} not found.`);
        }

        if (existing.userId.toString() !== req.user.userId) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "You are not authorized to delete this thread.");
        }

        // Soft delete: mark isDeleted = true
        existing.isDeleted = true;
        await existing.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, `${draftMode ? 'Draft' : 'Thread'} deleted successfully.`);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


const changeStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { isDraft } = req.body; // pass ?isDraft=true if deleting draft
        const draftMode = isDraft === 'true';

        const Model = draftMode ? ThreadDraft : Thread;

        const existing = await Model.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `${draftMode ? 'Draft' : 'Thread'} not found.`);
        }

        if (existing.userId.toString() !== req.user.userId) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "You are not authorized to Change Status .");
        }

        existing.isDisable = !existing.isDisable;
        await existing.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, `${draftMode ? 'Draft' : 'Thread'} updated successfully.`);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};



const trending = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await Thread.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `Thread not found.`);
        }


        existing.isTrending = !existing.isTrending;
        await existing.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, `Thread updated successfully.`);

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
            isTrending = false,
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


        if (isTrending !== "") {
            filters.isTrending = isTrending;
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
            .select(' -__v')
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

        let currentUserId = req.user?.userId?.toString();

        // Get liked thread IDs by current user
        let likedThreadSet = new Set();
        if (currentUserId) {
            const userLikes = await ThreadLike.find({
                userId: currentUserId,
                threadId: { $in: threadIds },
                isDeleted: false,
                isDisable: false
            }).select('threadId').lean();

            likedThreadSet = new Set(userLikes.map(like => like.threadId.toString()));
        }

        const enrichedThreads = threads.map(thread => {
            const tid = thread._id.toString();
            const uid = thread.userId?._id?.toString() || '';

            // Remove populated category data
            delete thread.categoryId;
            delete thread.subCategoryId;

            return {
                ...thread,
                totalFollowers: followerMap[uid] || 0,
                totalComments: commentMap[tid] || 0,
                totalLikes: likeMap[tid] || 0,
                totalAssociatedProducts: productMap[tid] || 0,
                myThread: currentUserId && uid === currentUserId,
                isLiked: likedThreadSet.has(tid)
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


const getFollowedUsersThreads = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            keyWord = '',
            categoryId,
            subCategoryId,
            sortBy = 'createdAt', // 'createdAt' | 'budget'
            sortOrder = 'desc'    // 'asc' | 'desc'
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const sortDir = sortOrder === 'asc' ? 1 : -1;
        const currentUserId = req.user?.userId;

        if (!currentUserId) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "User not authenticated");
        }

        // Step 1: Get userIds followed by current user
        const follows = await Follow.find({
            followedBy: toObjectId(currentUserId),
            isDeleted: false,
            isDisable: false
        }).select('userId');

        const followedUserIds = follows.map(f => f.userId);

        if (followedUserIds.length === 0) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "No followed users", {
                pageNo: page,
                size: limit,
                total: 0,
                threads: []
            });
        }

        // Step 2: Prepare filters
        const filters = {
            userId: { $in: followedUserIds },
            isDeleted: false
        };

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            filters.categoryId = categoryId;
        }

        if (subCategoryId && mongoose.Types.ObjectId.isValid(subCategoryId)) {
            filters.subCategoryId = subCategoryId;
        }

        if (keyWord?.trim()) {
            filters.title = { $regex: keyWord.trim(), $options: 'i' };
        }

        let sortStage = {};
        if (sortBy === 'budget') {
            sortStage = { 'budgetRange.min': sortDir };
        } else {
            sortStage = { createdAt: sortDir };
        }

        const threads = await Thread.find(filters)
            .populate('userId', 'userName profileImage isLive is_Id_verified is_Preferred_seller')
            .sort(sortStage)
            .skip((page - 1) * limit)
            .limit(limit)
            .select(' -__v')
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

            return {
                ...thread,
                totalFollowers: followerMap[uid] || 0,
                totalComments: commentMap[tid] || 0,
                totalLikes: likeMap[tid] || 0,
                totalAssociatedProducts: productMap[tid] || 0,
                myThread: uid === currentUserId
            };
        });

        const total = await Thread.countDocuments(filters);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Followed users' threads fetched successfully", {
            pageNo: page,
            size: limit,
            total,
            threads: enrichedThreads
        });

    } catch (error) {
        console.error('Error in getFollowedUsersThreads:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};


const getRecentFollowedUsers = async (req, res) => {
    try {
        const currentUserId = toObjectId(req.user.userId);
        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (pageNo - 1) * size;

        // Get followed user IDs
        const follows = await Follow.find({
            followedBy: currentUserId,
            isDeleted: false,
            isDisable: false
        }).select('userId');

        const followedUserIds = follows.map(f => f.userId);
        if (!followedUserIds.length) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "No followed users.", {
                pageNo,
                size,
                total: 0,
                users: []
            });
        }

        // Aggregate user info + latest thread
        const users = await User.aggregate([
            {
                $match: {
                    _id: { $in: followedUserIds },
                    isDeleted: false,
                    isDisable: false
                }
            },
            {
                $lookup: {
                    from: 'thread',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$userId', '$$userId'] },
                                isDeleted: false,
                                isDisable: false
                            }
                        },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                        {
                            $project: {
                                _id: 1,
                                title: 1,
                                createdAt: 1
                            }
                        }
                    ],
                    as: 'latestThread'
                }
            },
            {
                $addFields: {
                    latestThread: { $arrayElemAt: ['$latestThread', 0] },
                    latestThreadDate: {
                        $ifNull: [{ $arrayElemAt: ['$latestThread.createdAt', 0] }, null]
                    }
                }
            },
            {
                $sort: {
                    latestThreadDate: -1
                }
            },
            {
                $project: {
                    _id: 1,
                    userName: 1,
                    profileImage: 1,
                    isLive: 1,
                    latestThread: 1
                }
            },
            { $skip: skip },
            { $limit: size }
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Recent followed users fetched successfully.", {
            pageNo,
            size,
            total: followedUserIds.length,
            users
        });

    } catch (err) {
        console.error("Error in getRecentFollowedUsers:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};



const getDraftThreads = async (req, res) => {
    try {
        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;

        if (pageNo < 1 || size < 1) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid pageNo or size.');
        }

        const skip = (pageNo - 1) * size;

        const query = {
            userId: req.user.userId,
            isDeleted: { $ne: true }
        };

        const [drafts, total] = await Promise.all([
            ThreadDraft.find(query)
                .sort({ createdAt: -1 }) // newest first
                .skip(skip)
                .limit(size),
            ThreadDraft.countDocuments(query)
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, {
            total,
            pageNo,
            size,
            drafts,
        });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};




//thread
router.post('/create', perApiLimiter(), upload.array('files', 10), addThread);
router.post('/updateThread/:id', perApiLimiter(), upload.array('files', 10), updateThread);
router.post('/delete/:id', perApiLimiter(), deleteThread);
router.post('/changeStatus/:id', perApiLimiter(), changeStatus);
router.post('/trending/:id', perApiLimiter(), trending);



//getFollowedUsersThreads
router.get('/getFollowedUsersThreads', perApiLimiter(), upload.none(), getFollowedUsersThreads);
router.get('/recentUser', perApiLimiter(), getRecentFollowedUsers);
router.get('/getDraftThreads', perApiLimiter(), getDraftThreads);



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
