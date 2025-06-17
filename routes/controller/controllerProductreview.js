
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { ProductReview, Order } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { createReviewValidation } = require('../services/validations/moduleProductReview');
const { apiSuccessRes, apiErrorRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { ORDER_STATUS } = require('../../utils/Role');



const createOrUpdateReview = async (req, res) => {
    try {
        const { productId, rating, ratingText, reviewText } = req.body;
        const userId = req.user.userId;

        const { error } = createReviewValidation.validate({ productId, rating, ratingText, reviewText });
        if (error) return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);

        const hasOrdered = await Order.exists({
            userId: toObjectId(userId),
            'items.productId': toObjectId(productId),
            status: ORDER_STATUS.DELIVERED  // Only allow if delivered
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
            return apiSuccessRes(HTTP_STATUS.CREATED, res, 'ProductReview created successfully', { review });
        }
    } catch (err) {
        console.error('Create/Update ProductReview Error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};

router.post('/review', perApiLimiter(), upload.array('reviewImages', 3), validateRequest(createReviewValidation), createOrUpdateReview);


module.exports = router;
