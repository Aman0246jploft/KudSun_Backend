
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
const { loginSchema, mobileLoginSchema, otpVerification, categorySchema, completeRegistrationSchema, saveEmailPasswords, followSchema, threadLikeSchema, productLikeSchema, requestResetOtpSchema, verifyResetOtpSchema, resetPasswordSchema, loginStepOneSchema, loginStepTwoSchema, loginStepThreeSchema, otpTokenSchema, resendResetOtpSchema, resendOtpSchema } = require('../services/validations/userValidation');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { setKeyWithTime, setKeyNoTime, getKey, removeKey } = require('../services/serviceRedis');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { SALE_TYPE } = require('../../utils/Role');
const SellProducts = require('../../db/models/SellProducts');

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


// const requestOtp = async (req, res) => {
//     try {
//         const { phoneNumber, language } = req.body;
//         const userExists = await User.findOne({ phoneNumber });

//         if (userExists) {
//             return apiErrorRes(
//                 HTTP_STATUS.BAD_REQUEST,
//                 res,
//                 "Phone number already exists",
//                 null
//             );
//         }

//         const otp = process.env.NODE_ENV !== 'production' ? '123456' : generateOTP();
//         const verifyToken = generateKey(); // This will act as the Redis key

//         const redisValue = JSON.stringify({ otp, phoneNumber, language });

//         // Store OTP + phoneNumber under the token key
//         await setKeyWithTime(`verify:${verifyToken}`, redisValue, 500); // Expires in 5 mins

//         return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent", { verifyToken });
//     } catch (error) {
//         return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, null);
//     }
// };

// const verifyOtp = async (req, res) => {
//     try {
//         const { otp, verifyToken } = req.body;



//         const redisData = await getKey(`verify:${verifyToken}`);

//         if (redisData.statusCode !== CONSTANTS.SUCCESS) {
//             return apiErrorRes(
//                 HTTP_STATUS.UNAUTHORIZED,
//                 res,
//                 "Verification token expired or invalid",
//                 null
//             );
//         }

//         const { otp: storedOtp, phoneNumber, language } = JSON.parse(redisData.data);

//         if (otp !== storedOtp) {
//             return apiErrorRes(
//                 HTTP_STATUS.UNAUTHORIZED,
//                 res,
//                 "Invalid OTP",
//                 null
//             );
//         }

//         // Mark phone as verified for next step
//         await setKeyWithTime(`verified:${phoneNumber}`, 'true', 10);
//         await setKeyWithTime(`verified:${phoneNumber}language`, language);
//         await removeKey(`verify:${verifyToken}`);

//         return apiSuccessRes(
//             HTTP_STATUS.OK,
//             res,
//             "OTP verified successfully",
//             { phoneNumber }
//         );
//     } catch (error) {
//         return apiErrorRes(
//             HTTP_STATUS.INTERNAL_SERVER_ERROR,
//             res,
//             error.message,
//             null
//         );
//     }
// };

// const resendOtp = async (req, res) => {
//     try {
//         const { verifyToken } = req.body;

//         // Get existing data from Redis by token
//         const redisData = await getKey(`verify:${verifyToken}`);

//         if (redisData.statusCode !== CONSTANTS.SUCCESS) {
//             return apiErrorRes(
//                 HTTP_STATUS.UNAUTHORIZED,
//                 res,
//                 "Verification token expired or invalid",
//                 null
//             );
//         }

//         const existingData = JSON.parse(redisData.data);
//         const { phoneNumber, language } = existingData;

//         // Generate new OTP
//         const newOtp = process.env.NODE_ENV !== 'production' ? '123457' : generateOTP();

//         // Update Redis with new OTP and same phoneNumber, language, reset expiry to 5 mins again
//         const newRedisValue = JSON.stringify({ otp: newOtp, phoneNumber, language });
//         await setKeyWithTime(`verify:${verifyToken}`, newRedisValue, 500); // 5 minutes TTL

//         // TODO: Trigger actual OTP sending service here if needed (SMS, etc)

//         return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully", { verifyToken });
//     } catch (error) {
//         return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message, null);
//     }
// };

// const saveEmailPassword = async (req, res) => {
//     try {
//         const { phoneNumber, email, password } = await req.body

//         // ✅ Check if phone was verified via OTP
//         const isVerified = await getKey(`verified:${phoneNumber}`);
//         const language = await getKey(`verified:${phoneNumber}language`);
//         if (isVerified.statusCode !== CONSTANTS.SUCCESS) {
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Phone number not verified");
//         }


//         // ✅ Check if email already exists in DB
//         const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
//         if (existingUser) {
//             return apiErrorRes(HTTP_STATUS.CONFLICT, res, "Email already in use");
//         }

//         // ✅ Save to Redis
//         const onboardData = { email: email.toLowerCase().trim(), password, language: language?.data || 'english' };
//         await setKeyNoTime(`onboard:${phoneNumber}`, JSON.stringify(onboardData));

//         return apiSuccessRes(HTTP_STATUS.OK, res, "Email and password saved", { email, phoneNumber });
//     } catch (err) {
//         return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
//     }
// };

// const saveCategories = async (req, res) => {
//     try {
//         const { phoneNumber, categories } = req.body;
//         const data = await getKey(`onboard:${phoneNumber}`);
//         if (data.statusCode !== CONSTANTS.SUCCESS) {
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Missing onboarding session");
//         }
//         const parsed = JSON.parse(data.data);


//         let categoriesArray = [];
//         if (req.body.categories) {
//             const raw = Array.isArray(req.body.categories)
//                 ? req.body.categories
//                 : [req.body.categories];
//             // Clean array: remove empty strings or invalid ObjectId formats
//             categoriesArray = raw
//                 .map(id => id.trim?.()) // optional chaining for safety
//         }

//         parsed.categories = categoriesArray;
//         await setKeyNoTime(`onboard:${phoneNumber}`, JSON.stringify(parsed));
//         return apiSuccessRes(HTTP_STATUS.OK, res, "Categories saved", { phoneNumber, categories });
//     } catch (err) {
//         return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
//     }
// };

// const completeRegistration = async (req, res) => {
//     try {

//         const { phoneNumber, userName, gender, dob } = req.body


//         const onboardingDataResult = await getKey(`onboard:${phoneNumber}`);

//         if (onboardingDataResult.statusCode !== CONSTANTS.SUCCESS) {
//             return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Incomplete onboarding data");
//         }

//         const onboardData = JSON.parse(onboardingDataResult.data);
//         let profileImageUrl = undefined;

//         // ✅ Upload image if exists
//         if (req.file) {


//             const imageResult = await uploadImageCloudinary(req.file, 'profile-images');


//             if (!imageResult) {
//                 return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Image upload failed");
//             }
//             profileImageUrl = imageResult;
//         }


//         let categories = onboardData.categories;
//         if (typeof categories === 'string') {
//             try {
//                 categories = JSON.parse(categories);
//             } catch (e) {
//                 // Fallback if it's not a valid JSON string
//                 categories = categories.split(',').map(item => item.trim());
//             }
//         }

//         let obj = {
//             userName,
//             gender,
//             dob,
//             phoneNumber,
//             categories,
//             email: onboardData.email,
//             password: onboardData.password,
//             profileImage: profileImageUrl || undefined,
//             language: onboardData.language
//         }

//         if (req.body?.fcmToken && req.body?.fcmToken !== "") {
//             obj['fcmToken'] = req.body.fcmToken;
//         }

//         // ✅ Create User
//         const user = new User({
//             ...obj
//         });

//         await user.save();



//         // ✅ Cleanup
//         await removeKey(`onboard:${phoneNumber}`);
//         await removeKey(`verified:${phoneNumber}`);

//         const payload = {
//             email: user.email,
//             userId: user._id,
//             roleId: user.roleId,
//             role: user.role,
//             userName: user.userName
//         };


//         const token = signToken(payload);
//         const output = {
//             token,
//             userId: user._id,
//             roleId: user.roleId,
//             role: user.role,
//             profileImage: user.profileImage,
//             userName: user.userName,
//             email: user.email,
//         };


//         return apiSuccessRes(HTTP_STATUS.CREATED, res, "Registration completed", output);
//     } catch (err) {
//         return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
//     }
// };

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
        return apiSuccessRes(HTTP_STATUS.OK, res, "Phone number already registered", {
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

            // return apiSuccessRes(HTTP_STATUS.OK, res, "Login successful", {
            //     token,
            //     userId: user._id,
            //     roleId: user.roleId,
            //     role: user.role,
            //     profileImage: user.profileImage,
            //     userName: user.userName,
            //     email: user.email,
            // });



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

        // return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified, login successful", {
        //     token,
        //     userId: user._id,
        //     roleId: user.roleId,
        //     role: user.role,
        //     profileImage: user.profileImage,
        //     userName: user.userName,
        //     email: user.email,
        // });


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
router.get('/getProfile', perApiLimiter(), upload.none(), getProfile);
router.get('/countApi', perApiLimiter(), upload.none(), getProfile);


module.exports = router;
