const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Thread, ThreadComment, SellProduct, Bid, Follow, ThreadLike, ThreadDraft, User, Category } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { default: mongoose } = require('mongoose');
const { SALE_TYPE, roleId, DeliveryType } = require('../../utils/Role');
// Import Algolia service
const { indexThread, deleteThreads } = require('../services/serviceAlgolia');

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
            isDraft,
            imageArray,
            draftId
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
            tagArray = raw
                .map(id => id.trim?.())
                .filter(id => id);
        }
        let photoUrls = [];
        // 1️⃣ URLs that came in req.body.imageArray
        if (imageArray) {
            const rawUrls = Array.isArray(imageArray) ? imageArray : [imageArray];
            photoUrls.push(
                ...rawUrls
                    .map(u => (typeof u === 'string' ? u.trim() : ''))
                    .filter(Boolean)                 // remove empty strings / null
            );
        }

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'thread-photos');
                if (imageUrl) photoUrls.push(imageUrl);
            }
        }

        photoUrls = [...new Set(photoUrls)];

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

            // 🔍 Index the thread in Algolia after successful save
            try {
                await indexThread(saved);
            } catch (algoliaError) {
                console.error('Algolia indexing failed for thread:', saved._id, algoliaError);
                // Don't fail the main operation if Algolia fails
            }

            if (draftId) {
                try {
                    await ThreadDraft.findByIdAndDelete(draftId);
                } catch (err) {
                    console.warn("⚠️ Failed to delete draft with ID:", draftId, err);
                    // Do not block main operation on this
                }
            }
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
            imageArray,

        } = req.body;

        const draftMode = isDraft === 'true' || isDraft === true;
        const Model = draftMode ? ThreadDraft : Thread;

        const existing = await Model.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `${draftMode ? 'Draft' : 'Thread'} not found.`);
        }

        if (req.user.roleId !== roleId.SUPER_ADMIN && existing.userId.toString() !== req.user.userId) {
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
        let photoUrls = [];



        if (imageArray) {
            const bodyUrls = (Array.isArray(imageArray) ? imageArray : [imageArray])
                .map(u => (typeof u === 'string' ? u.trim() : ''))
                .filter(Boolean);
            photoUrls = [...bodyUrls];
        } else {
            photoUrls = [...(existing.photos || [])];
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

        // 🔍 Update the thread in Algolia after successful update (only for published threads)
        if (!draftMode) {
            try {
                await indexThread(updated);
            } catch (algoliaError) {
                console.error('Algolia update failed for thread:', updated._id, algoliaError);
                // Don't fail the main operation if Algolia fails
            }
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, updated);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};



const deleteThread = async (req, res) => {
    try {
        const { id } = req.params;
        const isDraft = req.query?.isDraft; // pass ?isDraft=true if deleting draft
        const draftMode = isDraft === 'true';

        const Model = draftMode ? ThreadDraft : Thread;

        const existing = await Model.findById(id);
        // console.log(existing)
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `${draftMode ? 'Draft' : 'Thread'} not found.`);
        }

        if (existing.userId.toString() !== req.user.userId) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, "You are not authorized to delete this thread.");
        }

        // Soft delete: mark isDeleted = true
        existing.isDeleted = true;
        await existing.save();

        // 🔍 Remove from Algolia index after successful deletion (only for published threads)
        if (!draftMode) {
            try {
                await deleteThreads(existing._id);
            } catch (algoliaError) {
                console.error('Algolia deletion failed for thread:', existing._id, algoliaError);
                // Don't fail the main operation if Algolia fails
            }
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, `${draftMode ? 'Draft' : 'Thread'} deleted successfully.`);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error);
    }
};


const changeStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const isDraft = req.body?.isDraft; // pass ?isDraft=true if deleting draft
        const draftMode = isDraft === 'true';

        const Model = draftMode ? ThreadDraft : Thread;

        const existing = await Model.findById(id);
        if (!existing) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, `${draftMode ? 'Draft' : 'Thread'} not found.`);
        }

        if (req.user.roleId !== roleId.SUPER_ADMIN && existing.userId.toString() !== req.user.userId) {
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

const updateAllThreadTrending = async (req, res) => {
    try {
        const { updateAllThreadTrendingStatus } = require('../services/serviceThreadTrending');
        const result = await updateAllThreadTrendingStatus();

        return apiSuccessRes(HTTP_STATUS.OK, res, "Thread trending status updated successfully", result);
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
        thread.isClosed = !thread.isClosed
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
        const {
            threadId,
        } = req.params;
        const {
            categoryId,
            subCategoryId,
            condition,
            provinceId,
            districtId,
            averageRatting,
            deliveryFilter,

            keyWord
        } = req.query

        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.orderBy === 'asc' ? 1 : -1;

        if (!threadId || threadId.length !== 24) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid thread ID');
        }

        // Step 1: Get associated product IDs from thread comments
        const comments = await ThreadComment.find({ thread: toObjectId(threadId) })
            .select('associatedProducts')
            .lean();

        const productIds = comments.flatMap(c => c.associatedProducts).filter(Boolean);
        const uniqueProductIds = [...new Set(productIds.map(id => id.toString()))];

        // Step 2: Build filter for products
        // Step 2: Build filter for products
        const filter = { _id: { $in: uniqueProductIds.map(toObjectId) } };

        // Step 2.1: Apply direct product filters
        if (categoryId && categoryId.length === 24) filter.categoryId = toObjectId(categoryId);
        if (subCategoryId && subCategoryId.length === 24) filter.subCategoryId = toObjectId(subCategoryId);
        if (condition && condition !== "") filter.condition = condition;
        if (keyWord?.trim()) {
            filter.title = { $regex: keyWord.trim(), $options: 'i' };
        }
        if (deliveryFilter === "free") {
            filter.deliveryType = { $in: [DeliveryType.FREE_SHIPPING, DeliveryType.LOCAL_PICKUP] };
        } else if (deliveryFilter === "charged") {
            filter.deliveryType = DeliveryType.CHARGE_SHIPPING;
        }

        // Step 2.2: Apply user-based filters
        let userFilter = {};

        if (provinceId && provinceId.length === 24) userFilter.provinceId = toObjectId(provinceId);
        if (districtId && districtId.length === 24) userFilter.districtId = toObjectId(districtId);
        if (averageRatting) userFilter.averageRatting = { $gte: parseFloat(averageRatting) };

        let filteredUserIds = [];

        if (Object.keys(userFilter).length > 0) {
            const users = await User.find(userFilter).select('_id').lean();
            filteredUserIds = users.map(u => u._id.toString());

            // If no users match, prevent product match
            if (filteredUserIds.length === 0) {
                return apiSuccessRes(HTTP_STATUS.OK, res, 'No matching products found', {
                    total: 0,
                    size,
                    products: []
                });
            }

            filter.userId = { $in: filteredUserIds.map(toObjectId) };
        }

        // Step 3: Count total products after filter
        const total = await SellProduct.countDocuments(filter);

        // Step 4: Fetch paginated, sorted products with user info
        const products = await SellProduct.find(filter)
            .populate({
                path: 'userId',
                select: 'userName email is_Verified_Seller is_Preferred_seller profileImage isLive is_Id_verified'
            })
            .sort({ [sortBy]: sortOrder })
            .skip((pageNo - 1) * size)
            .limit(size)
            .lean();

        // Step 5: Append bid count if auction type
        const productWithBidInfo = await Promise.all(products.map(async (product) => {
            let bidCount = 0;
            if (product.saleType === SALE_TYPE.AUCTION) {
                bidCount = await Bid.countDocuments({ productId: toObjectId(product._id) });
            }

            return {
                ...product,
                bidCount,
                user: product.userId,
                userId: undefined
            };
        }));

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Associated products fetched successfully', {
            total,
            size,
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

        const filter = { thread: toObjectId(threadId), parent: null };
        const totalCount = await ThreadComment.countDocuments(filter);

        // Fetch top-level comments
        const comments = await ThreadComment.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('author', 'userName profileImage isLive is_Id_verified is_Preferred_seller averageRatting')
            .populate('associatedProducts')
            .lean();

        const commentIds = comments.map(comment => comment?._id);


        // Get reply counts for each comment
        const replyCounts = await ThreadComment.aggregate([
            { $match: { parent: { $in: commentIds } } },
            { $group: { _id: '$parent', totalReplies: { $sum: 1 } } }
        ]);

        // Create a map of reply counts
        const replyCountMap = {};
        replyCounts.forEach(count => {
            replyCountMap[count._id.toString()] = count.totalReplies;
        });

        // Fetch all replies for these top-level comments
        const replies = await ThreadComment.find({ parent: { $in: commentIds } })
            .sort({ createdAt: 1 })
            .populate('author', 'userName profileImage isLive is_Id_verified is_Preferred_seller averageRatting')
            .populate('associatedProducts')
            .lean();

        // Group replies under their parent comment
        const replyMap = {};
        replies.forEach(reply => {
            const parentId = reply.parent.toString();
            if (!replyMap[parentId]) replyMap[parentId] = [];
            replyMap[parentId].push(reply);
        });

        // Attach replies and total reply count to each comment
        const enrichedComments = comments.map(comment => ({
            ...comment,
            replies: replyMap[comment?._id.toString()] || [],
            totalReplies: replyCountMap[comment?._id.toString()] || 0
        }));

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
            .populate("author", "userName profileImage")
            .populate(
                "associatedProducts",
                "title _id description productImages condition saleType"
            )
            .lean();

        // For each reply, fetch total replies count & first reply
        const enrichedReplies = await Promise.all(
            replies.map(async (reply) => {
                const totalRepliesCount = await ThreadComment.countDocuments({
                    parent: reply?._id,
                });

                const firstReply = await ThreadComment.findOne({
                    parent: reply?._id,
                })
                    .sort({ createdAt: 1 })
                    .populate("author", "userName profileImage")
                    .lean();

                return {
                    ...reply,
                    totalReplies: totalRepliesCount,
                    firstReply: firstReply
                        ? {
                            _id: firstReply?._id,
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


//corrrect only total count is issue
// const getThreads = async (req, res) => {
//     try {
//         let {
//             pageNo = 1,
//             size = 10,
//             keyWord = '',
//             categoryId,
//             subCategoryId,
//             userId,
//             isTrending,
//             sortBy = 'createdAt', // 'createdAt' | 'budget' | 'comments'
//             orderBy = 'desc',   // 'asc' | 'desc',
//             minBudget,
//             maxBudget,
//             isDraft = 'false',
//             minAverageRatting,
//             provinceId,
//             districtId
//         } = req.query;



//         const allowedSortFields = ['createdAt', 'commentCount', 'viewCount'];
//         const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
//         const sortOrder = orderBy.toLowerCase() === 'desc' ? -1 : 1;
//         const sortOptions = {};
//         sortOptions[sortField] = sortOrder;

//         let page = parseInt(pageNo);
//         let limit = parseInt(size);


//         const filters = { isDeleted: false };
//         if (minBudget || maxBudget) {
//             filters['budgetRange.min'] = {};
//             if (minBudget) {
//                 filters['budgetRange.min'].$gte = parseFloat(minBudget);
//             }
//             if (maxBudget) {
//                 filters['budgetRange.min'].$lte = parseFloat(maxBudget);
//             }
//         }

//         if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
//             filters.categoryId = categoryId;
//         }


//         if (req.query.isTrending !== undefined) {
//             filter.isTrending = req.query.isTrending === 'true'; // or Boolean(JSON.parse(req.query.isTrending))
//         }

//         if (subCategoryId && mongoose.Types.ObjectId.isValid(subCategoryId)) {
//             filters.subCategoryId = subCategoryId;
//         }

//         if (userId && mongoose.Types.ObjectId.isValid(userId)) {
//             filters.userId = userId; // 👈 filter by userId
//         }
//         if (keyWord?.trim()) {
//             filters.title = { $regex: keyWord.trim(), $options: 'i' };
//         }


//         let userFilter = {};
//         if (provinceId && mongoose.Types.ObjectId.isValid(provinceId)) {
//             userFilter.provinceId = provinceId;
//         }
//         if (districtId && mongoose.Types.ObjectId.isValid(districtId)) {
//             userFilter.districtId = districtId;
//         }


//         if (Object.keys(userFilter).length > 0) {
//             // find users matching location filter
//             const matchedUsers = await User.find(userFilter).select('_id').lean();
//             const matchedUserIds = matchedUsers.map(u => u._id.toString());
//             // if userId filter already exists, intersect userIds; else assign
//             if (filters.userId) {
//                 // intersect existing userId filter with matchedUserIds
//                 if (Array.isArray(filters.userId)) {
//                     filters.userId = filters.userId.filter(id => matchedUserIds.includes(id.toString()));
//                 } else {
//                     filters.userId = matchedUserIds.includes(filters.userId.toString()) ? filters.userId : null;
//                 }
//             } else {
//                 filters.userId = { $in: matchedUserIds };
//             }
//             // if no matched users, no threads should be returned
//             if (!filters.userId || (Array.isArray(filters.userId) && filters.userId.length === 0)) {
//                 return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
//                     pageNo: parseInt(pageNo),
//                     size: parseInt(size),
//                     total: 0,
//                     products: [],
//                 });
//             }
//         }
//         Object.keys(filters).forEach(key => {
//             if (
//                 filters[key] === undefined ||
//                 filters[key] === null ||
//                 filters[key] === '' ||
//                 (Array.isArray(filters[key]) && filters[key].length === 0)
//             ) {
//                 delete filters[key];
//             }
//         });

//         const ThreadModel = isDraft === 'true' ? ThreadDraft : Thread;
//         const threads = await ThreadModel.find(filters)
//             .populate('userId', 'userName profileImage isLive is_Id_verified is_Preferred_seller averageRatting')
//             .populate('categoryId', 'name subCategoryId image') // populate but remove later
//             // .sort(sortOptions)
//             .sort(sortField === 'createdAt' ? sortOptions : {}) // Apply sort only if createdAt
//             .skip((page - 1) * limit)
//             .limit(limit)
//             .select(' -__v')
//             .lean();

//         console.log('Threads fetched:', threads.length);
//         const threadIds = threads.map(t => t?._id);
//         const userIds = [...new Set(threads.map(t => t.userId?._id?.toString()).filter(Boolean))];

//         const [followerCounts, commentCounts, likeCounts, productCounts] = await Promise.all([
//             Follow.aggregate([
//                 { $match: { userId: { $in: userIds.map(id => toObjectId(id)) }, isDeleted: false, isDisable: false } },
//                 { $group: { _id: '$userId', count: { $sum: 1 } } }
//             ]),
//             ThreadComment.aggregate([
//                 { $match: { thread: { $in: threadIds } } },
//                 { $group: { _id: '$thread', count: { $sum: 1 } } }
//             ]),
//             ThreadLike.aggregate([
//                 { $match: { threadId: { $in: threadIds }, isDeleted: false, isDisable: false } },
//                 { $group: { _id: '$threadId', count: { $sum: 1 } } }
//             ]),
//             ThreadComment.aggregate([
//                 { $match: { thread: { $in: threadIds }, associatedProducts: { $exists: true, $not: { $size: 0 } } } },
//                 {
//                     $group: {
//                         _id: '$thread',
//                         productSet: { $addToSet: '$associatedProducts' }
//                     }
//                 },
//                 {
//                     $project: {
//                         count: {
//                             $size: {
//                                 $reduce: {
//                                     input: '$productSet',
//                                     initialValue: [],
//                                     in: { $setUnion: ['$$value', '$$this'] }
//                                 }
//                             }
//                         }
//                     }
//                 }
//             ])
//         ]);

//         const followerMap = Object.fromEntries(followerCounts.map(f => [f?._id.toString(), f.count]));
//         const commentMap = Object.fromEntries(commentCounts.map(c => [c?._id.toString(), c.count]));
//         const likeMap = Object.fromEntries(likeCounts.map(l => [l?._id.toString(), l.count]));
//         const productMap = Object.fromEntries(productCounts.map(p => [p?._id.toString(), p.count]));

//         let currentUserId = req.user?.userId?.toString();

//         // Get liked thread IDs by current user
//         let likedThreadSet = new Set();
//         if (currentUserId) {

//             const userLikes = await ThreadLike.find({
//                 likeBy: toObjectId(currentUserId),
//                 threadId: { $in: threadIds.map(id => toObjectId(id)) }
//             }).select('threadId').lean();
//             likedThreadSet = new Set(userLikes.map(like => like.threadId.toString()));
//         }

//         const subCategoryNameMap = {};

//         const categories = await Category.find({
//             'subCategories._id': { $in: threads.map(t => t.subCategoryId) }
//         }).lean();

//         categories.forEach(category => {
//             category.subCategories.forEach(sub => {
//                 subCategoryNameMap[sub._id.toString()] = sub.name;
//             });
//         });


//         let filteredThreads = threads;

//         // Apply minAverageRatting before paginating
//         if (minAverageRatting) {
//             filteredThreads = threads.filter(thread => {
//                 const rating = parseFloat(thread?.userId?.averageRatting) || 0;
//                 return rating >= parseFloat(minAverageRatting);
//             });
//         } else {
//             filteredThreads = threads;
//         }

//         // Store total BEFORE slicing (pagination)
//         const total = filteredThreads.length;
//         console.log("777777", total)

//         // Apply pagination AFTER filtering
//         filteredThreads = filteredThreads.slice((page - 1) * limit, page * limit);


//         const enrichedThreads = filteredThreads.map(thread => {
//             const tid = thread?._id.toString();
//             const uid = thread.userId?._id?.toString() || '';
//             const { subCategoryId, photos, ...rest } = thread;
//             return {
//                 ...rest,
//                 image: thread?.image || thread?.photos,
//                 totalFollowers: followerMap[uid] || 0,
//                 totalComments: commentMap[tid] || 0,
//                 totalLikes: likeMap[tid] || 0,
//                 totalAssociatedProducts: productMap[tid] || 0,
//                 myThread: currentUserId && uid === currentUserId,
//                 isLiked: likedThreadSet.has(tid),
//                 subCategory: {
//                     id: subCategoryId,
//                     name: subCategoryNameMap[subCategoryId] || null
//                 },
//             };
//         });
//         if (sortField === 'commentCount') {
//             enrichedThreads.sort((a, b) => {
//                 const countA = a.totalComments || 0;
//                 const countB = b.totalComments || 0;
//                 return sortOrder === -1 ? countB - countA : countA - countB;
//             });
//         }

//         // const total = filteredThreads.length;

//         return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
//             pageNo: page,
//             size: limit,
//             total: total,
//             products: enrichedThreads,
//         });

//     } catch (error) {
//         console.error('Error in getThreads:', error);
//         return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");

//     }
// };
//
const getThreads = async (req, res) => {
    try {
        let {
            pageNo = 1,
            size = 10,
            keyWord = '',
            categoryId,
            subCategoryId,
            userId,
            isTrending = 'false',
            sortBy = 'createdAt', // 'createdAt' | 'budget' | 'comments'
            orderBy = 'desc',   // 'asc' | 'desc',
            minPrice,
            maxPrice,
            isDraft = 'false',
            minAverageRatting,
            provinceId,
            districtId
        } = req.query;

        const allowedSortFields = ['createdAt', 'commentCount', 'viewCount'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
        const sortOrder = orderBy.toLowerCase() === 'desc' ? -1 : 1;
        const sortOptions = {};
        sortOptions[sortField] = sortOrder;

        let page = parseInt(pageNo);
        let limit = parseInt(size);

        const filters = { isDeleted: false };
        if (minPrice || maxPrice) {
            filters['budgetRange.min'] = {};
            if (minPrice) {
                filters['budgetRange.min'].$gte = parseFloat(minPrice);
            }
            if (maxPrice) {
                filters['budgetRange.min'].$lte = parseFloat(maxPrice);
            }
        }

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            filters.categoryId = categoryId;
        }

        // Fixed: Changed 'filter' to 'filters'
        if (req.query.isTrending !== undefined) {
            filters.isTrending = req.query.isTrending === 'true'; // or Boolean(JSON.parse(req.query.isTrending))
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

        let userFilter = {};
        if (provinceId && mongoose.Types.ObjectId.isValid(provinceId)) {
            userFilter.provinceId = provinceId;
        }
        if (districtId && mongoose.Types.ObjectId.isValid(districtId)) {
            userFilter.districtId = districtId;
        }

        if (Object.keys(userFilter).length > 0) {
            // find users matching location filter
            const matchedUsers = await User.find(userFilter).select('_id').lean();
            const matchedUserIds = matchedUsers.map(u => u._id.toString());
            // if userId filter already exists, intersect userIds; else assign
            if (filters.userId) {
                // intersect existing userId filter with matchedUserIds
                if (Array.isArray(filters.userId)) {
                    filters.userId = filters.userId.filter(id => matchedUserIds.includes(id.toString()));
                } else {
                    filters.userId = matchedUserIds.includes(filters.userId.toString()) ? filters.userId : null;
                }
            } else {
                filters.userId = { $in: matchedUserIds };
            }
            // if no matched users, no threads should be returned
            if (!filters.userId || (Array.isArray(filters.userId) && filters.userId.length === 0)) {
                return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
                    pageNo: parseInt(pageNo),
                    size: parseInt(size),
                    total: 0,
                    products: [],
                });
            }
        }

        Object.keys(filters).forEach(key => {
            if (
                filters[key] === undefined ||
                filters[key] === null ||
                filters[key] === '' ||
                (Array.isArray(filters[key]) && filters[key].length === 0)
            ) {
                delete filters[key];
            }
        });

        const ThreadModel = isDraft === 'true' ? ThreadDraft : Thread;

        // Get total count first - without pagination, but with all other filters
        let totalCountQuery = ThreadModel.find(filters);

        // If minAverageRatting is specified, we need to populate and filter
        if (minAverageRatting) {
            totalCountQuery = totalCountQuery.populate('userId', 'averageRatting');
        }

        let totalThreads = await totalCountQuery.lean();

        // Apply minAverageRatting filter if specified
        if (minAverageRatting) {
            totalThreads = totalThreads.filter(thread => {
                const rating = parseFloat(thread?.userId?.averageRatting) || 0;
                return rating >= parseFloat(minAverageRatting);
            });
        }

        const total = totalThreads.length;

        // Now get the actual paginated data
        const threads = await ThreadModel.find(filters)
            .populate('userId', 'userName profileImage isLive is_Id_verified is_Preferred_seller averageRatting')
            .populate('categoryId', 'name subCategoryId image') // populate but remove later
            // .sort(sortOptions)
            .sort(sortField === 'createdAt' ? sortOptions : {}) // Apply sort only if createdAt
            .skip((page - 1) * limit)
            .limit(limit)
            .select(' -__v')
            .lean();


        const threadIds = threads.map(t => t?._id);
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

        const followerMap = Object.fromEntries(followerCounts.map(f => [f?._id.toString(), f.count]));
        const commentMap = Object.fromEntries(commentCounts.map(c => [c?._id.toString(), c.count]));
        const likeMap = Object.fromEntries(likeCounts.map(l => [l?._id.toString(), l.count]));
        const productMap = Object.fromEntries(productCounts.map(p => [p?._id.toString(), p.count]));

        let currentUserId = req.user?.userId?.toString();

        // Get liked thread IDs by current user
        let likedThreadSet = new Set();
        if (currentUserId) {

            const userLikes = await ThreadLike.find({
                likeBy: toObjectId(currentUserId),
                threadId: { $in: threadIds.map(id => toObjectId(id)) }
            }).select('threadId').lean();
            likedThreadSet = new Set(userLikes.map(like => like.threadId.toString()));
        }

        const subCategoryNameMap = {};

        const categories = await Category.find({
            'subCategories._id': { $in: threads.map(t => t.subCategoryId) }
        }).lean();

        categories.forEach(category => {
            category.subCategories.forEach(sub => {
                subCategoryNameMap[sub._id.toString()] = sub.name;
            });
        });

        let filteredThreads = threads;

        // Apply minAverageRatting filter to paginated results
        if (minAverageRatting) {
            filteredThreads = threads.filter(thread => {
                const rating = parseFloat(thread?.userId?.averageRatting) || 0;
                return rating >= parseFloat(minAverageRatting);
            });
        } else {
            filteredThreads = threads;
        }

        const enrichedThreads = filteredThreads.map(thread => {
            const tid = thread?._id.toString();
            const uid = thread.userId?._id?.toString() || '';
            const { subCategoryId, photos, ...rest } = thread;
            return {
                ...rest,
                image: thread?.image || thread?.photos,
                totalFollowers: followerMap[uid] || 0,
                totalComments: commentMap[tid] || 0,
                totalLikes: likeMap[tid] || 0,
                totalAssociatedProducts: productMap[tid] || 0,
                myThread: currentUserId && uid === currentUserId,
                isLiked: likedThreadSet.has(tid),
                subCategory: {
                    id: subCategoryId,
                    name: subCategoryNameMap[subCategoryId] || null
                },
            };
        });

        if (sortField === 'commentCount') {
            enrichedThreads.sort((a, b) => {
                const countA = a.totalComments || 0;
                const countB = b.totalComments || 0;
                return sortOrder === -1 ? countB - countA : countA - countB;
            });
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
            pageNo: page,
            size: limit,
            total: total, // Now correctly shows total after all filtering
            products: enrichedThreads,
        });

    } catch (error) {
        console.error('Error in getThreads:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");

    }
};


const getThreadById = async (req, res) => {
    try {
        const { threadId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(threadId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid thread ID");
        }

        const thread = await Thread.findOne({ _id: threadId, isDeleted: false })
            .populate({
                path: 'userId',
                select: 'userName profileImage isLive is_Id_verified is_Preferred_seller provinceId districtId',
                populate: [
                    { path: 'provinceId', select: 'value' },
                    { path: 'districtId', select: 'value' }
                ]
            })
            .populate('categoryId')
            .select('-__v')
            .lean();

        if (!thread) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Thread not found");
        }

        // Increment view count
        await Thread.findByIdAndUpdate(threadId, { $inc: { viewCount: 1 } });

        // Trigger trending update job
        const { addThreadTrendingUpdateJob } = require('../services/serviceThreadTrending');
        addThreadTrendingUpdateJob(threadId);

        const threadObjectId = toObjectId(threadId);
        const userId = thread.userId?._id?.toString();
        const currentUserId = req.user?.userId?.toString();

        const [followerCount, commentCount, likeCount, productCount, likedByUser] = await Promise.all([
            Follow.countDocuments({ userId, isDeleted: false, isDisable: false }),
            ThreadComment.countDocuments({ thread: threadObjectId, parent: null }),
            ThreadLike.countDocuments({ threadId: threadObjectId, isDeleted: false, isDisable: false }),
            ThreadComment.aggregate([
                { $match: { thread: threadObjectId, associatedProducts: { $exists: true, $not: { $size: 0 } } } },
                {
                    $group: {
                        _id: null,
                        productSet: { $addToSet: "$associatedProducts" }
                    }
                },
                {
                    $project: {
                        count: {
                            $size: {
                                $reduce: {
                                    input: "$productSet",
                                    initialValue: [],
                                    in: { $setUnion: ["$$value", "$$this"] }
                                }
                            }
                        }
                    }
                }
            ]),
            currentUserId
                ? ThreadLike.exists({
                    threadId: threadObjectId,
                    likeBy: toObjectId(currentUserId)
                })
                : false
        ]);


        let isFollow = false;
        if (currentUserId && userId) {
            isFollow = await Follow.exists({
                userId: toObjectId(userId),
                followedBy: toObjectId(currentUserId),
                isDeleted: false,
                isDisable: false
            });
        }

        // Get subcategory name from category
        let subCategoryName = null;
        if (thread.subCategoryId && thread.categoryId?.subCategories?.length) {
            const sub = thread.categoryId.subCategories.find(
                s => s._id.toString() === thread.subCategoryId.toString()
            );
            if (sub) subCategoryName = sub.name;
        }



        const topComments = await ThreadComment.aggregate([
            { $match: { thread: threadObjectId, parent: null } },
            { $sort: { createdAt: -1 } },
            { $limit: 2 },
            {
                $lookup: {
                    from: "User",
                    localField: "author",
                    foreignField: "_id",
                    as: "author"
                }
            },

            { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },

            {
                $lookup: {
                    from: "SellProduct",
                    localField: "associatedProducts",
                    foreignField: "_id",
                    as: "associatedProducts"
                }
            },
            {
                $lookup: {
                    from: "ThreadComment",
                    let: { parentId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$parent", "$$parentId"] } } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                        {
                            $lookup: {
                                from: "User",
                                localField: "author",
                                foreignField: "_id",
                                as: "author"
                            }
                        },

                        { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },

                        {
                            $lookup: {
                                from: "SellProduct",
                                localField: "associatedProducts",
                                foreignField: "_id",
                                as: "associatedProducts"
                            }
                        }
                    ],
                    as: "topReply"
                }
            },
            {
                $lookup: {
                    from: "ThreadComment",
                    let: { parentId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$parent", "$$parentId"] } } },
                        { $count: "totalReplies" }
                    ],
                    as: "replyCount"
                }
            },
            {
                $addFields: {
                    totalReplies: { $ifNull: [{ $arrayElemAt: ["$replyCount.totalReplies", 0] }, 0] }
                }
            },
            {
                $project: {
                    _id: 1,
                    content: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    associatedProducts: {
                        _id: 1,
                        title: 1,
                        description: 1,
                        fixedPrice: 1,
                        isSold: 1,
                        auctionSettings: 1,
                        productImages: 1
                    },
                    author: {
                        _id: 1,
                        userName: 1,
                        profileImage: 1,
                        isLive: 1,
                        is_Id_verified: 1,
                        is_Verified_Seller: 1
                    },
                    topReply: {
                        _id: 1,
                        content: 1,
                        createdAt: 1,
                        associatedProducts: {
                            _id: 1,
                            title: 1,
                            description: 1,
                            fixedPrice: 1,
                            isSold: 1,
                            productImages: 1,
                            auctionSettings: 1,

                        },
                        author: {
                            _id: 1,
                            userName: 1,
                            profileImage: 1,
                            isLive: 1,
                            is_Id_verified: 1,
                            is_Verified_Seller: 1
                        }
                    },
                    totalReplies: 1
                }
            }
        ]);



        // 1. Gather all associated product IDs from thread comments
        const allAssociatedProductIdsAgg = await ThreadComment.aggregate([
            { $match: { thread: threadObjectId } },
            { $project: { associatedProducts: 1 } },

            { $unwind: { path: "$associatedProducts", preserveNullAndEmptyArrays: true } },

            { $group: { _id: null, productIds: { $addToSet: "$associatedProducts" } } }
        ]);

        // 2. Get associated product IDs from the thread itself (if needed)
        let threadProductIds = [];
        if (thread.associatedProducts && thread.associatedProducts.length) {
            threadProductIds = thread.associatedProducts.map(id => id.toString());
        }

        let commentProductIds = allAssociatedProductIdsAgg[0]?.productIds?.map(id => id.toString()) || [];

        const allProductIds = Array.from(new Set([...threadProductIds, ...commentProductIds])).map(id => toObjectId(id));

        // 3. Fetch product details with user info
        const associatedProductsFull = await SellProduct.aggregate([
            { $match: { _id: { $in: allProductIds } } },
            {
                $lookup: {
                    from: "User",
                    localField: "userId",
                    foreignField: "_id",
                    as: "seller"
                }
            },


            { $unwind: { path: "$seller", preserveNullAndEmptyArrays: true } },

            {
                $lookup: {
                    from: "Bid",
                    let: { productId: "$_id", saleType: "$saleType" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$productId", "$$productId"] },
                                    ]
                                }
                            }
                        }
                    ],
                    as: "bids"
                }
            },

            {
                $addFields: {
                    totalBids: {
                        $cond: [
                            { $eq: ["$saleType", "auction"] },
                            { $size: "$bids" },
                            0
                        ]
                    }
                }
            },

            {
                $project: {
                    _id: 1,
                    title: 1,
                    description: 1,
                    fixedPrice: 1,
                    isSold: 1,
                    saleType: 1,
                    totalBids: 1,
                    photo: 1,
                    productImages: 1,
                    auctionSettings: 1,
                    seller: {
                        _id: 1,
                        userName: 1,
                        isLive: 1,
                        is_Id_verified: 1,
                        is_Verified_Seller: 1,
                        profileImage: 1
                    }
                }
            }
        ]);
        const recommendedThreads = await Thread.aggregate([
            {
                $match: {
                    _id: { $ne: threadObjectId },
                    isDeleted: false,
                    $or: [
                        { categoryId: thread.categoryId?._id || thread.categoryId },
                        { subCategoryId: thread.subCategoryId }
                    ]
                }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 10 },

            // Lookup user
            {
                $lookup: {
                    from: "User",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user"
                }
            },

            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },






            {
                $lookup: {
                    from: "Location",              // ← collection that stores provinces
                    localField: "user.provinceId", // ObjectId on the user doc
                    foreignField: "_id",
                    as: "province"
                }
            },
            { $unwind: { path: "$province", preserveNullAndEmptyArrays: true } },

            // district
            {
                $lookup: {
                    from: "Location",              // or "District" if you use two collections
                    localField: "user.districtId",
                    foreignField: "_id",
                    as: "district"
                }
            },
            { $unwind: { path: "$district", preserveNullAndEmptyArrays: true } },










            // Lookup likes
            {
                $lookup: {
                    from: "ThreadLike",
                    let: { threadId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$threadId", "$$threadId"] },
                                isDeleted: false,
                                isDisable: false
                            }
                        },
                        { $group: { _id: null, count: { $sum: 1 } } }
                    ],
                    as: "likeStats"
                }
            },

            // Lookup comments
            {
                $lookup: {
                    from: "ThreadComment",
                    let: { threadId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$thread", "$$threadId"] },
                                parent: null
                            }
                        },
                        { $group: { _id: null, count: { $sum: 1 } } }
                    ],
                    as: "commentStats"
                }
            },

            // Lookup if current user liked this thread
            ...(currentUserId ? [{
                $lookup: {
                    from: "ThreadLike",
                    let: { threadId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$threadId", "$$threadId"] },
                                        { $eq: ["$likeBy", toObjectId(currentUserId)] }
                                    ]
                                },
                                isDeleted: false,
                                isDisable: false
                            }
                        },
                        { $limit: 1 }
                    ],
                    as: "likedByUser"
                }
            }] : []),

            // Lookup total associated products from comments
            {
                $lookup: {
                    from: "ThreadComment",
                    let: { threadId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$thread", "$$threadId"] },
                                isDeleted: false
                            }
                        },
                        { $project: { associatedProducts: 1 } },
                        { $unwind: { path: "$associatedProducts", preserveNullAndEmptyArrays: true } },
                        {
                            $group: {
                                _id: null,
                                totalAssociatedProducts: { $sum: 1 }
                            }
                        }
                    ],
                    as: "commentProductStats"
                }
            },

            // Final projection
            {
                $project: {
                    _id: 1,
                    title: 1,
                    isClosed: 1,
                    description: 1,
                    budgetRange: 1,
                    createdAt: 1,
                    budgetFlexible: 1,
                    photos: 1,
                    tags: 1,

                    user: {
                        _id: "$user._id",
                        userName: "$user.userName",
                        profileImage: "$user.profileImage",
                        isLive: "$user.isLive",
                        is_Id_verified: "$user.is_Id_verified",
                        is_Verified_Seller: "$user.is_Verified_Seller",
                        provinceId: {
                            _id: "$province._id",
                            value: "$province.value"
                        },
                        districtId: {
                            _id: "$district._id",
                            value: "$district.value"
                        }
                    },

                    totalLikes: { $ifNull: [{ $arrayElemAt: ["$likeStats.count", 0] }, 0] },
                    totalComments: { $ifNull: [{ $arrayElemAt: ["$commentStats.count", 0] }, 0] },
                    isLiked: {
                        $cond: {
                            if: { $gt: [{ $size: "$likedByUser" }, 0] },
                            then: true,
                            else: false
                        }
                    },
                    productCount: {
                        $ifNull: [{ $arrayElemAt: ["$commentProductStats.totalAssociatedProducts", 0] }, 0]
                    }
                }
            }
        ]);



        if (thread.categoryId && thread.categoryId.subCategories) {
            delete thread.categoryId.subCategories;
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Thread fetched successfully", {
            ...thread,
            totalFollowers: followerCount || 0,
            totalComments: commentCount || 0,
            totalLikes: likeCount || 0,
            totalAssociatedProducts: productCount[0]?.count || 0,
            isLiked: !!likedByUser,
            isFollow: !!isFollow,
            associatedProducts: associatedProductsFull,
            topComments: topComments,
            recommendedThreads,
            myThread: currentUserId && userId === currentUserId,
            subCategoryId: thread?.subCategoryId || null,
            subCategoryName
        });
    } catch (error) {
        console.error("Error in getThreadById:", error);
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

        const threadIds = threads.map(t => t?._id);
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

        const followerMap = Object.fromEntries(followerCounts.map(f => [f?._id.toString(), f.count]));
        const commentMap = Object.fromEntries(commentCounts.map(c => [c?._id.toString(), c.count]));
        const likeMap = Object.fromEntries(likeCounts.map(l => [l?._id.toString(), l.count]));
        const productMap = Object.fromEntries(productCounts.map(p => [p?._id.toString(), p.count]));

        const enrichedThreads = threads.map(thread => {
            const tid = thread?._id.toString();
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

/////////////////////////////////////////////////////////////////
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
        const followedUserIdsRaw = follows.map(f => f.userId);

        const activeFollowedUsers = await User.find({
            _id: { $in: followedUserIdsRaw },
            isDeleted: false,
            isDisable: false
        }).select('_id');

        const followedUserIds = activeFollowedUsers.map(user => user?._id);

        if (!followedUserIds.length) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "No followed users.", {
                pageNo,
                size,
                total: 0,
                users: []
            });
        }



        // Aggregate user info + latest thread + total followers
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
                    from: 'Thread',
                    let: { userId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$userId', '$$userId'] }, isDeleted: false, isDisable: false } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 1 },
                        // Count total distinct comments
                        {
                            $lookup: {
                                from: 'ThreadComment',
                                let: { threadId: '$_id' },
                                pipeline: [
                                    {
                                        $match: {
                                            $expr: { $eq: ['$thread', '$$threadId'] },
                                            isDeleted: false,
                                            isDisable: false
                                        }
                                    },
                                    { $count: 'totalComments' }
                                ],
                                as: 'commentsCountInfo'
                            }
                        },

                        // Count all associated products across all comments
                        {
                            $lookup: {
                                from: 'ThreadComment',
                                let: { threadId: '$_id' },
                                pipeline: [
                                    {
                                        $match: {
                                            $expr: { $eq: ['$thread', '$$threadId'] },
                                            isDeleted: false,
                                            isDisable: false,
                                            associatedProducts: { $exists: true, $ne: [] }
                                        }
                                    },
                                    { $unwind: '$associatedProducts' },
                                    {
                                        $group: {
                                            _id: null,
                                            count: { $sum: 1 }
                                        }
                                    }
                                ],
                                as: 'associatedProductCountInfo'
                            }
                        },

                        {
                            $lookup: {
                                from: 'ThreadLike',
                                let: { threadId: '$_id', currentUserId: currentUserId }, // Pass currentUserId as ObjectId
                                pipeline: [
                                    { $match: { $expr: { $eq: ['$threadId', '$$threadId'] }, isDeleted: false, isDisable: false } },
                                    {
                                        $addFields: {
                                            // Debug fields
                                            likeByType: { $type: '$likeBy' },
                                            currentUserIdType: { $type: '$$currentUserId' },
                                            likeByStr: { $toString: '$likeBy' },
                                            currentUserIdStr: { $toString: '$$currentUserId' },
                                            isCurrentUserLike: { $eq: ['$likeBy', '$$currentUserId'] }
                                        }
                                    },
                                    {
                                        $group: {
                                            _id: null,
                                            totalLikes: { $sum: 1 },
                                            likedByCurrentUser: {
                                                $sum: {
                                                    $cond: [{ $eq: ['$likeBy', '$$currentUserId'] }, 1, 0]
                                                }
                                            },
                                            // Debug info
                                            debugInfo: {
                                                $push: {
                                                    likeBy: '$likeBy',
                                                    likeByType: '$likeByType',
                                                    currentUserId: '$$currentUserId',
                                                    currentUserIdType: '$currentUserIdType',
                                                    isMatch: '$isCurrentUserLike'
                                                }
                                            }
                                        }
                                    }
                                ],
                                as: 'likesInfo'
                            }
                        },
                        {
                            $addFields: {
                                associatedProductCount: { $ifNull: [{ $arrayElemAt: ['$associatedProductCountInfo.count', 0] }, 0] },
                                totalComments: { $ifNull: [{ $arrayElemAt: ['$commentsCountInfo.totalComments', 0] }, 0] },
                                totalLikes: { $ifNull: [{ $arrayElemAt: ['$likesInfo.totalLikes', 0] }, 0] },
                                isLiked: {
                                    $gt: [
                                        { $ifNull: [{ $arrayElemAt: ['$likesInfo.likedByCurrentUser', 0] }, 0] },
                                        0
                                    ]
                                },
                                // Debug field
                                debugLikesInfo: { $arrayElemAt: ['$likesInfo', 0] }
                            }
                        },
                        {
                            $project: {
                                _id: 1,
                                title: 1,
                                createdAt: 1,
                                description: 1,
                                budgetFlexible: 1,
                                isClosed: 1,
                                budgetRange: 1,
                                tags: 1,
                                photos: 1,
                                isTrending: 1,
                                associatedProductCount: 1,
                                totalComments: 1,
                                totalLikes: 1,
                                isLiked: 1,
                                debugLikesInfo: 1 // Include debug info in output
                            }
                        }
                    ],
                    as: 'latestThread'
                }
            },
            {
                $lookup: {
                    from: 'Follow',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$userId', '$$userId'] },
                                isDeleted: false,
                                isDisable: false
                            }
                        },
                        { $count: 'count' }
                    ],
                    as: 'followersCount'
                }
            },
            {
                $addFields: {
                    latestThread: { $arrayElemAt: ['$latestThread', 0] },
                    latestThreadDate: {
                        $ifNull: [{ $arrayElemAt: ['$latestThread.createdAt', 0] }, null]
                    },
                    totalFollowers: {
                        $ifNull: [{ $arrayElemAt: ['$followersCount.count', 0] }, 0]
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
                    latestThread: 1,
                    totalFollowers: 1
                }
            },
            { $skip: skip },
            { $limit: size }
        ]);

        // Debug: Log the results

        // Remove debug info before sending response
        const cleanUsers = users.map(user => {
            if (user.latestThread && user.latestThread.debugLikesInfo) {
                delete user.latestThread.debugLikesInfo;
            }
            return user;
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, "Recent followed users fetched successfully.", {
            pageNo,
            size,
            total: followedUserIds.length,
            users: cleanUsers
        });

    } catch (err) {
        console.error("Error in getRecentFollowedUsers:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};
/////////////////////////////////////////////////////////////////



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

const selectProductForAssociation = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Unauthorized access");
        }

        const { pageNo = 1, size = 10, keyWord = "" } = req.query;

        const matchConditions = {
            userId: toObjectId(userId),
            isSold: false,
            isDeleted: false
        };

        if (keyWord && keyWord.trim() !== "") {
            matchConditions.$or = [
                { title: { $regex: keyWord, $options: "i" } },
                { description: { $regex: keyWord, $options: "i" } }
            ];
        }

        const skip = (parseInt(pageNo) - 1) * parseInt(size);

        const [products, totalCount] = await Promise.all([
            SellProduct.find(matchConditions)
                .select("_id title description fixedPrice saleType productImages createdAt")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(size))
                .lean(),
            SellProduct.countDocuments(matchConditions)
        ]);

        const auctionProductIds = products
            .filter(p => p.saleType === "auction")
            .map(p => p._id);



        let bidCounts = {};
        if (auctionProductIds.length > 0) {
            const bids = await Bid.aggregate([
                { $match: { productId: { $in: auctionProductIds } } },
                {
                    $group: {
                        _id: "$productId",
                        totalBids: { $sum: 1 }
                    }
                }
            ]);


            bidCounts = bids.reduce((acc, cur) => {
                acc[cur._id.toString()] = cur.totalBids;
                return acc;
            }, {});


        }

        const finalProducts = products.map(product => {
            const prod = { ...product };
            if (prod.saleType === "auction") {
                prod.totalBids = bidCounts[prod._id.toString()] || 0;
            }
            return prod;
        });


        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", {
            products: finalProducts,
            total: totalCount,
            pageNo: parseInt(pageNo),
            size: parseInt(size)
        });
    } catch (error) {
        console.error("Error in selectProductForAssociation:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};





//thread
router.post('/create', perApiLimiter(), upload.array('files', 10), addThread);
router.post('/updateThread/:id', perApiLimiter(), upload.array('files', 10), updateThread);
router.get('/delete/:id', perApiLimiter(), deleteThread);
router.post('/changeStatus/:id', perApiLimiter(), changeStatus);
router.post('/trending/:id', perApiLimiter(), trending);
router.post('/update-all-thread-trending', perApiLimiter(), updateAllThreadTrending);



//getFollowedUsersThreads
router.get('/getFollowedUsersThreads', perApiLimiter(), upload.none(), getFollowedUsersThreads);
router.get('/recentUser', perApiLimiter(), getRecentFollowedUsers);
router.get('/getDraftThreads', perApiLimiter(), getDraftThreads);



router.post('/getThreadByUserId', perApiLimiter(), getThreadByUserId);
router.post('/closeThread/:threadId', perApiLimiter(), closeThread);



//List api for the Home Screen // product controller
router.get('/getThreads', perApiLimiter(), upload.none(), getThreads);
router.get('/getThreads/:threadId', perApiLimiter(), upload.none(), getThreadById);
router.get('/selectProductForAssociation', perApiLimiter(), upload.none(), selectProductForAssociation);
router.get('/associatedProductByThreadId/:threadId', perApiLimiter(), upload.none(), associatedProductByThreadId);





//comment 
router.post('/addComment', perApiLimiter(), upload.array('files', 2), addComment);
router.get('/getThreadComments/:threadId', perApiLimiter(), getThreadComments);
router.get('/getCommentByParentId/:parentId', perApiLimiter(), upload.none(), getCommentByParentId);


module.exports = router;
