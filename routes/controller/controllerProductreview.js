const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { ProductReview, Order, SellProduct, User } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { createReviewValidation } = require('../services/validations/moduleProductReview');
const { apiSuccessRes, apiErrorRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { ORDER_STATUS } = require('../../utils/Role');

// Helper to update seller's averageRatting
async function updateSellerAverageRatingByProduct(productId) {
    const product = await SellProduct.findById(productId).lean();
    if (!product) return;
    const sellerId = product.userId;
    const products = await SellProduct.find({ userId: sellerId, isDeleted: false }).select('_id').lean();
    const productIds = products.map(p => p._id);
    if (productIds.length === 0) {
        await User.findByIdAndUpdate(sellerId, { averageRatting: 0 });
        return;
    }
    const reviews = await ProductReview.find({
        productId: { $in: productIds },
        isDeleted: false,
        isDisable: false
    }).select('rating').lean();
    const totalRatings = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
    const avg = reviews.length ? (totalRatings / reviews.length) : 0;
    await User.findByIdAndUpdate(sellerId, { averageRatting: avg });

}

const createOrUpdateReview = async (req, res) => {
    try {
        const { productId, rating, ratingText, reviewText } = req.body;
        const userId = req.user.userId;

        const { error } = createReviewValidation.validate({ productId, rating, ratingText, reviewText });
        if (error) return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);

        const hasOrdered = await Order.exists({
            userId: toObjectId(userId),
            'items.productId': toObjectId(productId),
            status: ORDER_STATUS.CONFIRM_RECEIPT  // Only allow if delivered
        });

        if (!hasOrdered) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, 'You can only review products you have purchased and received.');
        }

        let reviewImages = [];
        if (req.files?.length) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'review-images');
                if (imageUrl) reviewImages.push(imageUrl);
            }
        }

        // Check if user already reviewed this product
        let review = await ProductReview.findOne({ userId, productId });

        if (review) {
            // Update existing review
            review.rating = rating;
            review.ratingText = ratingText;
            review.reviewText = reviewText;
            if (reviewImages.length) {
                review.reviewImages = reviewImages;
            }
            await review.save();
            // Update seller's averageRatting
            await updateSellerAverageRatingByProduct(productId);
            return apiSuccessRes(HTTP_STATUS.OK, res, 'ProductReview updated successfully', { review });
        } else {
            // Create new review
            review = await ProductReview.create({
                userId,
                productId,
                rating,
                ratingText,
                reviewText,
                reviewImages
            });
            // Update seller's averageRatting
            await updateSellerAverageRatingByProduct(productId);
            return apiSuccessRes(HTTP_STATUS.CREATED, res, 'ProductReview created successfully', { review });
        }
    } catch (err) {
        console.error('Create/Update ProductReview Error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};

router.post('/review', perApiLimiter(), upload.array('reviewImages', 3), validateRequest(createReviewValidation), createOrUpdateReview);

module.exports = router;
