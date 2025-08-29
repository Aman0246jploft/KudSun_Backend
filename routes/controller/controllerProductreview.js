const express = require("express");
const multer = require("multer");
const upload = multer();
const router = express.Router();
const {
  ProductReview,
  Order,
  SellProduct,
  User,
  ChatRoom,
  ChatMessage,
} = require("../../db");
const validateRequest = require("../../middlewares/validateRequest");
const perApiLimiter = require("../../middlewares/rateLimiter");
const {
  createReviewValidation,
} = require("../services/validations/moduleProductReview");
const {
  apiSuccessRes,
  apiErrorRes,
  toObjectId,
} = require("../../utils/globalFunction");
const HTTP_STATUS = require("../../utils/statusCode");
const { uploadImageCloudinary } = require("../../utils/cloudinary");
const {
  ORDER_STATUS,
  NOTIFICATION_TYPES,
  createStandardizedChatMeta,
  createStandardizedNotificationMeta,
} = require("../../utils/Role");
const { findOrCreateOneOnOneRoom } = require("../services/serviceChat");
const { saveNotification } = require("../services/serviceNotification");

const emitSystemMessage = async (
  io,
  systemMessage,
  room,
  buyerId,
  sellerId
) => {
  if (!io) return;

  // Emit the new message to the room
  const messageWithRoom = {
    ...systemMessage.toObject(),
    chatRoom: room._id,
  };
  io.to(room._id.toString()).emit("newMessage", messageWithRoom);

  // Update chat room for both users
  const roomObj = await ChatRoom.findById(room._id)
    .populate("participants", "userName profileImage")
    .populate("lastMessage");

  // For buyer
  io.to(`user_${buyerId}`).emit("roomUpdated", {
    ...roomObj.toObject(),
    participants: roomObj.participants.filter(
      (p) => p._id.toString() !== buyerId.toString()
    ),
    unreadCount: 0,
  });

  // For seller
  io.to(`user_${sellerId}`).emit("roomUpdated", {
    ...roomObj.toObject(),
    participants: roomObj.participants.filter(
      (p) => p._id.toString() !== sellerId.toString()
    ),
    unreadCount: 1,
  });

  // Also emit a specific system notification event
  io.to(`user_${buyerId}`).emit("systemNotification", {
    type: systemMessage.messageType,
    meta: systemMessage.systemMeta,
  });
  io.to(`user_${sellerId}`).emit("systemNotification", {
    type: systemMessage.messageType,
    meta: systemMessage.systemMeta,
  });
};

const createOrUpdateReview = async (req, res) => {
  try {
    const { productId, rating, ratingText, reviewText } = req.body;
    const userId = req.user.userId;
    const raterUser = await User.findById(userId).lean();

    // 2. Find order where user is buyer or seller for this product and order is completed
    const order = await Order.findOne({
      $or: [
        { userId, "items.productId": productId },
        { sellerId: userId, "items.productId": productId },
      ],
      // status: ORDER_||ORDER_STATUS.CONFIRM_RECEIPT
    }).lean();

    if (!order) {
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        "You can only review products related to your completed orders."
      );
    }

    // 3. Determine raterRole based on user role in order
    let raterRole;
    if (order.userId.toString() === userId) {
      raterRole = "buyer"; // buyer rates seller
    } else if (order.sellerId.toString() === userId) {
      raterRole = "seller"; // seller rates buyer
    } else {
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        "You are not authorized to rate this product/order."
      );
    }
    const recipientId = raterRole === "buyer" ? order.sellerId : order.userId;
    const recipientUser = await User.findById(recipientId).lean();
    // 4. Upload images if any
    let reviewImages = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const imageUrl = await uploadImageCloudinary(file, "review-images");
        if (imageUrl) reviewImages.push(imageUrl);
      }
    }

    // 5. Find existing review by this user on this product & role
    let review = await ProductReview.findOne({ userId, productId, raterRole });
    let oldRating = 0;
    let isNewReview = false;
    const otheruserId = raterRole === "buyer" ? order.sellerId : order.userId;

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
        otheruserId,
        productId,
        raterRole,
        rating,
        ratingText,
        reviewText,
        reviewImages,
      });
    }

    // 6. Update User rating sums and averages on the other party
    if (raterRole === "buyer") {
      // buyer rates seller → update seller
      const seller = await User.findById(order.sellerId);
      if (!seller) throw new Error("Seller not found");

      if (isNewReview) {
        // seller.totalRatingSum += rating;
        // seller.totalRatingCount += 1;

        seller.totalRatingSum = Number(seller.totalRatingSum) + Number(rating);
        seller.totalRatingCount = Number(seller.totalRatingCount) + 1;
      } else {
        // seller.totalRatingSum = seller.totalRatingSum - oldRating + rating;
        seller.totalRatingSum =
          Number(seller.totalRatingSum) - Number(oldRating) + Number(rating);
        // totalRatingCount stays the same
      }
      // seller.averageRatting = seller.totalRatingCount > 0 ? seller.totalRatingSum / seller.totalRatingCount : 0;
      //   seller.averageRatting =
      //     seller.totalRatingCount > 0
      //       ? parseFloat(
      //           (seller.totalRatingSum / seller.totalRatingCount).toFixed(2)
      //         )
      //       : 0;

      seller.averageRatting =
        Number(seller.totalRatingCount) > 0
          ? Number(
              (
                Number(seller.totalRatingSum) / Number(seller.totalRatingCount)
              ).toFixed(2)
            )
          : 0;

      await seller.save();
    } else if (raterRole === "seller") {
      // seller rates buyer → update buyer
      const buyer = await User.findById(order.userId);
      if (!buyer) throw new Error("Buyer not found");

      if (isNewReview) {
        // buyer.totalBuyerRatingSum += rating;
        // buyer.totalBuyerRatingCount += 1;
        buyer.totalBuyerRatingSum =
          Number(buyer.totalBuyerRatingSum) + Number(rating);
        buyer.totalBuyerRatingCount = Number(buyer.totalBuyerRatingCount) + 1;
      } else {
        // buyer.totalBuyerRatingSum =
        //   buyer.totalBuyerRatingSum - oldRating + rating;
        buyer.totalBuyerRatingSum =
          Number(buyer.totalBuyerRatingSum) -
          Number(oldRating) +
          Number(rating);
        // totalBuyerRatingCount stays the same
      }
      //   buyer.averageBuyerRatting =
      //     buyer.totalBuyerRatingCount > 0
      //       ? buyer.totalBuyerRatingSum / buyer.totalBuyerRatingCount
      //       : 0;
      //   await buyer.save();
      buyer.averageBuyerRatting =
        Number(buyer.totalBuyerRatingCount) > 0
          ? Number(
              (
                Number(buyer.totalBuyerRatingSum) /
                Number(buyer.totalBuyerRatingCount)
              ).toFixed(2)
            )
          : 0;

      await buyer.save();
    }

    // 7. Create chat room and system message for review submission
    const { room } = await findOrCreateOneOnOneRoom(
      order.userId,
      order.sellerId
    );

    // Determine message content based on who submitted the review
    let messageTitle = "";
    let messageContent = "";
    let raterName = "";

    if (raterRole === "buyer") {
      messageTitle = "Buyer Review Submitted";
      messageContent = `The buyer has ${
        isNewReview ? "submitted" : "updated"
      } a review for this order. Rating: ${rating}/5 stars.`;
      raterName = "buyer";
    } else {
      messageTitle = "Seller Review Submitted";
      messageContent = `The seller has ${
        isNewReview ? "submitted" : "updated"
      } a review for this order. Rating: ${rating}/5 stars.`;
      raterName = "seller";
    }

    // Create system message for review submission
    const reviewMessage = new ChatMessage({
      chatRoom: room._id,
      messageType: "TEXT",
      systemMeta: {
        statusType: "REVIEW",
        status: "SUBMITTED",
        orderId: order._id,
        productId: productId,
        title: messageTitle,
        meta: createStandardizedChatMeta({
          orderNumber: order.orderId.toString(),
          rating: rating,
          ratingText: ratingText,
          reviewText: reviewText,
          raterRole: raterRole,
          raterName: raterName,
          isNewReview: isNewReview,
          sellerId: order.sellerId,
          buyerId: order.userId,
          orderStatus: order.status,
        }),
        actions: [
          {
            label: "View Review",
            url: `/review/${review._id}`,
            type: "primary",
          },
          {
            label: "View Order",
            url: `/order/${order._id}`,
            type: "secondary",
          },
        ],
        theme: "success",
        content: messageContent,
      },
    });

    // await reviewMessage.save();

    // Update chat room's last message
    // await ChatRoom.findByIdAndUpdate(
    //     room._id,
    //     {
    //         lastMessage: reviewMessage._id,
    //         updatedAt: new Date()
    //     }
    // );

    // Emit system message
    const io = req.app.get("io");
    await emitSystemMessage(
      io,
      reviewMessage,
      room,
      order.userId,
      order.sellerId
    );
    const userName =
      raterUser?.userName || raterUser?.name || raterUser?.fullName || "User";
    // Send notifications about review submission
    const reviewNotifications = [];

    if (raterRole === "buyer") {
      // Notify seller about buyer's review
      reviewNotifications.push({
        recipientId: order.sellerId,
        userId: order.userId,
        orderId: order._id,
        reviewId: review._id,
        productId: productId,
        type: NOTIFICATION_TYPES.REVIEW,
        title: "reviewed your Item",
        message: `${rating}-star review: "${
          reviewText || ratingText || "No comment"
        }"`,
        meta: createStandardizedNotificationMeta({
          orderNumber: order._id.toString(),
          reviewId: review._id.toString(),
          rating: rating,
          userName: userName || null,
          reviewText: reviewText,
          raterRole: raterRole,
          isNewReview: isNewReview,
          sellerId: order.sellerId,
          buyerId: order.userId,
          userImage: raterUser?.profileImage || null,
        }),
        redirectUrl: `/review/${review._id}`,
      });
    } else {
      // Notify buyer about seller's review
      reviewNotifications.push({
        recipientId: order.userId,
        userId: order.sellerId,
        orderId: order._id,
        reviewId: review._id,
        productId: productId,
        type: NOTIFICATION_TYPES.REVIEW,
        title: "review received!",
        message: `${rating}-star review: "${
          reviewText || ratingText || "No comment"
        }"`,
        meta: createStandardizedNotificationMeta({
          orderNumber: order._id.toString(),
          reviewId: review._id.toString(),
          rating: rating,
          reviewText: reviewText,
          raterRole: raterRole,
          isNewReview: isNewReview,
          sellerId: order.sellerId,
          userName: userName || null,
          buyerId: order.userId,
          userImage: raterUser?.profileImage || null,
        }),
        redirectUrl: `/review/${review._id}`,
      });
    }

    if (
      reviewNotifications.length > 0 &&
      recipientUser.alertNotification !== false
    ) {
      // await saveNotification(reviewNotifications);
    }

    return apiSuccessRes(HTTP_STATUS.OK, res, "Review saved successfully", {
      review,
    });
  } catch (err) {
    console.error("Create/Update Review Error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getUserReviews = async (req, res) => {
  try {
    const { userId } = req.query;
    const currentUserId = req.user.userId;

    // If no userId provided, use current user's ID
    const targetUserId = userId || currentUserId;

    // Parse pagination params
    const pageNo = parseInt(req.query.pageNo) || 1;
    const size = parseInt(req.query.size) || 10;
    const skip = (pageNo - 1) * size;

    // Count total reviews written by this user
    const totalReviews = await ProductReview.countDocuments({
      userId: targetUserId,
      isDeleted: false,
      isDisable: false,
    });

    // Fetch paginated reviews written by this user
    const reviews = await ProductReview.find({
      userId: targetUserId,
      isDeleted: false,
      isDisable: false,
    })
      .skip(skip)
      .limit(size)
      .populate({
        path: "productId",
        select: "_id title description productImages fixedPrice saleType",
        match: { isDeleted: false, isDisable: false },
      })
      .populate({
        path: "userId",
        select: "userName profileImage provinceId districtId ",
        populate: [
          { path: "provinceId", select: "value" },
          { path: "districtId", select: "value" },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out reviews where product is deleted/disabled
    const filteredReviews = reviews.filter(
      (review) => review.productId !== null
    );

    // Format response
    const formattedReviews = filteredReviews.map((review) => ({
      _id: review._id,
      rating: review.rating,
      ratingText: review.ratingText,
      reviewText: review.reviewText,
      reviewImages: review.reviewImages,
      raterRole: review.raterRole, // 'buyer' or 'seller'
      product: {
        _id: review.productId._id,
        title: review.productId.title,
        description: review.productId.description,
        price: review.productId.fixedPrice,
        saleType: review.productId.saleType,
        images: review.productId.productImages,
      },
      reviewer: {
        _id: review.userId._id,
        name: review.userId.userName,
        image: review.userId.profileImage,
        location: {
          province: review.userId.provinceId?.value,
          district: review.userId.districtId?.value,
        },
      },
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }));

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "User reviews fetched successfully",
      {
        pageNo,
        size,
        total: totalReviews,
        reviews: formattedReviews,
      }
    );
  } catch (err) {
    console.error("Get User Reviews Error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getReviewsAboutUser = async (req, res) => {
  try {
    const userId = req.query.userId || req.user.userId;

    // Parse pagination params
    const pageNo = parseInt(req.query.pageNo) || 1;
    const size = parseInt(req.query.size) || 10;
    const skip = (pageNo - 1) * size;

    // First, find all products by this user
    const userProducts = await SellProduct.find({
      userId: userId,
      isDeleted: false,
      isDisable: false,
    })
      .select("_id")
      .lean();

    const productIds = userProducts.map((product) => product._id);

    // Count total reviews about this user's products
    const totalReviews = await ProductReview.countDocuments({
      productId: { $in: productIds },
      isDeleted: false,
      isDisable: false,
    });

    // Fetch paginated reviews about this user's products
    const reviews = await ProductReview.find({
      productId: { $in: productIds },
      isDeleted: false,
      isDisable: false,
    })
      .skip(skip)
      .limit(size)
      .populate({
        path: "productId",
        select: "_id title description productImages fixedPrice saleType",
        match: { isDeleted: false, isDisable: false },
      })
      .populate({
        path: "userId",
        select:
          "userName profileImage provinceId districtId  isLive is_Id_verified is_Verified_Seller is_Preferred_seller averageRatting",
        populate: [
          { path: "provinceId", select: "value" },
          { path: "districtId", select: "value" },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out reviews where product is deleted/disabled
    const filteredReviews = reviews.filter(
      (review) => review.productId !== null
    );

    // Format response
    const formattedReviews = filteredReviews.map((review) => ({
      _id: review._id,
      rating: review.rating,
      ratingText: review.ratingText,
      reviewText: review.reviewText,
      reviewImages: review.reviewImages,
      raterRole: review.raterRole, // 'buyer' or 'seller'
      product: {
        _id: review.productId._id,
        title: review.productId.title,
        description: review.productId.description,
        price: review.productId.fixedPrice,
        saleType: review.productId.saleType,
        images: review.productId.productImages,
      },
      reviewer: {
        _id: review.userId._id,
        name: review.userId.userName,
        image: review.userId.profileImage,
        location: {
          province: review.userId.provinceId?.value,
          district: review.userId.districtId?.value,
        },
      },
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }));

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Reviews about user fetched successfully",
      {
        pageNo,
        size,
        total: totalReviews,
        reviews: formattedReviews,
      }
    );
  } catch (err) {
    console.error("Get Reviews About User Error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getReviewersList = async (req, res) => {
  try {
    const userId = req.query.userId || req.user.userId;

    // Parse pagination params
    const pageNo = parseInt(req.query.pageNo) || 1;
    const size = parseInt(req.query.size) || 10;
    const skip = (pageNo - 1) * size;

    // First, find all products by this user
    const userProducts = await SellProduct.find({
      userId: userId,
      isDeleted: false,
      isDisable: false,
    })
      .select("_id")
      .lean();

    // const productIds = userProducts.map(product => product._id);

    // Get unique reviewers who have reviewed this user's products with their reviews
    const reviewersAggregation = await ProductReview.aggregate([
      {
        $match: {
          // productId: { $in: productIds },
          isDeleted: false,
          isDisable: false,
          otheruserId: toObjectId(userId), // Add this line
        },
      },
      {
        $lookup: {
          from: "SellProduct",
          localField: "productId",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      {
        $unwind: "$productDetails",
      },
      {
        $group: {
          _id: "$userId",
          totalReviews: { $sum: 1 },
          averageRating: { $avg: "$rating" },
          lastReviewDate: { $max: "$createdAt" },
          raterRoles: { $addToSet: "$raterRole" },
          reviews: {
            $push: {
              _id: "$_id",
              rating: "$rating",
              ratingText: "$ratingText",
              reviewText: "$reviewText",
              reviewImages: "$reviewImages",
              raterRole: "$raterRole",
              createdAt: "$createdAt",
              updatedAt: "$updatedAt",
              product: {
                _id: "$productDetails._id",
                title: "$productDetails.title",
                description: "$productDetails.description",
                fixedPrice: "$productDetails.fixedPrice",
                saleType: "$productDetails.saleType",
                productImages: "$productDetails.productImages",
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "User",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      {
        $unwind: "$userDetails",
      },
      {
        $lookup: {
          from: "Location",
          localField: "userDetails.provinceId",
          foreignField: "_id",
          as: "province",
        },
      },
      {
        $lookup: {
          from: "Location",
          localField: "userDetails.districtId",
          foreignField: "_id",
          as: "district",
        },
      },
      {
        $project: {
          _id: 1,
          totalReviews: 1,
          averageRating: { $round: ["$averageRating", 1] },
          lastReviewDate: 1,
          raterRoles: 1,
          reviews: {
            $sortArray: {
              input: "$reviews",
              sortBy: { createdAt: -1 },
            },
          },
          reviewer: {
            _id: "$userDetails._id",
            userName: "$userDetails.userName",
            profileImage: "$userDetails.profileImage",
            isLive: "$userDetails.isLive",
            is_Id_verified: "$userDetails.is_Id_verified",
            is_Verified_Seller: "$userDetails.is_Verified_Seller",
            averageRatting: "$userDetails.averageRatting",
            location: {
              province: { $arrayElemAt: ["$province.value", 0] },
              district: { $arrayElemAt: ["$district.value", 0] },
            },
          },
        },
      },
      {
        $sort: { lastReviewDate: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: size,
      },
    ]);

    // Count total unique reviewers
    const totalReviewersCount = await ProductReview.aggregate([
      {
        $match: {
          otheruserId: toObjectId(userId), // Add this line
          // productId: { $in: productIds },
          isDeleted: false,
          isDisable: false,
        },
      },
      {
        $group: {
          _id: "$userId",
        },
      },
      {
        $count: "total",
      },
    ]);

    const totalReviewers =
      totalReviewersCount.length > 0 ? totalReviewersCount[0].total : 0;

    // Format response
    const formattedReviewers = reviewersAggregation.map((item) => ({
      reviewer: item.reviewer,
      // reviewStats: {
      //     totalReviews: item.totalReviews,
      //     averageRating: item.averageRating,
      //     lastReviewDate: item.lastReviewDate,
      //     raterRoles: item.raterRoles // ['buyer', 'seller'] - shows what roles this user has reviewed as
      // },
      reviews: item?.reviews && item?.reviews[0],
      // .map(review => ({
      //     _id: review._id,
      //     rating: review.rating,
      //     ratingText: review.ratingText,
      //     reviewText: review.reviewText,
      //     reviewImages: review.reviewImages,
      //     raterRole: review.raterRole,
      //     createdAt: review.createdAt,
      //     updatedAt: review.updatedAt,
      //     product: {
      //         _id: review.product._id,
      //         title: review.product.title,
      //         description: review.product.description,
      //         price: review.product.fixedPrice,
      //         saleType: review.product.saleType,
      //         images: review.product.productImages
      //     }
      // }))
    }));

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Reviewers list fetched successfully",
      {
        pageNo,
        size,
        total: totalReviewers,
        reviewers: formattedReviewers,
      }
    );
  } catch (err) {
    console.error("Get Reviewers List Error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Product ID is required"
      );
    }

    // Parse pagination params
    const pageNo = parseInt(req.query.pageNo) || 1;
    const size = parseInt(req.query.size) || 10;
    const skip = (pageNo - 1) * size;

    // Parse filter params
    const {
      raterRole,
      rating,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build match conditions
    const matchConditions = {
      productId: toObjectId(productId),
      isDeleted: false,
      isDisable: false,
    };

    if (raterRole) {
      matchConditions.raterRole = raterRole; // 'buyer' or 'seller'
    }

    if (rating) {
      matchConditions.rating = parseInt(rating);
    }

    // Build sort conditions
    const sortConditions = {};
    sortConditions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Count total reviews for this product
    const totalReviews = await ProductReview.countDocuments(matchConditions);

    // Get product details first
    const product = await SellProduct.findOne({
      _id: productId,
      isDeleted: false,
      isDisable: false,
    })
      .populate({
        path: "userId",
        select:
          "userName profileImage isSold provinceId districtId averageRatting is_Preferred_seller is_Id_verified is_Verified_Seller",
        populate: [
          { path: "provinceId", select: "value" },
          { path: "districtId", select: "value" },
        ],
      })
      .populate("categoryId", "name")
      .populate("subCategoryId", "name")
      .lean();

    if (!product) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Product not found");
    }

    // Fetch paginated reviews for this product
    const reviews = await ProductReview.find(matchConditions)
      .skip(skip)
      .limit(size)
      .populate({
        path: "userId",
        select:
          "userName profileImage provinceId districtId isLive is_Id_verified is_Verified_Seller is_Preferred_seller averageRatting averageBuyerRatting totalRatingCount totalBuyerRatingCount",
        populate: [
          { path: "provinceId", select: "value" },
          { path: "districtId", select: "value" },
        ],
      })
      .populate({
        path: "otheruserId",
        select:
          "userName profileImage provinceId districtId isLive is_Id_verified is_Verified_Seller is_Preferred_seller averageRatting averageBuyerRatting",
        populate: [
          { path: "provinceId", select: "value" },
          { path: "districtId", select: "value" },
        ],
      })

      .sort(sortConditions)
      .lean();

    // Step 1: Collect productIds and reviewerIds from reviews
    const productIds = reviews.map((r) => r.productId);
    const buyerIds = reviews
      .filter((r) => r.raterRole === "buyer")
      .map((r) => r.userId._id);
    const sellerIds = reviews
      .filter((r) => r.raterRole === "seller")
      .map((r) => r.userId._id);

    // Step 2: Fetch relevant orders at once
    const orders = await Order.find({
      isDeleted: false,
      isDisable: false,
      $or: [{ userId: { $in: buyerIds } }, { sellerId: { $in: sellerIds } }],
      "items.productId": { $in: productIds },
    })
      .populate([
        {
          path: "userId",
          select:
            "userName profileImage is_Preferred_seller is_Id_verified is_Verified_Seller",
        },
        {
          path: "sellerId",
          select:
            "userName profileImage is_Preferred_seller is_Id_verified is_Verified_Seller",
        },
        { path: "addressId", select: "street city provinceId districtId" },
      ])
      .lean();

    // Step 3: Map orders to the product (choose first relevant order for this product)
    let fullOrder = null;
    for (let review of reviews) {
      const order = orders.find((o) => {
        const hasProduct = o.items.some(
          (item) => item.productId.toString() === review.productId.toString()
        );
        if (!hasProduct) return false;

        if (review.raterRole === "buyer")
          return o.userId._id.toString() === review.userId._id.toString();
        if (review.raterRole === "seller")
          return o.sellerId._id.toString() === review.userId._id.toString();
        return false;
      });

      if (order) {
        fullOrder = order; // pick the first matching order
        break; // optional: stop after first match if you just need one
      }
    }

    // Calculate review statistics
    const reviewStats = await ProductReview.aggregate([
      {
        $match: {
          productId: toObjectId(productId),
          isDeleted: false,
          isDisable: false,
        },
      },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: "$rating" },
          buyerReviews: {
            $sum: { $cond: [{ $eq: ["$raterRole", "buyer"] }, 1, 0] },
          },
          sellerReviews: {
            $sum: { $cond: [{ $eq: ["$raterRole", "seller"] }, 1, 0] },
          },
          ratingDistribution: {
            $push: "$rating",
          },
        },
      },
    ]);

    // Calculate rating distribution
    let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (reviewStats.length > 0 && reviewStats[0].ratingDistribution) {
      reviewStats[0].ratingDistribution.forEach((rating) => {
        ratingDistribution[rating] = (ratingDistribution[rating] || 0) + 1;
      });
    }

    // Format response
    const formattedReviews = reviews.map((review) => ({
      _id: review._id,
      rating: review.rating,
      ratingText: review.ratingText,
      reviewText: review.reviewText,
      reviewImages: review.reviewImages || [],
      raterRole: review.raterRole, // 'buyer' or 'seller'
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,

      reviewer: {
        _id: review.userId._id,
        userName: review.userId.userName,
        profileImage: review.userId.profileImage,
        isLive: review.userId.isLive,
        is_Id_verified: review.userId.is_Id_verified,
        is_Verified_Seller: review.userId.is_Verified_Seller,
        is_Preferred_seller: review.userId.is_Preferred_seller,
        averageRating:
          review.raterRole === "seller"
            ? review.userId.averageRatting
            : review.userId.averageBuyerRatting,
        totalRatings:
          review.raterRole === "seller"
            ? review.userId.totalRatingCount
            : review.userId.totalBuyerRatingCount,
        location: {
          province: review.userId.provinceId?.value,
          district: review.userId.districtId?.value,
        },
      },
      // otherUser: review.otheruserId ? {
      //     _id: review.otheruserId._id,
      //     userName: review.otheruserId.userName,
      //     profileImage: review.otheruserId.profileImage,
      //     isLive: review.otheruserId.isLive,
      //     is_Id_verified: review.otheruserId.is_Id_verified,
      //     is_Verified_Seller: review.otheruserId.is_Verified_Seller,
      //     averageRating: review.otheruserId.averageRatting,
      //     averageBuyerRating: review.otheruserId.averageBuyerRatting,
      //     location: {
      //         province: review.otheruserId.provinceId?.value,
      //         district: review.otheruserId.districtId?.value
      //     }
      // } : null
    }));

    // Format product details
    const productDetails = {
      _id: product._id,
      title: product.title,
      description: product.description,
      productImages: product.productImages || [],
      fixedPrice: product.fixedPrice,
      auctionStartPrice: product.auctionStartPrice,
      saleType: product.saleType,
      condition: product.condition,
      category: product.categoryId?.name,
      subCategory: product.subCategoryId?.name,
      createdAt: product.createdAt,
      isSold: product.isSold,
      seller: {
        _id: product.userId._id,
        userName: product.userId.userName,
        profileImage: product.userId.profileImage,
        averageRating: product.userId.averageRatting,
        is_Verified_Seller: product.userId.is_Verified_Seller,
        is_Id_verified: product.userId.is_Id_verified,
        is_Preferred_seller: product.userId.is_Preferred_seller,

        location: {
          province: product.userId.provinceId?.value,
          district: product.userId.districtId?.value,
        },
      },
    };

    const stats =
      reviewStats.length > 0
        ? reviewStats[0]
        : {
            totalReviews: 0,
            averageRating: 0,
            buyerReviews: 0,
            sellerReviews: 0,
          };

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Product reviews fetched successfully",
      {
        product: productDetails,
        // reviewStats: {
        //     totalReviews: stats.totalReviews,
        //     averageRating: Math.round(stats.averageRating * 10) / 10 || 0,
        //     buyerReviews: stats.buyerReviews,
        //     sellerReviews: stats.sellerReviews,
        //     ratingDistribution
        // },
        // pagination: {
        //     pageNo,
        //     size,
        //     total: totalReviews,
        //     totalPages: Math.ceil(totalReviews / size)
        // },
        reviews: formattedReviews,
        order: fullOrder || null,
      }
    );
  } catch (err) {
    console.error("Get Product Reviews Error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

router.post(
  "/review",
  perApiLimiter(),
  upload.array("reviewImages", 3),
  createOrUpdateReview
);
router.get("/user-reviews", perApiLimiter(), getUserReviews);
// router.get('/reviews-about-user', perApiLimiter(), getReviewsAboutUser);
router.get("/reviewers-list", perApiLimiter(), getReviewersList);
router.get("/:productId/reviews", perApiLimiter(), getProductReviews);

module.exports = router;
