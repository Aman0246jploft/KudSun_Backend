const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { ProductReview, User, SellProduct, Category } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const mongoose = require('mongoose');

// Get all reviews with advanced filtering for admin
const getAdminReviews = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            sellerRatingMin = 0,
            sellerRatingMax = 5,
            buyerRatingMin = 0,
            buyerRatingMax = 5,
            categoryId = '',
            subCategoryId = '',
            username = '',
            raterRole = '', // 'buyer' or 'seller'
            rating = '', // specific rating 1-5
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Build aggregation pipeline
        let pipeline = [
            // Match non-deleted reviews
            {
                $match: {
                    isDeleted: false
                }
            },

            // Lookup reviewer info
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'reviewer',
                    pipeline: [
                        {
                            $project: {
                                userName: 1,
                                email: 1,
                                profileImage: 1,
                                averageRatting: 1,
                                averageBuyerRatting: 1,
                                totalRatingCount: 1,
                                totalBuyerRatingCount: 1
                            }
                        }
                    ]
                }
            },

            // Lookup reviewed user info
            {
                $lookup: {
                    from: 'User',
                    localField: 'otheruserId',
                    foreignField: '_id',
                    as: 'reviewedUser',
                    pipeline: [
                        {
                            $project: {
                                userName: 1,
                                email: 1,
                                profileImage: 1,
                                averageRatting: 1,
                                averageBuyerRatting: 1,
                                totalRatingCount: 1,
                                totalBuyerRatingCount: 1
                            }
                        }
                    ]
                }
            },

            // Lookup product info
            {
                $lookup: {
                    from: 'SellProduct',
                    localField: 'productId',
                    foreignField: '_id',
                    as: 'product',
                    pipeline: [
                        {
                            $project: {
                                title: 1,
                                productImages: 1,
                                categoryId: 1,
                                subCategoryId: 1,
                                fixedPrice: 1
                            }
                        }
                    ]
                }
            },

            // Lookup category info
            {
                $lookup: {
                    from: 'Category',
                    localField: 'product.categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },

            // Unwind arrays
            { $unwind: { path: '$reviewer', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$reviewedUser', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } }
        ];

        // Build match conditions for filtering
        let matchConditions = {};

        // Search filter (review text, product title, or usernames)
        if (search) {
            matchConditions.$or = [
                { reviewText: { $regex: search, $options: 'i' } },
                { 'product.title': { $regex: search, $options: 'i' } },
                { 'reviewer.userName': { $regex: search, $options: 'i' } },
                { 'reviewedUser.userName': { $regex: search, $options: 'i' } }
            ];
        }

        // Username filter
        if (username) {
            matchConditions.$or = [
                { 'reviewer.userName': { $regex: username, $options: 'i' } },
                { 'reviewedUser.userName': { $regex: username, $options: 'i' } }
            ];
        }

        // Rating filters
        if (rating) {
            matchConditions.rating = parseInt(rating);
        }

        // Rater role filter
        if (raterRole) {
            matchConditions.raterRole = raterRole;
        }

        // Category filter
        if (categoryId) {
            matchConditions['product.categoryId'] = toObjectId(categoryId);
        }

        // SubCategory filter
        if (subCategoryId) {
            matchConditions['product.subCategoryId'] = toObjectId(subCategoryId);
        }

        // Seller rating filter (for reviewed user when raterRole is buyer)
        if (sellerRatingMin > 0 || sellerRatingMax < 5) {
            matchConditions.$and = matchConditions.$and || [];
            matchConditions.$and.push({
                $or: [
                    {
                        $and: [
                            { raterRole: 'buyer' },
                            { 'reviewedUser.averageRatting': { $gte: parseFloat(sellerRatingMin) } },
                            { 'reviewedUser.averageRatting': { $lte: parseFloat(sellerRatingMax) } }
                        ]
                    },
                    { raterRole: 'seller' }
                ]
            });
        }

        // Buyer rating filter (for reviewed user when raterRole is seller)
        if (buyerRatingMin > 0 || buyerRatingMax < 5) {
            matchConditions.$and = matchConditions.$and || [];
            matchConditions.$and.push({
                $or: [
                    {
                        $and: [
                            { raterRole: 'seller' },
                            { 'reviewedUser.averageBuyerRatting': { $gte: parseFloat(buyerRatingMin) } },
                            { 'reviewedUser.averageBuyerRatting': { $lte: parseFloat(buyerRatingMax) } }
                        ]
                    },
                    { raterRole: 'buyer' }
                ]
            });
        }

        // Add match stage if we have conditions
        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }

        // Add sorting
        const sortStage = {};
        sortStage[sortBy] = sortOrder === 'desc' ? -1 : 1;
        pipeline.push({ $sort: sortStage });

        // Get total count
        const countPipeline = [...pipeline, { $count: "total" }];
        const countResult = await ProductReview.aggregate(countPipeline);
        const totalRecords = countResult.length > 0 ? countResult[0].total : 0;

        // Add pagination
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limitNum });

        // Execute aggregation
        const reviews = await ProductReview.aggregate(pipeline);

        // Calculate pagination info
        const totalPages = Math.ceil(totalRecords / limitNum);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Reviews fetched successfully", {
            reviews,
            pagination: {
                page: pageNum,
                limit: limitNum,
                totalRecords,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            filters: {
                search,
                sellerRatingMin,
                sellerRatingMax,
                buyerRatingMin,
                buyerRatingMax,
                categoryId,
                subCategoryId,
                username,
                raterRole,
                rating,
                sortBy,
                sortOrder
            }
        });

    } catch (err) {
        console.error("getAdminReviews error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch reviews");
    }
};

// Get single review details for admin
const getAdminReviewDetails = async (req, res) => {
    try {
        const { reviewId } = req.params;

        if (!reviewId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Review ID is required");
        }

        const review = await ProductReview.aggregate([
            {
                $match: {
                    _id: toObjectId(reviewId),
                    isDeleted: false
                }
            },

            // Lookup reviewer info with complete details
            {
                $lookup: {
                    from: 'User',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'reviewer',
                    pipeline: [
                        {
                            $project: {
                                userName: 1,
                                email: 1,
                                phoneNumber: 1,
                                profileImage: 1,
                                averageRatting: 1,
                                averageBuyerRatting: 1,
                                totalRatingCount: 1,
                                totalBuyerRatingCount: 1,
                                totalRatingSum: 1,
                                totalBuyerRatingSum: 1,
                                createdAt: 1,
                                is_Verified_Seller: 1,
                                is_Id_verified: 1
                            }
                        }
                    ]
                }
            },

            // Lookup reviewed user info with complete details
            {
                $lookup: {
                    from: 'User',
                    localField: 'otheruserId',
                    foreignField: '_id',
                    as: 'reviewedUser',
                    pipeline: [
                        {
                            $project: {
                                userName: 1,
                                email: 1,
                                phoneNumber: 1,
                                profileImage: 1,
                                averageRatting: 1,
                                averageBuyerRatting: 1,
                                totalRatingCount: 1,
                                totalBuyerRatingCount: 1,
                                totalRatingSum: 1,
                                totalBuyerRatingSum: 1,
                                createdAt: 1,
                                is_Verified_Seller: 1,
                                is_Id_verified: 1
                            }
                        }
                    ]
                }
            },

            // Lookup product info with complete details
            {
                $lookup: {
                    from: 'SellProduct',
                    localField: 'productId',
                    foreignField: '_id',
                    as: 'product',
                    pipeline: [
                        {
                            $lookup: {
                                from: 'Category',
                                localField: 'categoryId',
                                foreignField: '_id',
                                as: 'category'
                            }
                        },
                        {
                            $unwind: { path: '$category', preserveNullAndEmptyArrays: true }
                        },
                        {
                            $project: {
                                title: 1,
                                description: 1,
                                productImages: 1,
                                categoryId: 1,
                                subCategoryId: 1,
                                fixedPrice: 1,
                                saleType: 1,
                                condition: 1,
                                createdAt: 1,
                                'category.name': 1,
                                'category._id': 1
                            }
                        }
                    ]
                }
            },

            // Unwind arrays
            { $unwind: { path: '$reviewer', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$reviewedUser', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } }
        ]);

        if (!review || review.length === 0) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Review not found");
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Review details fetched successfully", review[0]);

    } catch (err) {
        console.error("getAdminReviewDetails error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch review details");
    }
};

// Delete review and recalculate ratings
const deleteAdminReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { reason = '' } = req.body;

        if (!reviewId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Review ID is required");
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Find the review first
            const review = await ProductReview.findOne({
                _id: reviewId,
                isDeleted: false
            }).session(session);

            if (!review) {
                await session.abortTransaction();
                return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Review not found");
            }

            // Mark review as deleted
            await ProductReview.findByIdAndUpdate(
                reviewId,
                {
                    isDeleted: true,
                    deletedAt: new Date(),
                    deletedReason: reason,
                    deletedBy: 'admin'
                },
                { session }
            );

            // Recalculate ratings for the reviewed user
            await recalculateUserRatings(review.otheruserId, review.raterRole, session);

            await session.commitTransaction();

            return apiSuccessRes(HTTP_STATUS.OK, res, "Review deleted successfully and ratings recalculated", {
                deletedReviewId: reviewId,
                affectedUserId: review.otheruserId,
                raterRole: review.raterRole
            });

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }

    } catch (err) {
        console.error("deleteAdminReview error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to delete review");
    }
};

// Helper function to recalculate user ratings
async function recalculateUserRatings(userId, raterRole, session) {
    try {
        if (raterRole === 'buyer') {
            // Recalculate seller ratings (buyers rate sellers)
            const sellerRatingStats = await ProductReview.aggregate([
                {
                    $match: {
                        otheruserId: userId,
                        raterRole: 'buyer',
                        isDeleted: false,
                        isDisable: false
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalRatingSum: { $sum: '$rating' },
                        totalRatingCount: { $sum: 1 },
                        averageRating: { $avg: '$rating' }
                    }
                }
            ]).session(session);

            const stats = sellerRatingStats[0] || {
                totalRatingSum: 0,
                totalRatingCount: 0,
                averageRating: 0
            };

            await User.findByIdAndUpdate(
                userId,
                {
                    totalRatingSum: stats.totalRatingSum,
                    totalRatingCount: stats.totalRatingCount,
                    averageRatting: Number(stats.averageRating.toFixed(2))
                },
                { session }
            );

        } else if (raterRole === 'seller') {
            // Recalculate buyer ratings (sellers rate buyers)
            const buyerRatingStats = await ProductReview.aggregate([
                {
                    $match: {
                        otheruserId: userId,
                        raterRole: 'seller',
                        isDeleted: false,
                        isDisable: false
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalBuyerRatingSum: { $sum: '$rating' },
                        totalBuyerRatingCount: { $sum: 1 },
                        averageBuyerRating: { $avg: '$rating' }
                    }
                }
            ]).session(session);

            const stats = buyerRatingStats[0] || {
                totalBuyerRatingSum: 0,
                totalBuyerRatingCount: 0,
                averageBuyerRating: 0
            };

            await User.findByIdAndUpdate(
                userId,
                {
                    totalBuyerRatingSum: stats.totalBuyerRatingSum,
                    totalBuyerRatingCount: stats.totalBuyerRatingCount,
                    averageBuyerRatting: Number(stats.averageBuyerRating.toFixed(2))
                },
                { session }
            );

            console.log(`✅ Buyer ratings recalculated for user ${userId}: ${stats.averageBuyerRating.toFixed(2)} (${stats.totalBuyerRatingCount} reviews)`);
        }

    } catch (error) {
        console.error('Error recalculating user ratings:', error);
        throw error;
    }
}

// Get filter options for dropdowns
const getReviewFilterOptions = async (req, res) => {
    try {
        // Get categories
        const categories = await Category.find({
            isDeleted: false,
            isDisable: false
        }).select('name _id').sort({ name: 1 });

        // Get rating distribution
        const ratingDistribution = await ProductReview.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: '$rating',
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Get rater role distribution
        const raterRoleDistribution = await ProductReview.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: '$raterRole',
                    count: { $sum: 1 }
                }
            }
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Filter options fetched successfully", {
            categories,
            ratingDistribution,
            raterRoleDistribution,
            ratingOptions: [
                { value: 1, label: '1 Star' },
                { value: 2, label: '2 Stars' },
                { value: 3, label: '3 Stars' },
                { value: 4, label: '4 Stars' },
                { value: 5, label: '5 Stars' }
            ]
        });

    } catch (err) {
        console.error("getReviewFilterOptions error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch filter options");
    }
};

// Routes
router.get('/admin/reviews', perApiLimiter(), upload.none(), getAdminReviews);
router.get('/admin/reviews/:reviewId', perApiLimiter(), upload.none(), getAdminReviewDetails);
router.delete('/admin/reviews/:reviewId', perApiLimiter(), upload.none(), deleteAdminReview);
router.get('/admin/reviews-filter-options', perApiLimiter(), upload.none(), getReviewFilterOptions);

module.exports = router; 