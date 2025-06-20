
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { User, Follow, ThreadLike, ProductLike, SellProduct, Thread } = require('../../db');
const { getDocumentByQuery } = require('../services/serviceGlobalCURD');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const CONSTANTS = require('../../utils/constants')
const HTTP_STATUS = require('../../utils/statusCode');
const { apiErrorRes, verifyPassword, apiSuccessRes, generateOTP, generateKey, toObjectId } = require('../../utils/globalFunction');
const { signToken } = require('../../utils/jwtTokenUtils');
const { loginSchema, mobileLoginSchema, otpVerification, categorySchema, completeRegistrationSchema, saveEmailPasswords, followSchema, threadLikeSchema, productLikeSchema, requestResetOtpSchema, verifyResetOtpSchema, resetPasswordSchema, loginStepOneSchema, loginStepTwoSchema, loginStepThreeSchema, otpTokenSchema, resendResetOtpSchema } = require('../services/validations/userValidation');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { setKeyWithTime, setKeyNoTime, getKey, removeKey } = require('../services/serviceRedis');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { SALE_TYPE } = require('../../utils/Role');




const uploadfile = async (req, res) => {
    try {

        // ✅ Upload image if exists
        if (req.file) {
            const validImageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

            if (!validImageTypes.includes(req.file.mimetype)) {
            } else {
                const imageResult = await uploadImageCloudinary(req.file, 'profile-images');
                if (!imageResult) {
                    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Image upload failed");
                }
                profileImageUrl = imageResult;
            }
        }
        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, profileImageUrl);
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message,
            error.message
        );
    }
}


const requestOtp = async (req, res) => {
    try {
        const { phoneNumber, language } = req.body;
        const userExists = await User.findOne({ phoneNumber });

        if (userExists) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "Phone number already exists",
                null
            );
        }

        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
        const verifyToken = generateKey(); // This will act as the Redis key

        const redisValue = JSON.stringify({ otp, phoneNumber, language });

        // Store OTP + phoneNumber under the token key
        await setKeyWithTime(`verify:${verifyToken}`, redisValue, 5); // Expires in 5 mins

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent", { verifyToken });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, null);
    }
};


const verifyOtp = async (req, res) => {
    try {
        const { otp, verifyToken } = req.body;



        const redisData = await getKey(`verify:${verifyToken}`);

        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                "Verification token expired or invalid",
                null
            );
        }

        const { otp: storedOtp, phoneNumber, language } = JSON.parse(redisData.data);

        if (otp !== storedOtp) {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                "Invalid OTP",
                null
            );
        }

        // Mark phone as verified for next step
        await setKeyWithTime(`verified:${phoneNumber}`, 'true', 10);
        await setKeyWithTime(`verified:${phoneNumber}language`, language);
        await removeKey(`verify:${verifyToken}`);

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "OTP verified successfully",
            { phoneNumber }
        );
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message,
            null
        );
    }
};


const saveEmailPassword = async (req, res) => {
    try {
        const { phoneNumber, email, password } = await req.body

        // ✅ Check if phone was verified via OTP
        const isVerified = await getKey(`verified:${phoneNumber}`);
        const language = await getKey(`verified:${phoneNumber}language`);
        if (isVerified.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number not verified");
        }


        // ✅ Check if email already exists in DB
        const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            return apiErrorRes(HTTP_STATUS.CONFLICT, res, "Email already in use");
        }

        // ✅ Save to Redis
        const onboardData = { email: email.toLowerCase().trim(), password, language: language?.data || 'english' };
        await setKeyNoTime(`onboard:${phoneNumber}`, JSON.stringify(onboardData));

        return apiSuccessRes(HTTP_STATUS.OK, res, "Email and password saved", { email, phoneNumber });
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
    }
};


const saveCategories = async (req, res) => {
    try {
        const { phoneNumber, categories } = req.body;
        const data = await getKey(`onboard:${phoneNumber}`);
        if (data.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing onboarding session");
        }
        const parsed = JSON.parse(data.data);


        let categoriesArray = [];
        if (req.body.categories) {
            const raw = Array.isArray(req.body.categories)
                ? req.body.categories
                : [req.body.categories];
            // Clean array: remove empty strings or invalid ObjectId formats
            categoriesArray = raw
                .map(id => id.trim?.()) // optional chaining for safety
        }

        parsed.categories = categoriesArray;
        await setKeyNoTime(`onboard:${phoneNumber}`, JSON.stringify(parsed));
        return apiSuccessRes(HTTP_STATUS.OK, res, "Categories saved", { phoneNumber, categories });
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
    }
};

const completeRegistration = async (req, res) => {
    try {

        const { phoneNumber, userName, gender, dob } = req.body


        const onboardingDataResult = await getKey(`onboard:${phoneNumber}`);

        if (onboardingDataResult.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Incomplete onboarding data");
        }

        const onboardData = JSON.parse(onboardingDataResult.data);
        let profileImageUrl = undefined;

        // ✅ Upload image if exists
        if (req.file) {


            const imageResult = await uploadImageCloudinary(req.file, 'profile-images');


            if (!imageResult) {
                return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Image upload failed");
            }
            profileImageUrl = imageResult;
        }


        let categories = onboardData.categories;
        if (typeof categories === 'string') {
            try {
                categories = JSON.parse(categories);
            } catch (e) {
                // Fallback if it's not a valid JSON string
                categories = categories.split(',').map(item => item.trim());
            }
        }

        let obj = {
            userName,
            gender,
            dob,
            phoneNumber,
            categories,
            email: onboardData.email,
            password: onboardData.password,
            profileImage: profileImageUrl || undefined,
            language: onboardData.language
        }

        if (req.body?.fcmToken && req.body?.fcmToken !== "") {
            obj['fcmToken'] = req.body.fcmToken;
        }

        // ✅ Create User
        const user = new User({
            ...obj
        });

        await user.save();

        console.log("5555555", user)


        // ✅ Cleanup
        await removeKey(`onboard:${phoneNumber}`);
        await removeKey(`verified:${phoneNumber}`);

        const payload = {
            email: user.email,
            userId: user._id,
            roleId: user.roleId,
            role: user.role,
            userName: user.userName
        };


        const token = signToken(payload);
        const output = {
            token,
            userId: user._id,
            roleId: user.roleId,
            role: user.role,
            profileImage: user.profileImage,
            userName: user.userName,
            email: user.email,
        };


        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Registration completed", output);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
    }
};



const loginStepOne = async (req, res) => {
    try {
        const { identifier } = req.body; // can be email, phoneNumber, or userName

        if (!identifier) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Identifier is required");
        }
        const cleanedIdentifier = identifier.trim().toLowerCase();
        // Flexible query for email, phoneNumber or userName (case insensitive for email)
        const query = {
            $or: [
                { email: cleanedIdentifier },
                { phoneNumber: identifier },
                { userName: cleanedIdentifier }
            ]
        };

        const userResult = await getDocumentByQuery(User, query);

        if (userResult.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "User not found");
        }

        if (userResult.data.isDisable) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
        }

        // Generate temporary verify token for step two
        const verifyToken = generateKey();

        // Store userId linked to verifyToken in Redis with expiration (e.g. 10 mins)
        await setKeyWithTime(`loginStepTwo:${verifyToken}`, userResult.data._id.toString(), 500);

        return apiSuccessRes(HTTP_STATUS.OK, res, "User verified, proceed with password", { verifyToken });

    } catch (error) {
        console.error('Login Step 1 error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const loginStepTwoPassword = async (req, res) => {
    try {
        const { loginToken, password, fcmToken, loginWithCode } = req.body;
        if (password && password !== "" && loginWithCode == "true") {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Password is required for login with code is not allowed")
        }

        const tokenData = await getKey(`loginStepTwo:${loginToken}`);
        if (tokenData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid or expired login token");
        }


        const userId = tokenData.data;
        const user = await User.findById(userId);
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }
        if (password && password !== "") {

            // 🔐 Check password
            const isMatch = await verifyPassword(user.password, password);
            if (!isMatch) {
                return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Incorrect password");
            }

            // 🔒 Update FCM token (optional)
            if (fcmToken && fcmToken !== "") {
                user.fcmToken = fcmToken;
                await user.save();
            }

            // 🎟️ Create long-lived JWT token (3 years)
            const payload = {
                email: user.email,
                userId: user._id,
                roleId: user.roleId,
                role: user.role,
                profileImage: user.profileImage,
                userName: user.userName
            };
            const token = signToken(payload);

            // ✅ Cleanup temp token
            await removeKey(`loginStepOne:${loginToken}`);

            return apiSuccessRes(HTTP_STATUS.OK, res, "Login successful", {
                token,
                userId: user._id,
                roleId: user.roleId,
                role: user.role,
                profileImage: user.profileImage,
                userName: user.userName,
                email: user.email,

            });
        } else if (loginWithCode === 'true') {
            const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
            const otpToken = generateKey();

            await setKeyWithTime(`otpLogin:${otpToken}`, JSON.stringify({ userId: user._id, otp }), 500);
            console.log(`OTP for ${user.phoneNumber}: ${otp}`);
            return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent", { otpToken });
        }
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Provide either password or loginWithCode=true");
    } catch (err) {
        console.log(err)
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};

const loginStepThreeVerifyOtp = async (req, res) => {
    try {
        const { otpToken, otp, fcmToken } = req.body;

        const redisData = await getKey(`otpLogin:${otpToken}`);
        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid or expired OTP token");
        }

        const { userId, otp: storedOtp } = JSON.parse(redisData.data);
        if (otp !== storedOtp) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
        }

        const user = await User.findById(userId);
        if (!user) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");

        if (fcmToken) {
            user.fcmToken = fcmToken;
            await user.save();
        }

        const payload = {
            email: user.email,
            userId: user._id,
            roleId: user.roleId,
            role: user.role,
            profileImage: user.profileImage,
            userName: user.userName
        };

        const token = signToken(payload);


        await removeKey(`otpLogin:${otpToken}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified, login successful", {
            token,
            userId: user._id,
            roleId: user.roleId,
            role: user.role,
            profileImage: user.profileImage,
            userName: user.userName,
            email: user.email,
        });
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};
const resendLoginOtp = async (req, res) => {
    try {
        const { otpToken } = req.body;

        const redisData = await getKey(`otpLogin:${otpToken}`);
        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid or expired OTP token");
        }

        const { userId } = JSON.parse(redisData.data);
        const user = await User.findById(userId);
        if (!user) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");

        const newOtp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();

        await setKeyWithTime(`otpLogin:${otpToken}`, JSON.stringify({ userId, otp: newOtp }), 500);

        // Send again
        console.log(`Resent OTP to ${user.phoneNumber}: ${newOtp}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};



const follow = async (req, res) => {
    try {
        let followedBy = req.user.userId
        let { userId } = req.body
        let followData = await getDocumentByQuery(Follow, { followedBy: toObjectId(followedBy), userId: toObjectId(userId) })
        if (followData.statusCode === CONSTANTS.SUCCESS) {
            await Follow.findByIdAndDelete(followData.data._id);
            return apiSuccessRes(
                HTTP_STATUS.OK,
                res,
                "Unfollowed successfully",
                null
            );
        }
        const newFollow = new Follow({
            followedBy: toObjectId(followedBy),
            userId: toObjectId(userId)
        });
        await newFollow.save();
        return apiSuccessRes(
            HTTP_STATUS.CREATED,
            res,
            "Followed successfully",
            newFollow
        );

    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message,
            error.message
        );
    }
}


const threadlike = async (req, res) => {
    try {
        let likeBy = req.user.userId
        let { threadId } = req.body
        let threadData = await getDocumentByQuery(ThreadLike, { likeBy: toObjectId(likeBy), threadId: toObjectId(threadId) })
        if (threadData.statusCode === CONSTANTS.SUCCESS) {
            await ThreadLike.findByIdAndDelete(threadData.data._id);
            return apiSuccessRes(
                HTTP_STATUS.OK,
                res,
                "Thread DisLike successfully",
                null
            );
        }
        const newFollow = new ThreadLike({
            likeBy: toObjectId(likeBy),
            threadId: toObjectId(threadId)
        });
        await newFollow.save();
        return apiSuccessRes(
            HTTP_STATUS.CREATED,
            res,
            "Thread Like successfully",
            newFollow
        );

    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message,
            error.message
        );
    }
}

const productLike = async (req, res) => {
    try {
        let likeBy = req.user.userId
        let { productId } = req.body
        let threadData = await getDocumentByQuery(ProductLike, { likeBy: toObjectId(likeBy), productId: toObjectId(productId) })
        if (threadData.statusCode === CONSTANTS.SUCCESS) {
            await ProductLike.findByIdAndDelete(threadData.data._id);
            return apiSuccessRes(
                HTTP_STATUS.OK,
                res,
                "Product DisLike successfully",
                null
            );
        }
        const newFollow = new ProductLike({
            likeBy: toObjectId(likeBy),
            productId: toObjectId(productId)
        });
        await newFollow.save();
        return apiSuccessRes(
            HTTP_STATUS.CREATED,
            res,
            "Product Like successfully",
            newFollow
        );

    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message,
            error.message
        );
    }
}


const getLikedProducts = async (req, res) => {
    try {
        const userId = req.user.userId;

        const page = parseInt(req.query.pageNo) || 1;
        const limit = parseInt(req.query.size) || 10;
        const skip = (page - 1) * limit;

        const sortBy = req.query.sortBy === "fixedPrice" ? "fixedPrice" : "createdAt";
        const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

        // Get liked product IDs for the user
        const likedDocs = await ProductLike.find({
            likeBy: toObjectId(userId),
            isDisable: false,
            isDeleted: false,
        }).select("productId");

        const likedProductIds = likedDocs.map((doc) => doc.productId);

        const query = {
            _id: { $in: likedProductIds },
            isDisable: false,
            isDeleted: false,
        };

        const totalCount = await SellProduct.countDocuments(query);

        const products = await SellProduct.find(query)
            .sort({ [sortBy]: sortOrder })
            .skip(skip)
            .limit(limit)
            .lean();

        // For each product that is auction, fetch bid count
        const productsWithBidCount = await Promise.all(
            products.map(async (product) => {
                if (product.saleType === SALE_TYPE.AUCTION) {
                    const bidCount = await Bid.countDocuments({ productId: product._id });
                    return { ...product, totalBids: bidCount };
                }
                return { ...product, totalBids: 0 };
            })
        );

        return apiSuccessRes(HTTP_STATUS.OK, res, "Liked products fetched successfully", {
            products: productsWithBidCount,
            total: totalCount,
            pageNo: page,
            size: limit
        });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error.message);
    }
};



const getLikedThreads = async (req, res) => {
    try {
        const userId = req.user.userId;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const sortBy = req.query.sortBy === "commentCount" ? "commentCount" : "date";
        const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

        // 1. Find liked thread IDs
        const likedThreadDocs = await ThreadLike.find({
            likeBy: toObjectId(userId),
            isDisable: false,
            isDeleted: false,
        }).select("threadId");

        const likedThreadIds = likedThreadDocs.map(doc => doc.threadId);

        const totalCount = likedThreadIds.length;
        if (totalCount === 0) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "No liked threads found", {
                threads: [],
                pagination: { total: 0, page, limit, totalPages: 0 },
            });
        }

        const pipeline = [
            { $match: { _id: { $in: likedThreadIds } } },

            // Lookup all comments for the thread
            {
                $lookup: {
                    from: "threadcomments",
                    localField: "_id",
                    foreignField: "thread",
                    as: "comments"
                }
            },

            // Add commentCount field
            {
                $addFields: {
                    commentCount: { $size: "$comments" }
                }
            },

            // Unwind comments to get associatedProducts
            { $unwind: { path: "$comments", preserveNullAndEmptyArrays: true } },

            // Unwind associatedProducts from each comment
            { $unwind: { path: "$comments.associatedProducts", preserveNullAndEmptyArrays: true } },

            // Group back to thread level, keep entire thread doc as 'threadDoc'
            {
                $group: {
                    _id: "$_id",
                    threadDoc: { $first: "$$ROOT" },
                    associatedProductsSet: { $addToSet: "$comments.associatedProducts" }
                }
            },

            // Add associatedProductCount field
            {
                $addFields: {
                    "threadDoc.associatedProductCount": {
                        $size: {
                            $filter: {
                                input: "$associatedProductsSet",
                                as: "prod",
                                cond: { $ne: ["$$prod", null] }
                            }
                        }
                    }
                }
            },

            // Replace root to output full thread doc with added fields
            { $replaceRoot: { newRoot: "$threadDoc" } }
        ];

        // Then add sorting, pagination as before
        if (sortBy === "commentCount") {
            pipeline.push({ $sort: { commentCount: sortOrder } });
        } else {
            pipeline.push({ $sort: { createdAt: sortOrder } });
        }

        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: limit });
        const threads = await Thread.aggregate(pipeline);
        let obj = {
            threads,
            total: totalCount,
            pageNo: page,
            size: limit
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Liked threads fetched successfully", obj);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, error.message);
    }
};



const requestResetOtp = async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        // Check if user exists
        const user = await User.findOne({ phoneNumber });
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User with this phone number does not exist");
        }

        // Generate OTP & token
        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
        const resetToken = generateKey();

        const redisValue = JSON.stringify({ otp, phoneNumber });

        // Save OTP + phoneNumber in Redis with 5 mins expiry
        await setKeyWithTime(`reset:${resetToken}`, redisValue, 500);

        // (Optionally send OTP via SMS here...)

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent for password reset", { resetToken });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};



const verifyResetOtp = async (req, res) => {
    try {
        const { otp, resetToken } = req.body;

        const redisData = await getKey(`reset:${resetToken}`);

        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                "Reset token expired or invalid"
            );
        }

        const { otp: storedOtp, phoneNumber } = JSON.parse(redisData.data);

        if (otp !== storedOtp) {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                "Invalid OTP"
            );
        }

        // ✅ Mark as verified for password reset
        await setKeyWithTime(`reset-verified:${phoneNumber}`, 'true', 10 * 60); // 10 mins
        await removeKey(`reset:${resetToken}`);

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "OTP verified successfully",
            { phoneNumber }
        );
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message
        );
    }
};



const resetPassword = async (req, res) => {
    try {
        const { phoneNumber, newPassword, confirmPassword } = req.body;

        // ✅ Check if phoneNumber was verified
        const isVerified = await getKey(`reset-verified:${phoneNumber}`);
        if (isVerified.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                "OTP not verified or session expired"
            );
        }

        // ✅ Validate passwords
        if (!newPassword || !confirmPassword || newPassword !== confirmPassword) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "New password and confirm password must match"
            );
        }

        // ✅ Update password
        const user = await User.findOne({ phoneNumber });
        if (!user) {
            return apiErrorRes(
                HTTP_STATUS.NOT_FOUND,
                res,
                "User not found"
            );
        }

        user.password = newPassword;
        await user.save(); // triggers pre('save') to hash

        await removeKey(`reset-verified:${phoneNumber}`);

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "Password has been reset successfully"
        );
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message
        );
    }
};


const resendResetOtp = async (req, res) => {
    try {
        const { resetToken } = req.body;

        // ✅ Check if token exists in Redis
        const redisData = await getKey(`reset:${resetToken}`);
        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                "Reset token expired or invalid"
            );
        }
        const { phoneNumber } = JSON.parse(redisData.data);

        // ✅ Regenerate OTP with same token
        const otp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();
        const updatedRedisValue = JSON.stringify({ otp, phoneNumber });

        // ✅ Overwrite existing Redis value, reset expiry to 5 mins
        await setKeyWithTime(`reset:${resetToken}`, updatedRedisValue, 500);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully", { resetToken });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const login = async (req, res) => {
    try {
        const email = String(req.body.email);
        const userCheckEmail = await getDocumentByQuery(User, { email });
        if (userCheckEmail.statusCode === CONSTANTS.SUCCESS) {
            if (userCheckEmail.data.isDisable === true) {
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    CONSTANTS_MSG.ACCOUNT_DISABLE,
                    userCheckEmail.data
                );
            }

            // ✅ Continue with password verification
            const verifyPass = await verifyPassword(
                userCheckEmail.data.password,
                req.body.password
            );

            if (!verifyPass) {
                return apiErrorRes(
                    HTTP_STATUS.UNAUTHORIZED,
                    res,
                    CONSTANTS_MSG.INVALID_PASSWORD
                );
            }



            if (req.body?.fmcToken && req.body?.fmcToken !== "") {
                userCheckEmail.data.fmcToken = req.body.fmcToken;
                await userCheckEmail.data.save();
            }

            const payload = {
                email: userCheckEmail.data.email,
                userId: userCheckEmail.data._id,
                roleId: userCheckEmail.data.roleId,
                role: userCheckEmail.data.role,
                profileImage: userCheckEmail.data.profileImage,
                userName: userCheckEmail.data.userName
            };

            const token = signToken(payload);

            const output = {
                token,
                userId: userCheckEmail.data._id,
                roleId: userCheckEmail.data.roleId,
                role: userCheckEmail.data.role,
                profileImage: userCheckEmail.data.profileImage,
                userName: userCheckEmail.data.userName,
                email: userCheckEmail.data.email,

            };

            return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, output);
        } else {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                CONSTANTS_MSG.EMAIL_NOTFOUND,
                userCheckEmail.data
            );
        }
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            error.message,
            error.message
        );
    }
};






//upload api 
router.post('/upload', upload.single('file'), uploadfile);

// Registration Process
router.post('/requestOtp', perApiLimiter(), upload.none(), validateRequest(mobileLoginSchema), requestOtp);
router.post('/verifyOtp', perApiLimiter(), upload.none(), validateRequest(otpVerification), verifyOtp);
router.post('/saveEmailPassword', perApiLimiter(), upload.none(), validateRequest(saveEmailPasswords), saveEmailPassword);
router.post('/saveCategories', perApiLimiter(), upload.none(), saveCategories);
router.post('/completeRegistration', perApiLimiter(), upload.single('file'), validateRequest(completeRegistrationSchema), completeRegistration);
//login 
router.post('/loginStepOne', perApiLimiter(), upload.none(), validateRequest(loginStepOneSchema), loginStepOne);
router.post('/loginStepTwo', perApiLimiter(), upload.none(), validateRequest(loginStepTwoSchema), loginStepTwoPassword);
router.post('/loginStepThree', perApiLimiter(), upload.none(), validateRequest(loginStepThreeSchema), loginStepThreeVerifyOtp);
router.post('/resendLoginOtp', perApiLimiter(), upload.none(), validateRequest(otpTokenSchema), resendLoginOtp);
router.post('/login', perApiLimiter(), upload.none(), validateRequest(loginSchema), login);
//RESET PASSWORD 
router.post('/requestResetOtp', perApiLimiter(), upload.none(), validateRequest(requestResetOtpSchema), requestResetOtp);
router.post('/verifyResetOtp', perApiLimiter(), upload.none(), validateRequest(verifyResetOtpSchema), verifyResetOtp);
router.post('/resetPassword', perApiLimiter(), upload.none(), validateRequest(resetPasswordSchema), resetPassword);
router.post('/resendResetOtp', perApiLimiter(), upload.none(), validateRequest(resendResetOtpSchema), resendResetOtp);





//Follow //Like
router.post('/follow', perApiLimiter(), upload.none(), validateRequest(followSchema), follow);
router.post('/threadlike', perApiLimiter(), upload.none(), validateRequest(threadLikeSchema), threadlike);
router.post('/productLike', perApiLimiter(), upload.none(), validateRequest(productLikeSchema), productLike);
router.get('/getLikedProducts', perApiLimiter(), upload.none(), getLikedProducts)
router.get('/getLikedThreads', perApiLimiter(), upload.none(), getLikedThreads)


//userList


module.exports = router;
