
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { User, Follow, ThreadLike, ProductLike, SellProduct, Thread, Order, SellProductDraft, ThreadDraft, TempUser } = require('../../db');
const { getDocumentByQuery } = require('../services/serviceGlobalCURD');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const CONSTANTS = require('../../utils/constants')
const HTTP_STATUS = require('../../utils/statusCode');
const { apiErrorRes, verifyPassword, apiSuccessRes, generateOTP, generateKey, toObjectId } = require('../../utils/globalFunction');
const { signToken } = require('../../utils/jwtTokenUtils');
const { loginSchema, followSchema, threadLikeSchema, productLikeSchema, requestResetOtpSchema, verifyResetOtpSchema, resetPasswordSchema, loginStepOneSchema, loginStepTwoSchema, loginStepThreeSchema, otpTokenSchema, resendResetOtpSchema, resendOtpSchema } = require('../services/validations/userValidation');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { setKeyWithTime, setKeyNoTime, getKey, removeKey } = require('../services/serviceRedis');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { SALE_TYPE, roleId } = require('../../utils/Role');
const SellProducts = require('../../db/models/SellProducts');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const globalCrudController = require('./globalCrudController');

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


const getUserResponse = (user) => {
    return {
        token: null,
        ...user.toJSON()
    };
};




const requestOtp = async (req, res) => {
    const { phoneNumber, language } = req.body;

    // Check if user exists in main User collection
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
        return apiErrorRes(HTTP_STATUS.OK, res, "Phone number already registered", {
            phoneNumber,
            step: existingUser.step || 5,  // 5 or whatever means completed
        });
    }

    // Check if temp user exists, reuse OTP and step
    let tempUser = await TempUser.findOne({ phoneNumber });

    if (!tempUser) {
        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();

        tempUser = new TempUser({
            phoneNumber,
            language,
            tempOtp: otp,
            step: 1,
            tempOtpExpiresAt: new Date(Date.now() + 5 * 60 * 1000) // expires in 5 min
        });

        await tempUser.save();
    }

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent", { phoneNumber, step: 1 });
};

const verifyOtp = async (req, res) => {
    const { phoneNumber, otp } = req.body;

    const tempUser = await TempUser.findOne({ phoneNumber });
    if (!tempUser || tempUser.tempOtp !== otp) {
        return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
    }

    // OTP verified - move data to User collection
    let user = await User.findOne({ phoneNumber });
    if (!user) {
        user = new User({
            phoneNumber,
            language: tempUser.language,
            step: 2
        });
    } else {
        user.step = 2;
    }

    await user.save();

    // Delete temp user data after successful verification
    await TempUser.deleteOne({ phoneNumber });

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified", getUserResponse(user));
};

const resendOtp = async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number is required");
    }

    const tempUser = await TempUser.findOne({ phoneNumber });

    if (!tempUser) {
        return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found for OTP resend");
    }

    if (tempUser.step >= 2) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "OTP already verified");
    }

    const newOtp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();
    tempUser.tempOtp = newOtp;
    tempUser.tempOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await tempUser.save();

    // Send OTP via SMS/email here...

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully", {
        phoneNumber,
        step: tempUser.step
    });
};




const saveEmailPassword = async (req, res) => {
    const { phoneNumber, email, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user || user.step !== 2) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "OTP not verified");
    }

    const emailExists = await User.findOne({ email });
    if (emailExists && emailExists._id.toString() !== user._id.toString()) {
        return apiErrorRes(HTTP_STATUS.CONFLICT, res, "Email already in use");
    }

    user.email = email.toLowerCase().trim();
    user.password = password;
    user.step = 3;
    await user.save();

    return apiSuccessRes(HTTP_STATUS.OK, res, "Email and password saved", getUserResponse(user));
};


const saveCategories = async (req, res) => {
    const { phoneNumber, categories } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user || user.step !== 3) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Complete previous step first");
    }

    user.categories = Array.isArray(categories) ? categories : [categories];
    user.step = 4;
    await user.save();

    return apiSuccessRes(HTTP_STATUS.OK, res, "Categories saved", getUserResponse(user));
};
const getOnboardingStep = async (req, res) => {
    const { phoneNumber } = req.query;
    const user = await User.findOne({ phoneNumber });
    if (!user) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");

    return apiSuccessRes(HTTP_STATUS.OK, res, "Current onboarding step", {
        phoneNumber,
        step: user.step
    });
};
const completeRegistration = async (req, res) => {
    const { phoneNumber, userName, gender, dob, fcmToken } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Incomplete onboarding");
    }

    if (req.file) {
        const imageUrl = await uploadImageCloudinary(req.file, 'profile-images');
        user.profileImage = imageUrl;
    }

    user.userName = userName;
    user.gender = gender;
    user.dob = dob;
    user.fcmToken = fcmToken || null;
    user.step = 5;

    await user.save();

    const payload = {
        userId: user._id,
        email: user.email,
        roleId: user.roleId,
        role: user.role,
        userName: user.userName
    };

    const token = signToken(payload);

    return apiSuccessRes(HTTP_STATUS.CREATED, res, "Registration completed", {
        token,
        ...user.toJSON()
    });
};



const loginStepOne = async (req, res) => {
    try {
        const { identifier } = req.body; // email, phoneNumber, or userName
        if (!identifier) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Identifier is required");
        }

        const cleanedIdentifier = identifier.trim().toLowerCase();

        const query = {
            $or: [
                { email: cleanedIdentifier },
                { phoneNumber: identifier },
                { userName: cleanedIdentifier }
            ]
        };

        const user = await User.findOne(query);

        if (!user) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "User not found");
        }

        if (user.isDisable) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
        }

        // No token needed here, frontend just proceeds with step 2

        return apiSuccessRes(HTTP_STATUS.OK, res, "User verified, proceed with login", getUserResponse(user));


    } catch (error) {
        console.error('Login Step 1 error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};
const loginStepTwoPassword = async (req, res) => {
    try {
        const { identifier, password, fcmToken, loginWithCode } = req.body;
        if (!identifier) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Identifier is required");
        }

        if (password && loginWithCode === "true") {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Password is required when loginWithCode is false");
        }

        const cleanedIdentifier = identifier.trim().toLowerCase();

        const query = {
            $or: [
                { email: cleanedIdentifier },
                { phoneNumber: identifier },
                { userName: cleanedIdentifier }
            ]
        };

        const user = await User.findOne(query).select('+password +loginOtp +loginOtpExpiresAt');
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        if (password && password !== "") {
            const isMatch = await verifyPassword(user.password, password);
            if (!isMatch) {
                return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Incorrect password");
            }

            if (fcmToken) {
                user.fcmToken = fcmToken;
                await user.save();
            }

            const token = signToken({
                email: user.email,
                userId: user._id,
                roleId: user.roleId,
                role: user.role,
                profileImage: user.profileImage,
                userName: user.userName
            });





            return apiSuccessRes(HTTP_STATUS.OK, res, "Login successful",

                {
                    token,
                    ...user.toJSON()
                }
            );





        } else if (loginWithCode === 'true') {
            const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();

            user.loginOtp = otp;
            user.loginOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
            await user.save();

            console.log(`OTP for ${user.phoneNumber}: ${otp}`);

            return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent");
        }



        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Provide either password or loginWithCode=true");

    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};
const loginStepThreeVerifyOtp = async (req, res) => {
    try {
        const { identifier, otp, fcmToken } = req.body;
        if (!identifier || !otp) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Identifier and OTP are required");
        }

        const cleanedIdentifier = identifier.trim().toLowerCase();

        const query = {
            $or: [
                { email: cleanedIdentifier },
                { phoneNumber: identifier },
                { userName: cleanedIdentifier }
            ]
        };

        const user = await User.findOne(query).select('+loginOtp +loginOtpExpiresAt');
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        if (!user.loginOtp || user.loginOtp !== otp) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
        }

        if (user.loginOtpExpiresAt < new Date()) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "OTP expired");
        }

        if (fcmToken) {
            user.fcmToken = fcmToken;
        }

        user.loginOtp = null;
        user.loginOtpExpiresAt = null;
        await user.save();

        const token = signToken({
            email: user.email,
            userId: user._id,
            roleId: user.roleId,
            role: user.role,
            profileImage: user.profileImage,
            userName: user.userName
        });


        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified, login successful",

            {
                token,
                ...user.toJSON()
            }
        );





    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};
const resendLoginOtp = async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Identifier is required");
        }

        const cleanedIdentifier = identifier.trim().toLowerCase();

        const query = {
            $or: [
                { email: cleanedIdentifier },
                { phoneNumber: identifier },
                { userName: cleanedIdentifier }
            ]
        };

        const user = await User.findOne(query);
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        const newOtp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();

        user.loginOtp = newOtp;
        user.loginOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await user.save();

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
        if (!phoneNumber) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number is required");
        }

        const user = await User.findOne({ phoneNumber });
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User with this phone number does not exist");
        }

        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
        const redisValue = JSON.stringify({ otp, phoneNumber });

        // Save OTP keyed by phoneNumber with 5 min expiry
        await setKeyWithTime(`reset:${phoneNumber}`, redisValue, 5 * 60);

        // Optionally send OTP via SMS here...

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent for password reset");
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const verifyResetOtp = async (req, res) => {
    try {
        const { phoneNumber, otp } = req.body;
        if (!phoneNumber || !otp) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number and OTP are required");
        }

        const redisData = await getKey(`reset:${phoneNumber}`);

        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "OTP expired or invalid");
        }

        const { otp: storedOtp } = JSON.parse(redisData.data);

        if (otp !== storedOtp) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
        }

        // Mark as verified for 10 minutes
        await setKeyWithTime(`reset-verified:${phoneNumber}`, 'true', 10 * 60);

        // Remove OTP key so it can't be reused
        await removeKey(`reset:${phoneNumber}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified successfully");
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
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
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number is required");
        }

        const user = await User.findOne({ phoneNumber });
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        const otp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();
        const redisValue = JSON.stringify({ otp, phoneNumber });

        // Overwrite existing OTP and reset expiry
        await setKeyWithTime(`reset:${phoneNumber}`, redisValue, 5 * 60);

        // Optionally send OTP via SMS here...

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");
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



const loginAsGuest = async (req, res) => {
    try {
        const email = 'guestxyz@gmail11.com';
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
                '0000000011'
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

            const userData = userCheckEmail?.data?.toObject ? userCheckEmail.data.toObject() : userCheckEmail?.data;

            return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, {
                ...userData,
                ...output
            });

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


const getProfile = async (req, res) => {
    try {
        const userId = req.user.userId;

        const user = await User.findById(userId).lean();
        if (!user) {
            return apiErrorRes(
                HTTP_STATUS.NOT_FOUND,
                res,
                "User not found"
            );
        }

        const [myThreadCount, productListed, boughtCount, sellCount, ThreadDraftCount, ProductDraftCount, ThreadLikes, productLike] = await Promise.all([
            Thread.countDocuments({ userId, isDeleted: false }),
            SellProducts.countDocuments({ userId, isDeleted: false }),
            Order.countDocuments({ userId, isDeleted: false }),
            SellProducts.countDocuments({ userId, isDeleted: false, isSold: true }),

            ThreadDraft.countDocuments({ userId, isDeleted: false }),
            SellProductDraft.countDocuments({ userId, isDeleted: false }),

            ThreadLike.countDocuments({ likeBy: toObjectId(userId), isDeleted: false }),
            ProductLike.countDocuments({ likeBy: toObjectId(userId), isDeleted: false })

        ]);

        const output = {
            userId: user._id,
            roleId: user.roleId,
            role: user.role,
            profileImage: user.profileImage,
            userName: user.userName,
            email: user.email,
            phoneNumber: user.phoneNumber,
            dob: user.dob,
            gender: user.gender,
            language: user.language,
            is_Verified_Seller: user.is_Verified_Seller,
            is_Id_verified: user.is_Id_verified,
            is_Preferred_seller: user.is_Preferred_seller,
            myThreadCount,
            productListedCount: productListed,
            boughtCount,
            sellCount,
            ThreadDraftCount,
            ProductDraftCount,
            ThreadLikes,
            productLike,
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, output);
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Internal server error",
            error.message
        );
    }
};

const updateProfile = async (req, res) => {
    try {
        let { userName, email, phoneNumber, ...other } = req.body;
        const userId = req.user.userId;

        // Check for existing userName
        if (userName && userName.trim() !== "") {
            const normalizedUserName = userName.toLowerCase();
            const userInfo = await getDocumentByQuery(User, {
                userName: normalizedUserName,
                _id: { $ne: toObjectId(userId) }
            });
            if (userInfo.statusCode === CONSTANTS.SUCCESS) {
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    "userName Already Exist"
                );
            }
        }

        // Check for existing email
        if (email && email.trim() !== "") {
            const normalizedEmail = email.toLowerCase();
            const userInfo = await getDocumentByQuery(User, {
                email: normalizedEmail,
                _id: { $ne: toObjectId(userId) }
            });
            if (userInfo.statusCode === CONSTANTS.SUCCESS) {
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    "email Already Exist"
                );
            }
        }

        // Check for existing phoneNumber
        if (phoneNumber && phoneNumber.trim() !== "") {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "phoneNumber Cannot be updated"
            );
        }

        // Prepare update payload
        const updateData = {
            ...other,
            ...(userName && { userName: userName.toLowerCase() }),
            ...(email && { email: email.toLowerCase() })
        };

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        ).select('-password');

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "Profile updated successfully",
            updatedUser
        );
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Internal server error",
            error.message
        );
    }
};





const requestPhoneNumberUpdateOtp = async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const userId = req.user.userId;

        if (!phoneNumber) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number is required");
        }

        const existing = await getDocumentByQuery(User, { phoneNumber });
        if (existing.statusCode === CONSTANTS.SUCCESS && existing.data._id.toString() !== userId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number already in use");
        }

        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();

        await setKeyWithTime(`verify-update:${userId}:${phoneNumber}`, otp, 5);
        console.log(`verify-update:${userId}:${phoneNumber}`)
        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent successfully");
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to send OTP", error.message);
    }
};

const verifyPhoneNumberUpdateOtp = async (req, res) => {
    try {
        const { phoneNumber, otp } = req.body;
        const userId = req.user.userId;

        if (!phoneNumber || !otp) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number and OTP are required");
        }

        const redisKey = `verify-update:${userId}:${phoneNumber}`;
        const savedOtp = await getKey(redisKey);
        console.log("redisKey", redisKey, savedOtp)


        if (!savedOtp?.data) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "OTP expired or not requested");
        }

        if (savedOtp?.data !== otp) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid OTP");
        }

        // Update phone number
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { phoneNumber: phoneNumber.toLowerCase() },
            { new: true }
        ).select('-password');

        // Clean up OTP
        await removeKey(redisKey);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Phone number updated successfully", updatedUser);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to verify OTP", error.message);
    }
};

const resendPhoneNumberUpdateOtp = async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        const userId = req.user.userId;

        if (!phoneNumber) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number is required");
        }

        const formattedPhone = phoneNumber.toLowerCase();

        // Check if phone number already exists for another user
        const existingUser = await getDocumentByQuery(User, {
            phoneNumber: formattedPhone,
            _id: { $ne: toObjectId(userId) } // exclude current user
        });

        if (existingUser.statusCode === CONSTANTS.SUCCESS) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "Phone number already exists"
            );
        }

        const redisKey = `verify-update:${userId}:${formattedPhone}`;
        const previousOtp = await getKey(redisKey);

        if (!previousOtp) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "No OTP request found for this phone number. Please initiate phone number update first."
            );
        }

        // Generate and resend OTP
        const newOtp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();

        await setKeyWithTime(redisKey, newOtp, 5); // 5-minute TTL

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "OTP resent successfully"
        );
    } catch (error) {
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Failed to resend OTP",
            error.message
        );
    }
};



const userList = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            keyWord = "",
            status,
            showSellerRequests = false,
            showReported = false,
            registrationDateStart,
            sortBy = "createdAt",
            sortOrder = "asc",
            registrationDateEnd,
        } = req.query;

        const sortStage = {};
        const order = sortOrder === "desc" ? -1 : 1;
        sortStage[sortBy] = order;


        const query = {
            isDeleted: false,
            roleId: { $nin: [roleId.SUPER_ADMIN, roleId.GUEST] },
        };

        if (keyWord) {
            const regex = new RegExp(keyWord, "i");
            query.$or = [
                { userName: regex },
                { email: regex },
                { phoneNumber: regex },
            ];
        }

        if (status) {
            query.status = status;
        }

        if (showReported === "true") {
            query.reportCount = { $gt: 0 };
        }

        // Add registration date range filter
        if (registrationDateStart || registrationDateEnd) {
            query.createdAt = {};
            if (registrationDateStart) {
                const startDate = new Date(registrationDateStart);
                if (!isNaN(startDate)) {
                    query.createdAt.$gte = startDate;
                }
            }
            if (registrationDateEnd) {
                const endDate = new Date(registrationDateEnd);
                if (!isNaN(endDate)) {
                    // To include the entire day, set time to 23:59:59.999
                    endDate.setHours(23, 59, 59, 999);
                    query.createdAt.$lte = endDate;
                }
            }
            // Remove createdAt if no valid dates
            if (Object.keys(query.createdAt).length === 0) {
                delete query.createdAt;
            }
        }

        // Aggregation pipeline
        const aggregation = [
            { $match: query },
            {
                $lookup: {
                    from: "SellerVerification",
                    localField: "_id",
                    foreignField: "userId",
                    as: "sellerVerification",
                },
            },
            {
                $addFields: {
                    sellerVerificationStatus: {
                        $ifNull: [{ $arrayElemAt: ["$sellerVerification.verificationStatus", 0] }, null],
                    },
                },
            },




            {
                $lookup: {
                    from: "UserLocation",
                    let: { userId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$userId", "$$userId"] },
                                isDeleted: false,
                                isDisable: false,
                                isActive: true
                            }
                        },
                        { $sort: sortStage },
                        { $limit: 1 } // Get the most recent or default address
                    ],
                    as: "userAddress"
                }
            },


            {
                $addFields: {
                    userAddress: { $arrayElemAt: ["$userAddress", 0] }
                }
            }

        ];

        if (showSellerRequests === "true") {
            aggregation.push({
                $match: {
                    sellerVerificationStatus: "Pending",
                },
            });
        }

        aggregation.push({
            $project: {
                userName: 1,
                _id: 1,
                email: 1,
                phoneNumber: 1,
                gender: 1,
                dob: 1,
                isDisable: 1,
                createdAt: 1,
                sellerVerificationStatus: 1,
                sellerVerification: 1,
                userAddress: 1
            },
        });

        const totalUsersAgg = await User.aggregate([...aggregation, { $count: "total" }]);
        const total = totalUsersAgg[0]?.total || 0;

        const users = await User.aggregate([
            ...aggregation,
            { $sort: { createdAt: -1 } },
            { $skip: (pageNo - 1) * size },
            { $limit: parseInt(size) },
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Users fetched successfully", {
            total,
            pageNo,
            size,
            users,
        });
    } catch (err) {
        console.error("Error in listUsers:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to fetch user list", err.message);
    }
};



const getDashboardSummary = async (req, res) => {
    try {
        const [
            totalUsers,
            totalThreads,
            totalFixedProducts,
            totalSoldProducts,
            totalUnsoldProducts,
            liveAuctions
        ] = await Promise.all([
            // Users (excluding SUPER_ADMIN, GUEST)
            User.countDocuments({
                isDeleted: false,
                isDisable: false,
                roleId: { $nin: [roleId.SUPER_ADMIN, roleId.GUEST] }
            }),

            // Threads
            Thread.countDocuments({
                isDeleted: false,
                isDisable: false
            }),

            // Total fixed-type products (regardless of sold status)
            SellProduct.countDocuments({
                isDeleted: false,
                isDisable: false,
                saleType: SALE_TYPE.FIXED
            }),

            // Sold products
            SellProduct.countDocuments({
                isDeleted: false,
                isDisable: false,
                saleType: SALE_TYPE.FIXED,
                isSold: true
            }),

            // Unsold products
            SellProduct.countDocuments({
                isDeleted: false,
                isDisable: false,
                saleType: SALE_TYPE.FIXED,
                isSold: false
            }),

            // Live auctions
            SellProduct.countDocuments({
                saleType: SALE_TYPE.AUCTION,
                "auctionSettings.isBiddingOpen": true,
                isDeleted: false,
                isDisable: false
            })
        ]);

        const summary = {
            totalUsers,
            totalThreads,
            totalFixedProducts,
            totalSoldProducts,
            totalUnsoldProducts,
            liveAuctions
        };

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "Dashboard summary fetched successfully",
            summary
        );

    } catch (error) {
        console.error("getDashboardSummary error:", error);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Failed to fetch dashboard summary",
            error.message
        );
    }
};

const adminChangeUserPassword = async (req, res) => {
    try {
        const { userId, newPassword } = req.body;


        if (!userId || !newPassword) {
            return apiErrorRes(
                HTTP_STATUS.NOT_FOUND,
                res,
                "User ID and new password are required"
            );
        }

        if (newPassword.length < 6) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "Password must be at least 6 characters long"
            );

        }

        const user = await User.findById(userId);

        if (!user) {
            return apiErrorRes(
                HTTP_STATUS.NOT_FOUND,
                res,
                "User not found",
                error.message
            );
        }

        // Update password field and save (pre 'save' hook will hash the password)
        user.password = newPassword;
        await user.save();


        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "Password updated successfully"
        );

    } catch (error) {
        console.error("Error in adminChangeUserPassword:", error);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Failed to update password",
            error.message
        );
    }
};



//upload api 
router.post('/upload', upload.single('file'), uploadfile);

// Registration Process
router.post('/requestOtp', perApiLimiter(), upload.none(), requestOtp);
router.post('/verifyOtp', perApiLimiter(), upload.none(), verifyOtp);
router.post('/resendOtp', perApiLimiter(), upload.none(), resendOtp);
router.post('/saveEmailPassword', perApiLimiter(), upload.none(), saveEmailPassword);
router.post('/saveCategories', perApiLimiter(), upload.none(), saveCategories);
router.post('/completeRegistration', perApiLimiter(), upload.single('file'), completeRegistration);
router.get('/getOnboardingStep', perApiLimiter(), upload.none(), getOnboardingStep);

//login 
router.post('/loginStepOne', perApiLimiter(), upload.none(), loginStepOne);
router.post('/loginStepTwo', perApiLimiter(), upload.none(), loginStepTwoPassword);
router.post('/loginStepThree', perApiLimiter(), upload.none(), loginStepThreeVerifyOtp);
router.post('/resendLoginOtp', perApiLimiter(), upload.none(), resendLoginOtp);
router.post('/login', perApiLimiter(), upload.none(), validateRequest(loginSchema), login);
router.post('/loginAsGuest', perApiLimiter(), upload.none(), loginAsGuest);

//RESET PASSWORD 
router.post('/requestResetOtp', perApiLimiter(), upload.none(), requestResetOtp);
router.post('/verifyResetOtp', perApiLimiter(), upload.none(), verifyResetOtp);
router.post('/resetPassword', perApiLimiter(), upload.none(), resetPassword);
router.post('/resendResetOtp', perApiLimiter(), upload.none(), resendResetOtp);
//Follow //Like
router.post('/follow', perApiLimiter(), upload.none(), validateRequest(followSchema), follow);
router.post('/threadlike', perApiLimiter(), upload.none(), validateRequest(threadLikeSchema), threadlike);
router.post('/productLike', perApiLimiter(), upload.none(), validateRequest(productLikeSchema), productLike);
router.get('/getLikedProducts', perApiLimiter(), upload.none(), getLikedProducts)
router.get('/getLikedThreads', perApiLimiter(), upload.none(), getLikedThreads)
//login_user 
router.get('/userList', perApiLimiter(), upload.none(), userList);
router.get('/getProfile', perApiLimiter(), upload.none(), getProfile);
router.post('/updateProfile', perApiLimiter(), upload.none(), updateProfile);
// router.get('/countApi', perApiLimiter(), upload.none(), getProfile);


//updatePhoneNumber 
router.post('/requestPhoneNumberUpdateOtp', perApiLimiter(), upload.none(), requestPhoneNumberUpdateOtp);
router.post('/verifyPhoneNumberUpdateOtp', perApiLimiter(), upload.none(), verifyPhoneNumberUpdateOtp);
router.post('/resendPhoneNumberUpdateOtp', perApiLimiter(), upload.none(), resendPhoneNumberUpdateOtp);

router.post('/hardDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(User));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(User));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(User));
router.get('/getDashboardSummary', perApiLimiter(), upload.none(), getDashboardSummary);



router.post('/adminChangeUserPassword', perApiLimiter(), upload.none(), adminChangeUserPassword);



module.exports = router;
