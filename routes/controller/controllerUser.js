const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { User, Follow, ThreadLike, ProductLike, SellProduct, Thread, Order, SellProductDraft, ThreadDraft, TempUser, Bid, UserLocation, ProductReview, BlockUser, SellerVerification } = require('../../db');
const { getDocumentByQuery } = require('../services/serviceGlobalCURD');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const CONSTANTS = require('../../utils/constants')
const HTTP_STATUS = require('../../utils/statusCode');
const { apiErrorRes, verifyPassword, apiSuccessRes, generateOTP, generateKey, toObjectId, isNewItem } = require('../../utils/globalFunction');
const { signToken } = require('../../utils/jwtTokenUtils');
const { loginSchema, followSchema, threadLikeSchema, productLikeSchema, requestResetOtpSchema, verifyResetOtpSchema, resetPasswordSchema, loginStepOneSchema, loginStepTwoSchema, loginStepThreeSchema, otpTokenSchema, resendResetOtpSchema, resendOtpSchema, googleSignInSchema } = require('../services/validations/userValidation');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { setKeyWithTime, setKeyNoTime, getKey, removeKey } = require('../services/serviceRedis');
const { uploadImageCloudinary, deleteImageCloudinary } = require('../../utils/cloudinary');
const { SALE_TYPE, roleId, PAYMENT_STATUS } = require('../../utils/Role');
const SellProducts = require('../../db/models/SellProducts');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const globalCrudController = require('./globalCrudController');
const { default: mongoose } = require('mongoose');
const Joi = require('joi');
// Import Algolia service
const { indexUser, deleteUser } = require('../services/serviceAlgolia');
const { OAuth2Client } = require('google-auth-library');

const uploadfile = async (req, res) => {
    try {
        let profileImageUrl = ""
        // ✅ Upload image if exists
        if (req.file) {
            const validImageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
            if (!validImageTypes.includes(req.file.mimetype)) {
            } else {
                const imageResult = await uploadImageCloudinary(req.file, 'profile-images');
                // console.log("imageResult", imageResult)
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

        if (existingUser.isDisable) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
        }

        if (existingUser.isDeleted) {
            return apiErrorRes(HTTP_STATUS.UNPROCESSABLE_ENTITY, res, CONSTANTS_MSG.ACCOUNT_DELETED);
        }

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

    const newOtp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
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
    let { phoneNumber, userName, gender, dob, fcmToken } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Incomplete onboarding");
    }

    if (userName.length < 3) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Username must be at least 3 characters long.");
    }
    userName = userName.trim().toLowerCase();
    const usernameRegex = /^(?=.*[a-zA-Z])[a-zA-Z0-9@._]+$/;
    if (!usernameRegex.test(userName)) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Username must contain at least one letter and only include letters, numbers, '.', '_', or '@'.");
    }

    const existingUser = await User.findOne({ userName, _id: { $ne: user._id } });
    if (existingUser) {
        return apiErrorRes(HTTP_STATUS.CONFLICT, res, "Username is already in use.");
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

    // 🔍 Index the user in Algolia after successful registration
    try {
        await indexUser(user);
    } catch (algoliaError) {
        console.error('Algolia indexing failed for user:', user._id, algoliaError);
        // Don't fail the main operation if Algolia fails
    }

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

        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedIdentifier);
        const isPhoneNumber = /^\+?\d{7,15}$/.test(cleanedIdentifier);

        let query = {};
        let detectedType = "";
        if (isEmail) {
            query.email = cleanedIdentifier.toLowerCase();
            detectedType = "email";
        } else if (isPhoneNumber) {
            query.phoneNumber = cleanedIdentifier;
            detectedType = "phoneNumber";
        } else {
            query.userName = cleanedIdentifier.toLowerCase();
            detectedType = "userName";
        }


        // const query = {
        //     $or: [
        //         { email: cleanedIdentifier },
        //         { phoneNumber: identifier },
        //         { userName: cleanedIdentifier }
        //     ]
        // };

        const user = await User.findOne(query);

        if (!user) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "User not found");
        }

        if (user.isDisable) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
        }
        if (user.isDeleted) {
            return apiErrorRes(HTTP_STATUS.UNPROCESSABLE_ENTITY, res, CONSTANTS_MSG.ACCOUNT_DELETED);
        }

        if (req.body?.language && req.body.language !== "") {
            user.language = req.body?.language
            user.save()
        }

        // No token needed here, frontend just proceeds with step 2
        let obj = { token: null, ...user.toJSON(), detectedType }

        return apiSuccessRes(HTTP_STATUS.OK, res, "User verified, proceed with login", obj);


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

        const user = await User.findOne(query).select('+password +loginOtp +loginOtpExpiresAt').populate([{ path: 'provinceId', select: 'value' }, { path: 'districtId', select: 'value' }]);




        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }
        if (user.isDisable) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
        }
        if (user.isDeleted) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DELETED);
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


            const totalFollowers = await Follow.countDocuments({
                userId: user._id,
                isDeleted: false,
                isDisable: false
            });
            const totalFollowing = await Follow.countDocuments({
                followedBy: user._id,
                isDeleted: false,
                isDisable: false
            });



            return apiSuccessRes(HTTP_STATUS.OK, res, "Login successful",

                {
                    token,
                    ...user.toJSON(),
                    totalFollowers,
                    totalFollowing
                }
            );





        } else if (loginWithCode === 'true') {
            const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();

            user.loginOtp = otp;
            user.loginOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
            await user.save();

            // console.log(`OTP for ${user.phoneNumber}: ${otp}`);

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

        const user = await User.findOne(query).select('+loginOtp +loginOtpExpiresAt').populate([
            { path: 'provinceId', select: 'value' },
            { path: 'districtId', select: 'value' }
        ]);
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }
        if (user.isDisable) {
            return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
        }
        if (user.isDeleted) {
            return apiErrorRes(HTTP_STATUS.UNPROCESSABLE_ENTITY, res, CONSTANTS_MSG.ACCOUNT_DELETED);
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


        // ✅ Count followers (users who follow this user)
        const totalFollowers = await Follow.countDocuments({
            userId: user._id,
            isDeleted: false,
            isDisable: false
        });

        // ✅ Count following (users this user follows)
        const totalFollowing = await Follow.countDocuments({
            followedBy: user._id,
            isDeleted: false,
            isDisable: false
        });



        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified, login successful",

            {
                token,
                ...user.toJSON(),
                totalFollowers,
                totalFollowing
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
                { phoneNumber: cleanedIdentifier },
                { userName: cleanedIdentifier }
            ]
        };

        const user = await User.findOne(query);
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        const newOtp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();

        user.loginOtp = newOtp;
        user.loginOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await user.save();

        // console.log(`Resent OTP to ${user.phoneNumber}: ${newOtp}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");

    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};



const googleSignIn = async (req, res) => {
    try {
        const { idToken, fcmToken } = req.body;

        if (!idToken) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Google ID token is required");
        }

        // Initialize Google OAuth2 client
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

        // Verify the Google ID token
        let ticket;
        try {
            ticket = await client.verifyIdToken({
                idToken: idToken,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
        } catch (error) {
            console.error('Google token verification failed:', error);
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid Google token");
        }

        const payload = ticket.getPayload();
        const {
            email,
            name,
            picture,
            sub: googleId,
            given_name: firstName,
            family_name: lastName
        } = payload;

        if (!email) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email not provided by Google");
        }

        // Check if user already exists with this email
        let user = await User.findOne({ email: email.toLowerCase() }).populate([
            { path: 'provinceId', select: 'value' },
            { path: 'districtId', select: 'value' }
        ]);

        if (user) {
            // User exists - check if account is disabled or deleted
            if (user.isDisable) {
                return apiErrorRes(HTTP_STATUS.FORBIDDEN, res, CONSTANTS_MSG.ACCOUNT_DISABLE);
            }
            if (user.isDeleted) {
                return apiErrorRes(HTTP_STATUS.UNPROCESSABLE_ENTITY, res, CONSTANTS_MSG.ACCOUNT_DELETED);
            }

            // Update FCM token if provided
            if (fcmToken && fcmToken !== "") {
                user.fcmToken = fcmToken;
            }

            // Update last login and Google profile image if not set
            if (!user.profileImage && picture) {
                user.profileImage = picture;
            }

            await user.save();
        } else {
            // Create new user
            const userName = await generateUniqueUsername(name || email.split('@')[0]);

            user = new User({
                email: email.toLowerCase(),
                userName: userName,
                profileImage: picture || null,
                fcmToken: fcmToken || null,
                step: 5, // Complete registration for Google users
                // Note: No password for Google users - they can only sign in via Google
                // Or you can generate a random password if needed
            });

            await user.save();

            // Index the user in Algolia after successful registration
            try {
                await indexUser(user);
            } catch (algoliaError) {
                console.error('Algolia indexing failed for Google user:', user._id, algoliaError);
                // Don't fail the main operation if Algolia fails
            }

            // Populate location fields for new user
            user = await User.findById(user._id).populate([
                { path: 'provinceId', select: 'value' },
                { path: 'districtId', select: 'value' }
            ]);
        }

        // Get follower counts
        const [totalFollowers, totalFollowing] = await Promise.all([
            Follow.countDocuments({
                userId: user._id,
                isDeleted: false,
                isDisable: false
            }),
            Follow.countDocuments({
                followedBy: user._id,
                isDeleted: false,
                isDisable: false
            })
        ]);

        // Generate JWT token
        const payload_jwt = {
            userId: user._id,
            email: user.email,
            roleId: user.roleId,
            role: user.role,
            userName: user.userName,
            profileImage: user.profileImage
        };

        const token = signToken(payload_jwt);

        // Prepare response
        const userResponse = {
            token,
            ...user.toJSON(),
            totalFollowers,
            totalFollowing
        };

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "Google sign-in successful",
            userResponse
        );

    } catch (error) {
        console.error('Google Sign-In error:', error);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Internal server error",
            error.message
        );
    }
};

// Helper function to generate unique username
const generateUniqueUsername = async (baseName) => {
    let username = baseName.toLowerCase().replace(/[^a-zA-Z0-9@._]/g, '');

    // Ensure username has at least one letter
    if (!/[a-zA-Z]/.test(username)) {
        username = 'user' + username;
    }

    // Ensure minimum length
    if (username.length < 3) {
        username = username + Math.floor(Math.random() * 1000);
    }

    let counter = 0;
    let finalUsername = username;

    while (true) {
        const existingUser = await User.findOne({ userName: finalUsername });
        if (!existingUser) {
            break;
        }
        counter++;
        finalUsername = `${username}${counter}`;
    }

    return finalUsername;
};

const follow = async (req, res) => {
    try {
        let followedBy = req.user.userId
        let { userId } = req.body

        if (String(followedBy) === String(userId)) {
            return apiErrorRes(
                HTTP_STATUS.BAD_REQUEST,
                res,
                "You cannot follow yourself"
            );
        }

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

        const keyword = req.query.keyWord ? req.query.keyWord.trim() : null;

        const sortBy = ["fixedPrice", "commentCount"].includes(req.query.sortBy) ? req.query.sortBy : "createdAt";
        const sortOrder = req.query.orderBy === "asc" ? 1 : -1;

        // Step 1: Get liked product IDs for the user
        const likedDocs = await ProductLike.find({
            likeBy: toObjectId(userId),
            isDisable: false,
            isDeleted: false,
        }).select("productId");

        const likedProductIds = likedDocs.map((doc) => doc.productId);

        if (likedProductIds.length === 0) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "No liked products found", {
                products: [],
                total: 0,
                pageNo: page,
                size: limit
            });
        }

        const query = {
            _id: { $in: likedProductIds },
            isDisable: false,
            isDeleted: false,
        };

        if (keyword) {
            query.$or = [
                { title: { $regex: keyword, $options: "i" } },
                { description: { $regex: keyword, $options: "i" } }
            ];
        }

        const totalCount = await SellProduct.countDocuments(query);

        // Step 2: Aggregate product data with comment stats and user info
        const products = await SellProduct.aggregate([
            { $match: query },
            { $skip: skip },
            { $limit: limit },

            // Lookup user info
            {
                $lookup: {
                    from: "User",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user"
                }
            },
            {
                $addFields: {
                    userId: { $arrayElemAt: ["$user", 0] }
                }
            },
            { $unset: "user" },

            // Lookup comments and associated products
            {
                $lookup: {
                    from: "ProductComment",
                    let: { productId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$product", "$$productId"] },
                                isDisable: false,
                                isDeleted: false
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                commentCount: { $sum: 1 },
                                associatedProducts: { $push: "$associatedProducts" }
                            }
                        },
                        {
                            $project: {
                                commentCount: 1,
                                associatedProductCount: {
                                    $size: {
                                        $filter: {
                                            input: {
                                                $reduce: {
                                                    input: "$associatedProducts",
                                                    initialValue: [],
                                                    in: { $concatArrays: ["$$value", "$$this"] }
                                                }
                                            },
                                            as: "item",
                                            cond: { $ne: ["$$item", null] }
                                        }
                                    }
                                }
                            }
                        }
                    ],
                    as: "commentStats"
                }
            },
            {
                $addFields: {
                    commentCount: {
                        $ifNull: [{ $arrayElemAt: ["$commentStats.commentCount", 0] }, 0]
                    },
                    associatedProductCount: {
                        $ifNull: [{ $arrayElemAt: ["$commentStats.associatedProductCount", 0] }, 0]
                    }
                }
            },
            { $unset: "commentStats" },
            { $sort: { [sortBy]: sortOrder } },
        ]);

        // Step 3: Add totalBids per product (if auction type)
        const productsWithBidCount = await Promise.all(
            products.map(async (product) => {
                const isNew = isNewItem(product.createdAt);
                if (product.saleType === SALE_TYPE.AUCTION) {
                    const bidCount = await Bid.countDocuments({ productId: product._id });
                    return { ...product, totalBids: bidCount, isNew };
                }
                return { ...product, totalBids: 0, isNew };
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

        const sortBy = req.query.sortBy === "commentCount" ? "commentCount" : "createdAt";
        const sortOrder = req.query.orderBy === "asc" ? 1 : -1;

        const keyword = req.query.keyWord ? req.query.keyWord.trim() : null;



        // 1. Find liked thread IDs
        const likedThreadDocs = await ThreadLike.find({
            likeBy: toObjectId(userId),
            isDisable: false,
            isDeleted: false,
        }).select("threadId");

        const likedThreadIds = likedThreadDocs.map(doc => doc.threadId);


        if (likedThreadIds.length === 0) {
            return apiSuccessRes(HTTP_STATUS.OK, res, "No liked threads found", {
                threads: [],
                pagination: { total: 0, page, limit, totalPages: 0 },
            });
        }


        // 2. Build match condition for liked threads and keyword search
        const matchCondition = {
            _id: { $in: likedThreadIds }

        };

        if (keyword) {
            matchCondition.$or = [
                { title: { $regex: keyword, $options: "i" } },
                { content: { $regex: keyword, $options: "i" } }
            ];
        }


        const totalCount = await Thread.countDocuments(matchCondition);
        const pipeline = [
            { $match: matchCondition },

            {
                $lookup: {
                    from: "User",
                    let: { userId: "$userId" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
                        { $project: { _id: 0, userName: 1, profileImage: 1 } }
                    ],
                    as: "user"
                }
            },
            {
                $addFields: {
                    userId: { $arrayElemAt: ["$user", 0] }  // Replace user array with single object in userId field
                }
            },
            {
                $unset: "user"  // Remove the original array
            },



            {
                $lookup: {
                    from: "ThreadComment",
                    let: { threadId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$thread", "$$threadId"] },
                                parent: null,
                                isDisable: false,
                                isDeleted: false
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                commentCount: { $sum: 1 },
                                associatedProducts: {
                                    $push: "$associatedProducts"
                                }
                            }
                        },
                        {
                            $project: {
                                commentCount: 1,
                                associatedProductCount: {
                                    $size: {
                                        $filter: {
                                            input: {
                                                $reduce: {
                                                    input: "$associatedProducts",
                                                    initialValue: [],
                                                    in: { $concatArrays: ["$$value", "$$this"] }
                                                }
                                            },
                                            as: "item",
                                            cond: { $ne: ["$$item", null] }
                                        }
                                    }
                                }
                            }
                        }
                    ],
                    as: "commentStats"
                }
            },
            {
                $addFields: {
                    commentCount: {
                        $ifNull: [{ $arrayElemAt: ["$commentStats.commentCount", 0] }, 0]
                    },
                    associatedProductCount: {
                        $ifNull: [{ $arrayElemAt: ["$commentStats.associatedProductCount", 0] }, 0]
                    }
                }
            },
            {
                $unset: "commentStats"
            }

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

        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
        const redisValue = JSON.stringify({ otp, phoneNumber });

        // Overwrite existing OTP and reset expiry
        await setKeyWithTime(`reset:${phoneNumber}`, redisValue, 5 * 60);

        // Optionally send OTP via SMS here...

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};







const requestResetOtpByEmail = async (req, res) => {
    try {
        const { email } = req.body;
        // console.log(`[RESET OTP] Request received for email: ${email}`);

        if (!email) {
            console.warn(`[RESET OTP] Missing email`);
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email is required");
        }

        const user = await User.findOne({ email });
        if (!user) {
            console.warn(`[RESET OTP] User not found with email: ${email}`);
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User with this email does not exist");
        }

        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
        const redisValue = JSON.stringify({ otp, email });

        await setKeyWithTime(`reset:${email}`, redisValue, 5 * 60);
        // console.log(`[RESET OTP] OTP set in Redis for ${email}: ${otp}`);

        // TODO: Send OTP via email (e.g., sendEmailOtp(email, otp))
        // console.log(`[RESET OTP] OTP (to be sent): ${otp}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent for password reset");
    } catch (error) {
        console.error(`[RESET OTP] Error:`, error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const verifyResetOtpByEmail = async (req, res) => {
    try {
        const { email, otp } = req.body;
        // console.log(`[VERIFY OTP] Request received for email: ${email}, OTP: ${otp}`);

        if (!email || !otp) {
            // console.warn(`[VERIFY OTP] Missing email or OTP`);
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email and OTP are required");
        }

        const redisData = await getKey(`reset:${email}`);
        if (redisData.statusCode !== CONSTANTS.SUCCESS) {
            console.warn(`[VERIFY OTP] OTP not found or expired for email: ${email}`);
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "OTP expired or invalid");
        }

        const { otp: storedOtp } = JSON.parse(redisData.data);
        if (otp !== storedOtp) {
            console.warn(`[VERIFY OTP] Invalid OTP for ${email}. Provided: ${otp}, Expected: ${storedOtp}`);
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
        }

        await setKeyWithTime(`reset-verified:${email}`, 'true', 10 * 60);
        await removeKey(`reset:${email}`);
        // console.log(`[VERIFY OTP] OTP verified successfully for email: ${email}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified successfully");
    } catch (error) {
        console.error(`[VERIFY OTP] Error:`, error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const resetPasswordByEmail = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;
        // console.log(`[RESET PASSWORD] Request received for email: ${email}`);

        const isVerified = await getKey(`reset-verified:${email}`);
        // console.log(`[RESET PASSWORD] Redis verification status for ${email}:`, isVerified);

        if (isVerified.statusCode !== CONSTANTS.SUCCESS) {
            console.warn(`[RESET PASSWORD] OTP not verified or expired for ${email}`);
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "OTP not verified or session expired");
        }

        if (!newPassword || !confirmPassword || newPassword !== confirmPassword) {
            console.warn(`[RESET PASSWORD] Passwords do not match or missing`);
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "New password and confirm password must match");
        }

        const user = await User.findOne({ email });
        if (!user) {
            console.warn(`[RESET PASSWORD] User not found with email: ${email}`);
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        user.password = newPassword;
        await user.save();
        await removeKey(`reset-verified:${email}`);

        // console.log(`[RESET PASSWORD] Password reset successful for email: ${email}`);
        return apiSuccessRes(HTTP_STATUS.OK, res, "Password has been reset successfully");
    } catch (error) {
        console.error(`[RESET PASSWORD] Error:`, error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const resendResetOtpByEmail = async (req, res) => {
    try {
        const { email } = req.body;
        // console.log(`[RESEND OTP] Request received for email: ${email}`);

        if (!email) {
            console.warn(`[RESEND OTP] Missing email`);
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email is required");
        }

        const user = await User.findOne({ email });
        if (!user) {
            console.warn(`[RESEND OTP] User not found for email: ${email}`);
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
        const redisValue = JSON.stringify({ otp, email });

        await setKeyWithTime(`reset:${email}`, redisValue, 5 * 60);
        // console.log(`[RESEND OTP] New OTP set for ${email}: ${otp}`);

        // TODO: Send OTP via email (e.g., sendEmailOtp(email, otp))
        // console.log(`[RESEND OTP] OTP (to be sent): ${otp}`);

        return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");
    } catch (error) {
        console.error(`[RESEND OTP] Error:`, error);
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

        const user = await User.findById(userId).populate([{ path: "provinceId", select: "value" }, { path: "districtId", select: "value" }]).lean();
        if (!user) {
            return apiErrorRes(
                HTTP_STATUS.NOT_FOUND,
                res,
                "User not found"
            );
        }



        const [myThreadCount, productListed, boughtCount, sellCount, ThreadDraftCount, ProductDraftCount, ThreadLikes, productLike, sellerVerification] = await Promise.all([

            Thread.countDocuments({ userId, isDeleted: false }),
            SellProducts.countDocuments({ userId, isDeleted: false }),
            Order.countDocuments({ userId, isDeleted: false }),

            Order.countDocuments({
                sellerId: userId,
                isDeleted: false,
                paymentStatus: PAYMENT_STATUS.COMPLETED
            }),
            ThreadDraft.countDocuments({ userId, isDeleted: false }),
            SellProductDraft.countDocuments({ userId, isDeleted: false }),

            ThreadLike.countDocuments({ likeBy: toObjectId(userId), isDeleted: false }),
            ProductLike.countDocuments({ likeBy: toObjectId(userId), isDeleted: false }),
            SellerVerification.findOne({
                userId: toObjectId(userId)
            }).sort({ createdAt: -1 })
        ]);

        const sellerVerificationStatus = !sellerVerification || sellerVerification.verificationStatus !== "Approved";

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
            is_Verified_Seller: sellerVerificationStatus,
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
            provinceId: user?.provinceId,
            districtId: user?.districtId,
            dealChatnotification: user?.dealChatnotification,
            activityNotification: user?.activityNotification,
            alertNotification: user?.alertNotification,
            walletBalance: parseFloat(Number(user?.walletBalance).toFixed(2))

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

            userName = userName.trim().toLowerCase();
            if (userName.length < 3) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Username must be at least 3 characters long.");
            }

            const usernameRegex = /^(?=.*[a-zA-Z])[a-zA-Z0-9@._]+$/;

            if (!usernameRegex.test(userName)) {
                return apiErrorRes(
                    HTTP_STATUS.BAD_REQUEST,
                    res,
                    "Username must contain at least one letter and only include letters, numbers, '.', '_', or '@'."
                );
            }
            const existingUser = await User.findOne({ userName, _id: { $ne: userId } });
            if (existingUser) {
                return apiErrorRes(HTTP_STATUS.CONFLICT, res, "Username is already in use.");
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


        let profileImage = null;
        if (req.file) {
            const user = await User.findById(userId);
            if (user?.profileImage) {
                await deleteImageCloudinary(user.profileImage);
            }
            profileImage = await uploadImageCloudinary(req.file, "user-profiles");
        }

        // Prepare update payload
        const updateData = {
            ...other,
            ...(userName && { userName: userName.toLowerCase() }),
            ...(email && { email: email.toLowerCase() }),
            ...(profileImage && { profileImage })
        };

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        ).populate([{ path: "provinceId", select: "value" }, { path: "districtId", select: "value" }]).select('-password');

        // 🔍 Update the user in Algolia after successful profile update
        try {
            await indexUser(updatedUser);
        } catch (algoliaError) {
            console.error('Algolia update failed for user:', updatedUser._id, algoliaError);
            // Don't fail the main operation if Algolia fails
        }

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



        if (!savedOtp?.data) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "OTP expired or not requested");
        }

        if (savedOtp?.data !== otp) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid OTP");
        }

        // Update phone number
        await User.findByIdAndUpdate(
            userId,
            { phoneNumber: phoneNumber.toLowerCase() }
        );

        const updatedUser = await User.findById(userId)
            .populate([
                { path: "provinceId", select: "value" },
                { path: "districtId", select: "value" }
            ])
            .select("-password");

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
        const newOtp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();

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
            isDisable,
            showSellerRequests = false,
            isFlagedReported = false,
            showReported = false,
            registrationDateStart,
            sortBy = "createdAt",
            sortOrder = "asc",
            registrationDateEnd,
            reported,
        } = req.query;

        const sortStage = {};
        const order = sortOrder === "desc" ? -1 : 1;
        sortStage[sortBy] = order;

        const query = {
            isDeleted: false,
            roleId: { $nin: [roleId.SUPER_ADMIN, roleId.GUEST] },
        };

        if (isFlagedReported === true || isFlagedReported === "true") {
            query["isFlagedReported"] = true;
        }



        if (keyWord) {
            const regex = new RegExp(keyWord, "i");
            query.$or = [
                { userName: regex },
                { email: regex },
                { phoneNumber: regex },
            ];
        }


        if (typeof isDisable !== "undefined") {
            query.isDisable = isDisable === "true"; // 👈 added this block
        }

        if (status) {
            query.status = status;
        }

        if (showReported === "true") {
            query.reportCount = { $gt: 0 };
        }

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
                    endDate.setHours(23, 59, 59, 999);
                    query.createdAt.$lte = endDate;
                }
            }
            if (Object.keys(query.createdAt).length === 0) {
                delete query.createdAt;
            }
        }


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
                    from: "Location",
                    localField: "provinceId",
                    foreignField: "_id",
                    as: "province",
                },
            },
            {
                $addFields: {
                    "userAddress.province": { $arrayElemAt: ["$province", 0] },
                },
            },
            {
                $lookup: {
                    from: "Location",
                    localField: "districtId",
                    foreignField: "_id",
                    as: "district",
                },
            },
            {
                $addFields: {
                    "userAddress.district": { $arrayElemAt: ["$district", 0] },
                },
            },


            {
                $lookup: {
                    from: "ReportUser",
                    let: { userId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$userId", "$$userId"] },
                                isDisable: false,
                            },
                        },
                    ],
                    as: "reports",
                },
            },
            {
                $addFields: {
                    reportCount: { $size: "$reports" },
                },
            },


        ];

        if (reported === "true") {
            aggregation.push({
                $match: {
                    reportCount: { $gt: 0 },
                },
            });
        }


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
                profileImage: 1,
                averageBuyerRatting: 1,
                averageRatting: 1,
                gender: 1,
                dob: 1,
                isDisable: 1,
                is_Verified_Seller: 1,
                is_Id_verified: 1,
                is_Preferred_seller: 1,
                createdAt: 1,
                sellerVerificationStatus: 1,
                sellerVerification: 1,
                isLive: 1,
                reportCount: 1,
                isFlagedReported: 1,
                userAddress: {
                    province: {
                        _id: "$userAddress.province._id",
                        name: "$userAddress.province.value",
                    },
                    district: {
                        _id: "$userAddress.district._id",
                        name: "$userAddress.district.value",
                    },
                },
            },
        });

        const totalUsersAgg = await User.aggregate([...aggregation, { $count: "total" }]);
        const total = totalUsersAgg[0]?.total || 0;

        const users = await User.aggregate([
            ...aggregation,
            { $sort: sortStage },
            { $skip: (parseInt(pageNo, 10) - 1) * parseInt(size, 10) },
            { $limit: parseInt(size, 10) },
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Users fetched successfully", {
            total,
            pageNo: parseInt(pageNo, 10),
            size: parseInt(size, 10),
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
                // isDisable: false,
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

const getOtherProfile = async (req, res) => {
    try {
        const userId = req.params.id;
        const currentUser = req.user.userId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid userId");
        }

        // 1. Get user basic info
        const user = await User.findById(userId).populate([{ path: "provinceId", select: "value" }, { path: "districtId", select: "value" }]).select('-password -otp -__v');
        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }


        // 2. Get follower and following counts
        const [totalFollowers, totalFollowing] = await Promise.all([
            Follow.countDocuments({ userId: userId, isDeleted: false, isDisable: false }),
            Follow.countDocuments({ followedBy: userId, isDeleted: false, isDisable: false })
        ]);


        // 3. Check if currentUser follows the profile user
        const isFollow = await Follow.exists({
            userId: userId,
            followedBy: currentUser,
            isDeleted: false,
            isDisable: false
        });


        const [totalThreads, totalProducts, totalReviews] = await Promise.all([
            Thread.countDocuments({ userId, isDeleted: false, isDisable: false }),
            SellProduct.countDocuments({ userId, isDeleted: false, isDisable: false, }),
            ProductReview.countDocuments({ otheruserId: userId, isDeleted: false, isDisable: false })
        ]);
        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            "User Info",
            {
                _id: user._id,
                userName: user.userName,
                profileImage: user.profileImage,
                dob: user?.dob,
                gender: user?.gender,
                is_Id_verified: user.is_Id_verified,
                is_Verified_Seller: user.is_Verified_Seller,
                is_Preferred_seller: user.is_Preferred_seller,
                totalFollowers,
                totalFollowing,
                totalThreads,
                totalProducts,
                totalReviews,
                province: user?.provinceId?.value,
                district: user?.districtId?.value || null,
                isFollow: Boolean(isFollow),
                myAccount: userId.toString() == currentUser

            }
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


const getFollowingList = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.userId;

        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid userId");
        }

        const followings = await Follow.find({
            followedBy: targetUserId,
            isDeleted: false,
            isDisable: false
        }).populate({
            path: 'userId',
            select: '_id userName profileImage provinceId districtId',
            populate: [
                {
                    path: 'provinceId',
                    select: '_id value'
                },
                {
                    path: 'districtId',
                    select: '_id value'
                }
            ]
        });

        const result = [];

        for (const follow of followings) {
            const user = follow.userId;

            if (!user) {
                result.push({
                    _id: null,
                    userName: null,
                    profileImage: null,
                    isFollowed: false,
                    province: null,
                    district: null,
                    totalFollowers: 0
                });
                continue;
            }

            const [isFollowed, totalFollowers] = await Promise.all([
                Follow.exists({
                    userId: user._id,
                    followedBy: currentUserId,
                    isDeleted: false,
                    isDisable: false
                }),
                Follow.countDocuments({
                    userId: user._id,
                    isDeleted: false,
                    isDisable: false
                })
            ]);

            result.push({
                _id: user._id || null,
                userName: user.userName || null,
                profileImage: user.profileImage || null,
                isFollowed: !!isFollowed,
                province: user.provinceId?.value || null,
                district: user.districtId?.value || null,
                totalFollowers
            });
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Following list", result);
    } catch (error) {
        console.error("Error in getFollowingList:", error);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Failed to fetch followings",
            error.message
        );
    }
};


const getFollowersList = async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.user.userId;

        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid userId");
        }

        const followers = await Follow.find({
            userId: targetUserId,
            isDeleted: false,
            isDisable: false
        }).populate({
            path: 'followedBy',
            select: '_id userName profileImage provinceId districtId',
            populate: [
                {
                    path: 'provinceId',
                    select: '_id value'
                },
                {
                    path: 'districtId',
                    select: '_id value'
                }
            ]
        });

        const result = [];

        for (const follow of followers) {
            const user = follow.followedBy;

            if (!user) {
                result.push({
                    _id: null,
                    userName: null,
                    profileImage: null,
                    isFollowed: false,
                    province: null,
                    district: null,
                    totalFollowers: 0
                });
                continue;
            }

            const [isFollowed, totalFollowers] = await Promise.all([
                Follow.exists({
                    userId: user._id,
                    followedBy: currentUserId,
                    isDeleted: false,
                    isDisable: false
                }),
                Follow.countDocuments({
                    userId: user._id,
                    isDeleted: false,
                    isDisable: false
                })
            ]);

            result.push({
                _id: user._id || null,
                userName: user.userName || null,
                profileImage: user.profileImage || null,
                isFollowed: !!isFollowed,
                province: user.provinceId?.value || null,
                district: user.districtId?.value || null,
                totalFollowers
            });
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Followers list", result);
    } catch (error) {
        console.error("Error in getFollowersList:", error);
        return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Failed to fetch followers",
            error.message
        );
    }
};


const updatePassword = async (req, res) => {
    try {
        const schema = Joi.object({
            oldPassword: Joi.string().required(),
            newPassword: Joi.string().min(6).required(),
            confirmPassword: Joi.ref('newPassword'),
        }).with('newPassword', 'confirmPassword');

        const { error, value } = schema.validate(req.body);
        if (error) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.details[0].message);
        }

        const { oldPassword, newPassword } = value;
        const userId = req.user?.userId; // Assuming `req.user` is set by auth middleware

        const user = await getDocumentByQuery(User, { _id: toObjectId(userId) });
        if (!user) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, 'User not found');
        }



        // ✅ Continue with password verification
        const isMatch = await verifyPassword(
            user?.data?.password,
            oldPassword
        );
        if (!isMatch) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Old password is incorrect');
        }

        if (oldPassword === newPassword) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'New password must be different from old password');
        }

        user.data.password = newPassword;
        await user?.data?.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Password updated successfully');
    } catch (err) {
        console.error('updatePassword error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};


const deleteAccount = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const user = await getDocumentByQuery(User, { _id: userId, isDeleted: false });
        if (user.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'User not found or already deleted');
        }
        user.data.isDeleted = true
        await user.data.save();
        return apiSuccessRes(HTTP_STATUS.OK, res, 'Account deleted successfully');
    } catch (err) {
        console.error('updatePassword error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
}


const blockUser = async (req, res) => {
    try {
        const blockBy = req.user.userId; // from auth middleware
        const { userId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(blockBy) || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ status: false, message: "Invalid user IDs." });
        }
        if (blockBy === userId) {
            return res.status(400).json({ status: false, message: "You cannot block yourself." });
        }
        const existingBlock = await BlockUser.findOne({ blockBy, userId });
        if (existingBlock) {
            await BlockUser.deleteOne({ _id: existingBlock._id });
            return apiSuccessRes(HTTP_STATUS.OK, res, 'User unblocked successfully.');
        } else {
            const newBlock = new BlockUser({ blockBy, userId });
            await newBlock.save();
            return apiSuccessRes(HTTP_STATUS.OK, res, 'User blocked successfully.');
        }

    } catch (err) {
        console.error('updatePassword error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
}






const getBlockedUsers = async (req, res) => {
    try {
        const blockBy = req.user.userId;

        if (!mongoose.Types.ObjectId.isValid(blockBy)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid user ID.");
        }

        // Step 1: Get blocked users
        const blockedList = await BlockUser.find({ blockBy }).populate({
            path: "userId",
            select: "name username email profileImage provinceId districtId",
            populate: [
                { path: "provinceId", select: "value" },
                { path: "districtId", select: "value" },
            ],
        });

        // Step 2: Get follower counts
        const userIds = blockedList.map(item => item.userId?._id).filter(Boolean);

        const followerCounts = await Follow.aggregate([
            {
                $match: {
                    userId: { $in: userIds },
                    isDisable: false,
                    isDeleted: false,
                },
            },
            {
                $group: {
                    _id: "$userId",
                    count: { $sum: 1 },
                },
            },
        ]);

        const countMap = {};
        followerCounts.forEach(fc => {
            countMap[fc._id.toString()] = fc.count;
        });

        // Step 3: Build response
        const result = blockedList.map((item) => {
            const user = item.userId;
            const userIdStr = user?._id?.toString();
            return {
                _id: user?._id,
                name: user?.name,
                username: user?.username,
                email: user?.email,
                profileImage: user?.profileImage,
                province: user?.provinceId?.value || null,
                district: user?.districtId?.value || null,
                followerCount: countMap[userIdStr] || 0,
                blockedAt: item.createdAt,
            };
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, "Blocked users fetched successfully", result);
    } catch (err) {
        console.error("getBlockedUsers error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};



const getUserNotificationSettings = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Try to find user selecting only the notification fields
        let user = await User.findById(userId).select("dealChatnotification activityNotification alertNotification");

        if (!user) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
        }

        // Check if any field is missing or undefined
        let shouldUpdate = false;
        const updateFields = {};

        if (user.dealChatnotification === undefined) {
            updateFields.dealChatnotification = true;
            shouldUpdate = true;
        }
        if (user.activityNotification === undefined) {
            updateFields.activityNotification = true;
            shouldUpdate = true;
        }
        if (user.alertNotification === undefined) {
            updateFields.alertNotification = true;
            shouldUpdate = true;
        }

        if (shouldUpdate) {
            user = await User.findByIdAndUpdate(
                userId,
                { $set: updateFields },
                { new: true, select: "dealChatnotification activityNotification alertNotification" }
            );
        }
        return apiSuccessRes(HTTP_STATUS.OK, res, "Notification List", user);

    } catch (err) {
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(apiErrorRes(CONSTANTS_MSG.INTERNAL_SERVER_ERROR));

    }
};




const updateUserNotificationSettings = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Validation schema - only these three boolean fields allowed
        const schema = Joi.object({
            dealChatnotification: Joi.boolean().optional(),
            activityNotification: Joi.boolean().optional(),
            alertNotification: Joi.boolean().optional(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json(apiErrorRes(error.details[0].message));
        }

        // Update only those fields in user document
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: value },
            { new: true, select: "dealChatnotification activityNotification alertNotification" }
        );

        if (!updatedUser) {
            return res.status(HTTP_STATUS.NOT_FOUND).json(apiErrorRes("User not found"));
        }
        return apiSuccessRes(HTTP_STATUS.OK, res, "Notification settings updated successfully", updatedUser);


    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);


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
router.post('/googleSignIn', perApiLimiter(), upload.none(), validateRequest(googleSignInSchema), googleSignIn);

//RESET PASSWORD 
router.post('/requestResetOtp', perApiLimiter(), upload.none(), requestResetOtp);
router.post('/verifyResetOtp', perApiLimiter(), upload.none(), verifyResetOtp);
router.post('/resetPassword', perApiLimiter(), upload.none(), resetPassword);
router.post('/resendResetOtp', perApiLimiter(), upload.none(), resendResetOtp);
//for email
router.post('/requestResetOtpByEmail', perApiLimiter(), upload.none(), requestResetOtpByEmail);
router.post('/verifyResetOtpByEmail', perApiLimiter(), upload.none(), verifyResetOtpByEmail);
router.post('/resetPasswordByEmail', perApiLimiter(), upload.none(), resetPasswordByEmail);
router.post('/resendResetOtpByEmail', perApiLimiter(), upload.none(), resendResetOtpByEmail);
//
router.post('/updatePassword', perApiLimiter(), upload.none(), updatePassword);
router.post('/deleteAccount', perApiLimiter(), upload.none(), deleteAccount);


//Follow //Like
router.post('/follow', perApiLimiter(), upload.none(), validateRequest(followSchema), follow);
router.post('/threadlike', perApiLimiter(), upload.none(), threadlike);
router.post('/productLike', perApiLimiter(), upload.none(), validateRequest(productLikeSchema), productLike);
router.get('/getLikedProducts', perApiLimiter(), upload.none(), getLikedProducts)
router.get('/getLikedThreads', perApiLimiter(), upload.none(), getLikedThreads)
//login_user 
router.get('/userList', perApiLimiter(), upload.none(), userList);
router.get('/getProfile', perApiLimiter(), upload.none(), getProfile);
router.post('/updateProfile', perApiLimiter(), upload.single("profileImage"), updateProfile);
// router.get('/countApi', perApiLimiter(), upload.none(), getProfile);


router.get('/getOtherProfile/:id', perApiLimiter(), upload.none(), getOtherProfile);
router.get('/getFollowersList/:id', perApiLimiter(), upload.none(), getFollowersList);
router.get('/getFollowingList/:id', perApiLimiter(), upload.none(), getFollowingList);



//updatePhoneNumber 
router.post('/requestPhoneNumberUpdateOtp', perApiLimiter(), upload.none(), requestPhoneNumberUpdateOtp);
router.post('/verifyPhoneNumberUpdateOtp', perApiLimiter(), upload.none(), verifyPhoneNumberUpdateOtp);
router.post('/resendPhoneNumberUpdateOtp', perApiLimiter(), upload.none(), resendPhoneNumberUpdateOtp);

router.post('/hardDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(User));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(User));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(User));
router.get('/getDashboardSummary', perApiLimiter(), upload.none(), getDashboardSummary);



router.post('/adminChangeUserPassword', perApiLimiter(), upload.none(), adminChangeUserPassword);


//Block User

router.post('/blockUser', perApiLimiter(), upload.none(), blockUser);
router.get('/getBlockedUsers', perApiLimiter(), upload.none(), getBlockedUsers);


router.get('/getUserNotificationSettings', perApiLimiter(), upload.none(), getUserNotificationSettings);
router.post('/updateUserNotificationSettings', perApiLimiter(), upload.none(), updateUserNotificationSettings);



//NotifiactionTable



module.exports = router;
