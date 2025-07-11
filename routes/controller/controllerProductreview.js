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


const createOrUpdateReview = async (req, res) => {
    try {
        const { productId, rating, ratingText, reviewText } = req.body;
        const userId = req.user.userId;

        // 2. Find order where user is buyer or seller for this product and order is completed
        const order = await Order.findOne({
            $or: [
                { userId, 'items.productId': productId },
                { sellerId: userId, 'items.productId': productId }
            ],
            status: ORDER_STATUS.CONFIRM_RECEIPT
        }).lean();

        if (!order) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, 'You can only review products related to your completed orders.');
        }

        // 3. Determine raterRole based on user role in order
        let raterRole;
        if (order.userId.toString() === userId) {
            raterRole = 'buyer';  // buyer rates seller
        } else if (order.sellerId.toString() === userId) {
            raterRole = 'seller'; // seller rates buyer
        } else {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, 'You are not authorized to rate this product/order.');
        }

        // 4. Upload images if any
        let reviewImages = [];
        if (req.files?.length) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'review-images');
                if (imageUrl) reviewImages.push(imageUrl);
            }
        }

        // 5. Find existing review by this user on this product & role
        let review = await ProductReview.findOne({ userId, productId, raterRole });
        let oldRating = 0;
        let isNewReview = false;

        if (review) {
            // Update existing review
            oldRating = review.rating;

            review.rating = rating;
            review.ratingText = ratingText;
            review.reviewText = reviewText;
            if (reviewImages.length) review.reviewImages = reviewImages;
            await review.save();
        } else {
            isNewReview = true;
            // Create new review
            review = await ProductReview.create({
                userId,
                productId,
                raterRole,
                rating,
                ratingText,
                reviewText,
                reviewImages
            });
        }

        // 6. Update User rating sums and averages on the other party
        if (raterRole === 'buyer') {
            // buyer rates seller → update seller
            const seller = await User.findById(order.sellerId);
            if (!seller) throw new Error('Seller not found');

            if (isNewReview) {
                seller.totalRatingSum += rating;
                seller.totalRatingCount += 1;
            } else {
                seller.totalRatingSum = seller.totalRatingSum - oldRating + rating;
                // totalRatingCount stays the same
            }
            seller.averageRatting = seller.totalRatingCount > 0 ? seller.totalRatingSum / seller.totalRatingCount : 0;
            await seller.save();

        } else if (raterRole === 'seller') {
            // seller rates buyer → update buyer
            const buyer = await User.findById(order.userId);
            if (!buyer) throw new Error('Buyer not found');

            if (isNewReview) {
                buyer.totalBuyerRatingSum += rating;
                buyer.totalBuyerRatingCount += 1;
            } else {
                buyer.totalBuyerRatingSum = buyer.totalBuyerRatingSum - oldRating + rating;
                // totalBuyerRatingCount stays the same
            }
            buyer.averageBuyerRatting = buyer.totalBuyerRatingCount > 0 ? buyer.totalBuyerRatingSum / buyer.totalBuyerRatingCount : 0;
            await buyer.save();
        }


        return apiSuccessRes(HTTP_STATUS.OK, res, 'Review saved successfully', { review });

    } catch (err) {
        console.error('Create/Update Review Error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};


router.post('/review', perApiLimiter(), upload.array('reviewImages', 3), validateRequest(createReviewValidation), createOrUpdateReview);

module.exports = router;
