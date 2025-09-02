const express = require("express");
const multer = require("multer");
const upload = multer();
const router = express.Router();
const {
  User,
  Follow,
  ThreadLike,
  ProductLike,
  SellProduct,
  Thread,
  Order,
  SellProductDraft,
  ThreadDraft,
  TempUser,
  Bid,
  UserLocation,
  ProductReview,
  BlockUser,
  SellerVerification,
  ThreadComment,
} = require("../../db");
const { getDocumentByQuery } = require("../services/serviceGlobalCURD");
const CONSTANTS_MSG = require("../../utils/constantsMessage");
const CONSTANTS = require("../../utils/constants");
const HTTP_STATUS = require("../../utils/statusCode");
const axios = require("axios");
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const {
  apiErrorRes,
  verifyPassword,
  apiSuccessRes,
  generateOTP,
  generateKey,
  toObjectId,
  isNewItem,
  getBlockedUserIds,
} = require("../../utils/globalFunction");
const { signToken } = require("../../utils/jwtTokenUtils");
const {
  loginSchema,
  followSchema,
  threadLikeSchema,
  productLikeSchema,
  requestResetOtpSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  loginStepOneSchema,
  loginStepTwoSchema,
  loginStepThreeSchema,
  otpTokenSchema,
  resendResetOtpSchema,
  resendOtpSchema,
  googleSignInSchema,
} = require("../services/validations/userValidation");
const validateRequest = require("../../middlewares/validateRequest");
const perApiLimiter = require("../../middlewares/rateLimiter");
const {
  setKeyWithTime,
  setKeyNoTime,
  getKey,
  removeKey,
} = require("../services/serviceRedis");
const {
  uploadImageCloudinary,
  deleteImageCloudinary,
} = require("../../utils/cloudinary");
const {
  SALE_TYPE,
  roleId,
  PAYMENT_STATUS,
  NOTIFICATION_TYPES,
  createStandardizedNotificationMeta,
} = require("../../utils/Role");
const SellProducts = require("../../db/models/SellProducts");
const {
  moduleSchemaForId,
} = require("../services/validations/globalCURDValidation");
const globalCrudController = require("./globalCrudController");
const { default: mongoose } = require("mongoose");
const Joi = require("joi");
// Import Algolia service
const {
  indexUser,
  deleteUser,
  deleteUsers,
  deleteThreads,
  deleteProducts,
} = require("../services/serviceAlgolia");
const { OAuth2Client } = require("google-auth-library");
const { saveNotification } = require("../services/serviceNotification");
const { sendOtpSMS } = require("../services/twilioService");
const { sendEmail } = require("../../utils/emailService");

const getAssociatedProductIdsFromThread = async (threadId) => {
  // Step 1: Get product IDs from the thread itself
  const thread = await Thread.findById(threadId)
    .select("associatedProducts")
    .lean();
  const threadProductIds =
    thread?.associatedProducts?.map((id) => id.toString()) || [];

  // Step 2: Get product IDs from thread comments
  const commentAgg = await ThreadComment.aggregate([
    { $match: { thread: toObjectId(threadId) } },
    { $project: { associatedProducts: 1 } },
    { $unwind: "$associatedProducts" },
    { $group: { _id: null, productIds: { $addToSet: "$associatedProducts" } } },
  ]);
  const commentProductIds =
    commentAgg[0]?.productIds?.map((id) => id.toString()) || [];

  // Step 3: Combine and deduplicate
  const combinedIds = [...new Set([...threadProductIds, ...commentProductIds])];

  if (combinedIds.length === 0) return [];

  // Step 4: Filter to only existing product IDs in SellProduct
  const existingProducts = await SellProduct.find({
    _id: { $in: combinedIds.map(toObjectId) },
  })
    .select("_id")
    .lean();
  const validIds = existingProducts.map((p) => p._id);

  return validIds;
};

const uploadfile = async (req, res) => {
  try {
    let profileImageUrl = "";
    // ✅ Upload image if exists
    if (req.file) {
      const validImageTypes = [
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp",
      ];
      if (!validImageTypes.includes(req.file.mimetype)) {
      } else {
        const imageResult = await uploadImageCloudinary(
          req.file,
          "profile-images"
        );
        // console.log("imageResult", imageResult)
        if (!imageResult) {
          return apiErrorRes(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            res,
            "Image upload failed"
          );
        }
        profileImageUrl = imageResult;
      }
    }
    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      CONSTANTS_MSG.SUCCESS,
      profileImageUrl
    );
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      error.message,
      error.message
    );
  }
};

const getUserResponse = (user) => {
  return {
    token: null,
    ...user.toJSON(),
  };
};

const requestOtp = async (req, res) => {
  const { phoneNumber, language } = req.body;

  // Check if user exists in main User collection
  const existingUser = await User.findOne({ phoneNumber });
  if (existingUser) {
    if (existingUser.isDisable) {
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        CONSTANTS_MSG.ACCOUNT_DISABLE
      );
    }

    if (existingUser.isDeleted) {
      return apiErrorRes(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        res,
        CONSTANTS_MSG.ACCOUNT_DELETED
      );
    }

    return apiErrorRes(HTTP_STATUS.OK, res, "Phone number already registered", {
      phoneNumber,
      step: existingUser.step || 5, // 5 or whatever means completed
    });
  }

  // Check if temp user exists, reuse OTP and step
  let tempUser = await TempUser.findOne({ phoneNumber });

  if (!tempUser) {
    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

    tempUser = new TempUser({
      phoneNumber,
      language,
      tempOtp: otp,
      step: 1,
      tempOtpExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // expires in 5 min
    });

    await tempUser.save();
  }

  return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent", {
    phoneNumber,
    step: 1,
  });
};

const verifyOtp = async (req, res) => {
  const { phoneNumber, otp } = req.body;

  const tempUser = await TempUser.findOne({ phoneNumber });
  if (!tempUser || tempUser.tempOtp !== otp) {
    return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
  }

  tempUser.step = 2;
  await tempUser.save();

  return apiSuccessRes(HTTP_STATUS.OK, res, "OTP verified", {
    phoneNumber,
    step: 2,
  });
};

const resendOtp = async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return apiErrorRes(
      HTTP_STATUS.BAD_REQUEST,
      res,
      "Phone number is required"
    );
  }

  const tempUser = await TempUser.findOne({ phoneNumber });

  if (!tempUser) {
    return apiErrorRes(
      HTTP_STATUS.NOT_FOUND,
      res,
      "User not found for OTP resend"
    );
  }

  if (tempUser.step >= 2) {
    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "OTP already verified");
  }

  const newOtp =
    process.env.NODE_ENV !== "production" ? "123456" : generateOTP();
  tempUser.tempOtp = newOtp;
  tempUser.tempOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await tempUser.save();
  const smsResult = await sendOtpSMS(phoneNumber, newOtp);
  if (!smsResult.success) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to resend OTP via SMS"
    );
  }

  // Send OTP via SMS/email here...

  return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully", {
    phoneNumber,
    step: tempUser.step,
  });
};

const saveEmailPassword = async (req, res) => {
  const { phoneNumber, email, password } = req.body;

  const tempUser = await TempUser.findOne({ phoneNumber });
  if (!tempUser || tempUser.step !== 2) {
    return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "OTP not verified");
  }

  const existingUser = await User.findOne({
    email: email.toLowerCase().trim(),
  });
  if (existingUser) {
    return apiErrorRes(HTTP_STATUS.CONFLICT, res, "Email already in use");
  }

  tempUser.email = email.toLowerCase().trim();
  tempUser.password = password;
  tempUser.step = 3;
  await tempUser.save();

  return apiSuccessRes(HTTP_STATUS.OK, res, "Email and password saved", {
    phoneNumber,
    step: 3,
  });
};

const saveCategories = async (req, res) => {
  const { phoneNumber, categories } = req.body;

  const tempUser = await TempUser.findOne({ phoneNumber });
  if (!tempUser || tempUser.step !== 3) {
    return apiErrorRes(
      HTTP_STATUS.BAD_REQUEST,
      res,
      "Complete previous step first"
    );
  }

  tempUser.categories = Array.isArray(categories) ? categories : [categories];
  tempUser.step = 4;
  await tempUser.save();

  return apiSuccessRes(HTTP_STATUS.OK, res, "Categories saved", {
    phoneNumber,
    step: 4,
  });
};

const getOnboardingStep = async (req, res) => {
  const { phoneNumber } = req.query;
  const user = await User.findOne({ phoneNumber });
  if (!user) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");

  return apiSuccessRes(HTTP_STATUS.OK, res, "Current onboarding step", {
    phoneNumber,
    step: user.step,
  });
};

const completeRegistration = async (req, res) => {
  const { phoneNumber, fcmToken, userName, gender, dob } = req.body;

  const tempUser = await TempUser.findOne({ phoneNumber });
  if (!tempUser || tempUser.step !== 4) {
    return apiErrorRes(
      HTTP_STATUS.BAD_REQUEST,
      res,
      "Incomplete registration steps"
    );
  }

  const existingUser = await User.findOne({
    $or: [{ email: tempUser.email }, { phoneNumber: tempUser.phoneNumber }],
  });

  if (existingUser) {
    return apiErrorRes(HTTP_STATUS.CONFLICT, res, "User already exists");
  }

  let obj = {
    phoneNumber: tempUser.phoneNumber,
    email: tempUser.email,
    userName: userName,
    gender: gender,
    dob: dob,
    password: tempUser.password,
    language: tempUser.language,
    categories: tempUser.categories || [],
    step: 5,
    fcmToken: fcmToken || null,
  };

  if (req.file) {
    const imageUrl = await uploadImageCloudinary(req.file, "profile-images");
    obj.profileImage = imageUrl;
  }

  const user = new User(obj);

  const payload = {
    userId: user._id,
    email: user.email,
    roleId: user.roleId,
    role: user.role,
    userName: user.userName,
  };
  const token = signToken(payload);

  await user.save();
  try {
    await indexUser(user);
  } catch (algoliaError) {
    console.error("Algolia indexing failed for user:", user._id, algoliaError);
    // Don't fail the main operation if Algolia fails
  }

  await TempUser.deleteOne({ phoneNumber });

  return apiSuccessRes(HTTP_STATUS.OK, res, "Registration completed", {
    token,
    ...user.toJSON(),
  });
};

const loginStepOne = async (req, res) => {
  try {
    const { identifier } = req.body; // email, phoneNumber, or userName
    if (!identifier) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Identifier is required"
      );
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
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        CONSTANTS_MSG.ACCOUNT_DISABLE
      );
    }
    if (user.isDeleted) {
      return apiErrorRes(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        res,
        CONSTANTS_MSG.ACCOUNT_DELETED
      );
    }

    if (req.body?.language && req.body.language !== "") {
      user.language = req.body?.language;
      user.save();
    }

    // No token needed here, frontend just proceeds with step 2
    let obj = { token: null, ...user.toJSON(), detectedType };

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "User verified, proceed with login",
      obj
    );
  } catch (error) {
    console.error("Login Step 1 error:", error);
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};

const loginStepTwoPassword = async (req, res) => {
  try {
    const { identifier, password, fcmToken, loginWithCode } = req.body;
    if (!identifier) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Identifier is required"
      );
    }

    if (password && loginWithCode === "true") {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Password is required when loginWithCode is false"
      );
    }

    const cleanedIdentifier = identifier.trim().toLowerCase();

    const query = {
      $or: [
        { email: cleanedIdentifier },
        { phoneNumber: identifier },
        { userName: cleanedIdentifier },
      ],
    };

    const user = await User.findOne(query)
      .select("+password +loginOtp +loginOtpExpiresAt")
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ]);

    if (!user) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
    }
    if (user.isDisable) {
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        CONSTANTS_MSG.ACCOUNT_DISABLE
      );
    }
    if (user.isDeleted) {
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        CONSTANTS_MSG.ACCOUNT_DELETED
      );
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
        userName: user.userName,
      });

      const totalFollowers = await Follow.countDocuments({
        userId: user._id,
        isDeleted: false,
        isDisable: false,
      });
      const totalFollowing = await Follow.countDocuments({
        followedBy: user._id,
        isDeleted: false,
        isDisable: false,
      });

      return apiSuccessRes(
        HTTP_STATUS.OK,
        res,
        "Login successful",

        {
          token,
          ...user.toJSON(),
          totalFollowers,
          totalFollowing,
        }
      );
    } else if (loginWithCode === "true") {
      const otp =
        process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

      user.loginOtp = otp;
      user.loginOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
      await user.save();
      let sentVia = null;
      const isPhone = /^[+\d][\d\s\-().]+$/.test(identifier);
      if (isPhone) {
        const smsResult = await sendOtpSMS(identifier, otp);
        // if (!smsResult.success) {
        //     return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to send OTP via SMS");
        // }
        sentVia = "SMS";
      } else {
        const emailResult = await sendEmail({
          to: identifier,
          subject: "Your Kadsun Login OTP",
          text: `Your OTP code is: ${otp}`,
          html: `<p>Your OTP code is: <strong>${otp}</strong></p>`,
        });
        // if (!emailResult.success) {
        //     return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to send OTP via Email");
        // }
        sentVia = "Email";
      }

      // console.log(`OTP for ${user.phoneNumber}: ${otp}`);

      return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent");
    }

    return apiErrorRes(
      HTTP_STATUS.BAD_REQUEST,
      res,
      "Provide either password or loginWithCode=true"
    );
  } catch (err) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
  }
};
const loginStepThreeVerifyOtp = async (req, res) => {
  try {
    const { identifier, otp, fcmToken } = req.body;
    if (!identifier || !otp) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Identifier and OTP are required"
      );
    }

    const cleanedIdentifier = identifier.trim().toLowerCase();

    const query = {
      $or: [
        { email: cleanedIdentifier },
        { phoneNumber: identifier },
        { userName: cleanedIdentifier },
      ],
    };

    const user = await User.findOne(query)
      .select("+loginOtp +loginOtpExpiresAt")
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ]);
    if (!user) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
    }
    if (user.isDisable) {
      return apiErrorRes(
        HTTP_STATUS.FORBIDDEN,
        res,
        CONSTANTS_MSG.ACCOUNT_DISABLE
      );
    }
    if (user.isDeleted) {
      return apiErrorRes(
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        res,
        CONSTANTS_MSG.ACCOUNT_DELETED
      );
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
      userName: user.userName,
    });

    // ✅ Count followers (users who follow this user)
    const totalFollowers = await Follow.countDocuments({
      userId: user._id,
      isDeleted: false,
      isDisable: false,
    });

    // ✅ Count following (users this user follows)
    const totalFollowing = await Follow.countDocuments({
      followedBy: user._id,
      isDeleted: false,
      isDisable: false,
    });

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "OTP verified, login successful",

      {
        token,
        ...user.toJSON(),
        totalFollowers,
        totalFollowing,
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
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Identifier is required"
      );
    }

    const cleanedIdentifier = identifier.trim().toLowerCase();

    const query = {
      $or: [
        { email: cleanedIdentifier },
        { phoneNumber: cleanedIdentifier },
        { userName: cleanedIdentifier },
      ],
    };

    const user = await User.findOne(query);
    if (!user) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
    }

    const newOtp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

    user.loginOtp = newOtp;
    user.loginOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    // console.log(`Resent OTP to ${user.phoneNumber}: ${newOtp}`);

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");
  } catch (err) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
  }
};

//APPLE LOGI

const appleSignIn = async (req, res) => {
  try {

    // Accept both form-data and JSON keys
    const body = {
      social_id: req.body.social_id || req.body.socialId || req.body.userIdentifier,
      email: req.body.email ?? null,
      first_name: req.body.first_name || req.body.firstName || null,
      last_name: req.body.last_name || req.body.lastName || null,
      device_token: req.body.device_token || req.body.fcmToken || null,
      language: req.body.language || null,
    };

    // Validate input
    const schema = Joi.object({
      social_id: Joi.string().min(3).required(),
      email: Joi.string().email().allow(null, ""),
      first_name: Joi.string().max(100).allow(null, ""),
      last_name: Joi.string().max(100).allow(null, ""),
      device_token: Joi.string().allow(null, ""),
      language: Joi.string().max(10).allow(null, ""),
    });

    const { error, value } = schema.validate(body);
    if (error) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        error.details?.[0]?.message || "Invalid payload"
      );
    }

    const {
      social_id: socialId,
      email,
      first_name,
      last_name,
      device_token,
      language,
    } = value;

    console.log("🔐 Social Login:", {  socialId, email: email || "N/A" });

    // Try to find user by (socialId+type) OR by email (if present)
    let user = await User.findOne({
      $or: [
        { socialId: socialId },
        ...(email ? [{ email: email.toLowerCase() }] : []),
      ],
    }).populate([
      { path: "provinceId", select: "value" },
      { path: "districtId", select: "value" },
    ]);

    if (user) {
      console.log("🔍 Existing user:", user._id.toString());

      // Guard rails
      if (user.isDisable) {
        return apiErrorRes(
          HTTP_STATUS.UNAUTHORIZED,
          res,
          CONSTANTS_MSG.ACCOUNT_DISABLE
        );
      }
      if (user.isDeleted) {
        return apiErrorRes(
          HTTP_STATUS.UNAUTHORIZED,
          res,
          CONSTANTS_MSG.ACCOUNT_DELETED
        );
      }

      // Link socialId/provider if missing or changed
      if (!user.socialId) user.socialId = socialId;
     

      // Update basic fields
      if (device_token) user.fcmToken = device_token;
      if (language && language !== "") user.language = language;

      // Only set names if not previously set (Apple/FB/Google may not send again)
      if (!user.firstName && first_name) user.firstName = first_name;
      if (!user.lastName && last_name) user.lastName = last_name;

      await user.save();
    } else {
      console.log("👤 No user found. Creating new social user...");

      // Build a base for username
      const baseName =
        first_name ||
        (email ? email.split("@")[0] : null) ||
        `${first_name}user-${String(socialId).slice(-6)}`;

      const userName = await generateUniqueUsername(baseName);

      let obj = {
        userName,
        socialId,
        email: email ? email.toLowerCase() : null,
        firstName: first_name || null,
        lastName: last_name || null,
        profileImage: null, // Apple/FB may not provide; frontend can update later
        fcmToken: device_token || null,
        step: 5,
      };
      if (language && language !== "") obj.language = language;

      user = new User(obj);
      await user.save();

      // Optional indexing
      try {
        await indexUser(user);
        console.log("📦 Indexed user to Algolia");
      } catch (e) {
        console.error("⚠️ Algolia indexing failed:", e?.message || e);
      }

      user = await User.findById(user._id).populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ]);
    }

    // Followers/following counts
    const [totalFollowers, totalFollowing] = await Promise.all([
      Follow.countDocuments({
        userId: user._id,
        isDeleted: false,
        isDisable: false,
      }),
      Follow.countDocuments({
        followedBy: user._id,
        isDeleted: false,
        isDisable: false,
      }),
    ]);

    // App JWT
    const payload_jwt = {
      userId: user._id,
      email: user.email,
      roleId: user.roleId,
      role: user.role,
      userName: user.userName,
      profileImage: user.profileImage,
    };
    const token = signToken(payload_jwt);

    // Keep response structure same as your Google login
    const userResponse = {
      token,
      ...user.toJSON(),
      totalFollowers,
      totalFollowing,
    };

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      `Sign-in successful`,
      userResponse
    );
  } catch (err) {
    console.error("💥 Social Login error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Internal server error",
      err.message
    );
  }
};





















//GOOGLE LOGIN
const googleSignIn = async (req, res) => {
  try {
    const { accessToken, fcmToken, language } = req.body;
    console.log("Received request for Google Sign-In");
    console.log("accessToken:", accessToken ? "Received" : "Missing");
    console.log("fcmToken:", fcmToken || "Not Provided");

    if (!accessToken) {
      console.log("❌ Missing Google access token");
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Google access token is required"
      );
    }

    let googleUser;
    try {
      console.log("🔍 Fetching user info from Google...");
      const response = await axios.get(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
      );
      googleUser = response.data;
    } catch (error) {
      console.error(
        "❌ Failed to fetch user info from Google:",
        error.response?.data || error.message
      );
      return apiErrorRes(
        HTTP_STATUS.UNAUTHORIZED,
        res,
        "Invalid Google access token"
      );
    }

    const { email, name, picture, id: googleId } = googleUser;

    if (!email) {
      console.log("❌ Email not found in Google user info");
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Email not provided by Google"
      );
    }

    console.log("✅ Google user info received. Email:", email);

    let user = await User.findOne({ email: email.toLowerCase() }).populate([
      { path: "provinceId", select: "value" },
      { path: "districtId", select: "value" },
    ]);

    if (user) {
      console.log("🔍 Existing user found:", user._id.toString());

      if (user.isDisable) {
        return apiErrorRes(
          HTTP_STATUS.UNAUTHORIZED,
          res,
          CONSTANTS_MSG.ACCOUNT_DISABLE
        );
      }

      if (user.isDeleted) {
        return apiErrorRes(
          HTTP_STATUS.UNAUTHORIZED,
          res,
          CONSTANTS_MSG.ACCOUNT_DELETED
        );
      }

      if (fcmToken) {
        console.log("🔄 Updating FCM token for user");
        user.fcmToken = fcmToken;
      }

      if (!user.profileImage && picture) {
        console.log("📸 Updating user profile image from Google");
        user.profileImage = picture;
      }
      if (language && language !== "") {
        user.language = language;
      }

      await user.save();
    } else {
      console.log("👤 No user found with this email. Creating new user...");

      const userName = await generateUniqueUsername(
        name || email.split("@")[0]
      );
      console.log("🆕 Generated unique username:", userName);

      let obj = {
        email: email.toLowerCase(),
        userName,
        profileImage: picture || null,
        fcmToken: fcmToken || null,
        step: 5,
      };
      if (language && language !== "") {
        obj.language = language;
      }
      user = new User(obj);

      await user.save();

      try {
        await indexUser(user);
        console.log("📦 User indexed to Algolia");
      } catch (algoliaError) {
        console.error("⚠️ Algolia indexing failed:", algoliaError);
      }

      user = await User.findById(user._id).populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ]);
    }

    const [totalFollowers, totalFollowing] = await Promise.all([
      Follow.countDocuments({
        userId: user._id,
        isDeleted: false,
        isDisable: false,
      }),
      Follow.countDocuments({
        followedBy: user._id,
        isDeleted: false,
        isDisable: false,
      }),
    ]);

    const payload_jwt = {
      userId: user._id,
      email: user.email,
      roleId: user.roleId,
      role: user.role,
      userName: user.userName,
      profileImage: user.profileImage,
    };

    const token = signToken(payload_jwt);

    const userResponse = {
      token,
      ...user.toJSON(),
      totalFollowers,
      totalFollowing,
    };

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Sign-in successful",
      userResponse
    );
  } catch (error) {
    console.error("💥 Google Sign-In error:", error);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Internal server error",
      error.message
    );
  }
};

const generateUniqueUsername = async (baseName) => {
  let username = baseName.toLowerCase().replace(/[^a-zA-Z0-9@._]/g, "");

  // Ensure username has at least one letter
  if (!/[a-zA-Z]/.test(username)) {
    username = "user" + username;
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
    let followedBy = req.user.userId;
    let { userId } = req.body;

    if (String(followedBy) === String(userId)) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "You cannot follow yourself"
      );
    }

    let followData = await getDocumentByQuery(Follow, {
      followedBy: toObjectId(followedBy),
      userId: toObjectId(userId),
    });
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
      userId: toObjectId(userId),
    });
    await newFollow.save();

    // Send notification for new follow
    try {
      // Get follower and followed user details
      const follower = await User.findById(followedBy).select(
        "userName profileImage"
      );
      const followedUser = await User.findById(userId).select(
        "userName profileImage"
      );

      if (follower && followedUser) {
        const notifications = [
          {
            recipientId: userId,
            userId: followedBy,
            type: NOTIFICATION_TYPES.ACTIVITY,
            title: "New Follower",
            message: `${follower?.userName} started following you`,
            meta: createStandardizedNotificationMeta({
              followerId: followedBy,
              followerName: follower.userName,
              followerImage: follower.profileImage || null,
              userImage: follower.profileImage || null,
              followedUserId: userId,
              followedUserName: followedUser.userName,
              actionBy: "user",
              timestamp: new Date().toISOString(),
            }),
            redirectUrl: `/profile/${followedBy}`,
          },
        ];
        const isActivityEnabled = await User.findOne({
          _id: toObjectId(userId),
          activityNotification: true,
        }).select("_id");

        if (isActivityEnabled) {
          await saveNotification(notifications);
          console.log(`✅ Follow notification sent to user ${userId}`);
        } else {
          console.log(
            `⚠️ User ${userId} has disabled activity notifications, skipping follow notification.`
          );
        }

        console.log(`✅ Follow notification sent to user ${userId}`);
      }
    } catch (notificationError) {
      console.error(
        "❌ Failed to send follow notification:",
        notificationError
      );
      // Don't fail the main operation if notifications fail
    }

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
};
const threadlike = async (req, res) => {
  try {
    let likeBy = req.user.userId;
    let { threadId } = req.body;
    let threadData = await getDocumentByQuery(ThreadLike, {
      likeBy: toObjectId(likeBy),
      threadId: toObjectId(threadId),
    });
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
      threadId: toObjectId(threadId),
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
};
const productLike = async (req, res) => {
  try {
    let likeBy = req.user.userId;
    let { productId } = req.body;
    let threadData = await getDocumentByQuery(ProductLike, {
      likeBy: toObjectId(likeBy),
      productId: toObjectId(productId),
    });
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
      productId: toObjectId(productId),
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
};

const getLikedProducts = async (req, res) => {
  try {
    const userId = req.user.userId;

    const page = parseInt(req.query.pageNo) || 1;
    const limit = parseInt(req.query.size) || 10;
    const skip = (page - 1) * limit;

    const keyword = req.query.keyWord ? req.query.keyWord.trim() : null;

    const sortBy = ["fixedPrice", "commentCount"].includes(req.query.sortBy)
      ? req.query.sortBy
      : "createdAt";
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
        size: limit,
      });
    }

    const blockedUserIds = await getBlockedUserIds(req.user?.userId);
    const query = {
      _id: { $in: likedProductIds },
      isDisable: false,
      isDeleted: false,
      ...(blockedUserIds.length && { userId: { $nin: blockedUserIds } }),
    };

    if (keyword) {
      query.$or = [
        { title: { $regex: keyword, $options: "i" } },
        { description: { $regex: keyword, $options: "i" } },
      ];
    }

    const totalCount = await SellProduct.countDocuments(query);

    // Step 2: Aggregate product data with comment stats and user info
    const products = await SellProduct.aggregate([
      { $match: query },
      { $skip: skip },
      { $limit: limit },

      // Lookup user info
      // {
      //     $lookup: {
      //         from: "User",
      //         localField: "userId",
      //         foreignField: "_id",
      //         as: "user"
      //     }
      // },
      // {
      //     $addFields: {
      //         userId: { $arrayElemAt: ["$user", 0] }
      //     }
      // },
      // { $unset: "user" },

      {
        $lookup: {
          from: "User",
          localField: "userId",
          foreignField: "_id",
          as: "userRaw",
        },
      },
      {
        $match: {
          "userRaw._id": {
            $not: { $in: blockedUserIds.map((id) => toObjectId(id)) },
          },
        },
      },
      {
        $addFields: {
          userId: { $arrayElemAt: ["$userRaw", 0] },
        },
      },
      { $unset: "userRaw" },

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
                isDeleted: false,
              },
            },
            {
              $group: {
                _id: null,
                commentCount: { $sum: 1 },
                associatedProducts: { $push: "$associatedProducts" },
              },
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
                          in: { $concatArrays: ["$$value", "$$this"] },
                        },
                      },
                      as: "item",
                      cond: { $ne: ["$$item", null] },
                    },
                  },
                },
              },
            },
          ],
          as: "commentStats",
        },
      },
      {
        $addFields: {
          commentCount: {
            $ifNull: [{ $arrayElemAt: ["$commentStats.commentCount", 0] }, 0],
          },
          associatedProductCount: {
            $ifNull: [
              { $arrayElemAt: ["$commentStats.associatedProductCount", 0] },
              0,
            ],
          },
        },
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

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Liked products fetched successfully",
      {
        products: productsWithBidCount,
        total: totalCount,
        pageNo: page,
        size: limit,
      }
    );
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      error.message,
      error.message
    );
  }
};

const getLikedThreads = async (req, res) => {
  try {
    const userId = req.user.userId;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const sortBy =
      req.query.sortBy === "commentCount" ? "commentCount" : "createdAt";
    const sortOrder = req.query.orderBy === "asc" ? 1 : -1;

    const keyword = req.query.keyWord ? req.query.keyWord.trim() : null;

    const blockedUserIds = await getBlockedUserIds(req.user?.userId);
    let obje = {
      likeBy: toObjectId(userId),
      isDisable: false,
      isDeleted: false,
    };

    // 1. Find liked thread IDs
    const likedThreadDocs = await ThreadLike.find(obje).select("threadId");

    const likedThreadIds = likedThreadDocs.map((doc) => doc.threadId);

    if (likedThreadIds.length === 0) {
      return apiSuccessRes(HTTP_STATUS.OK, res, "No liked threads found", {
        threads: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
      });
    }

    // 2. Build match condition for liked threads and keyword search
    const matchCondition = {
      _id: { $in: likedThreadIds },
      isDeleted: false,
      isDisable: false,
      ...(blockedUserIds.length && { userId: { $nin: blockedUserIds } }),
    };

    if (keyword) {
      matchCondition.$or = [
        { title: { $regex: keyword, $options: "i" } },
        { content: { $regex: keyword, $options: "i" } },
      ];
    }

    const totalCount = await Thread.countDocuments(matchCondition);
    const pipeline = [
      { $match: matchCondition },

      // {
      //     $lookup: {
      //         from: "User",
      //         let: { userId: "$userId" },
      //         pipeline: [
      //             { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
      //             { $project: { _id: 0, userName: 1, profileImage: 1 } }
      //         ],
      //         as: "user"
      //     }
      // },
      // {
      //     $addFields: {
      //         userId: { $arrayElemAt: ["$user", 0] }  // Replace user array with single object in userId field
      //     }
      // },
      // {
      //     $unset: "user"  // Remove the original array
      // },
      {
        $lookup: {
          from: "User",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $addFields: {
          userIdObj: { $arrayElemAt: ["$user", 0] },
        },
      },
      {
        $match: {
          "userIdObj._id": { $nin: blockedUserIds.map((id) => toObjectId(id)) },
        },
      },
      {
        $addFields: {
          userId: {
            userName: "$userIdObj.userName",
            profileImage: "$userIdObj.profileImage",
          },
        },
      },
      {
        $unset: ["user", "userIdObj"],
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
                isDeleted: false,
              },
            },
            {
              $group: {
                _id: null,
                commentCount: { $sum: 1 },
                associatedProducts: {
                  $push: "$associatedProducts",
                },
              },
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
                          in: { $concatArrays: ["$$value", "$$this"] },
                        },
                      },
                      as: "item",
                      cond: { $ne: ["$$item", null] },
                    },
                  },
                },
              },
            },
          ],
          as: "commentStats",
        },
      },
      {
        $addFields: {
          commentCount: {
            $ifNull: [{ $arrayElemAt: ["$commentStats.commentCount", 0] }, 0],
          },
          associatedProductCount: {
            $ifNull: [
              { $arrayElemAt: ["$commentStats.associatedProductCount", 0] },
              0,
            ],
          },
        },
      },
      {
        $unset: "commentStats",
      },
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

    // Fix associatedProductCount to reflect actual existing products
    await Promise.all(
      threads.map(async (thread, i) => {
        const validProductIds = await getAssociatedProductIdsFromThread(
          thread._id
        );
        threads[i].associatedProductCount = validProductIds.length;
      })
    );

    let obj = {
      threads,
      total: totalCount,
      pageNo: page,
      size: limit,
    };

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Liked threads fetched successfully",
      obj
    );
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      error.message,
      error.message
    );
  }
};

const requestResetOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number is required"
      );
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return apiErrorRes(
        HTTP_STATUS.NOT_FOUND,
        res,
        "User with this phone number does not exist"
      );
    }

    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();
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
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number and OTP are required"
      );
    }

    const redisData = await getKey(`reset:${phoneNumber}`);

    if (redisData.statusCode !== CONSTANTS.SUCCESS) {
      return apiErrorRes(
        HTTP_STATUS.UNAUTHORIZED,
        res,
        "OTP expired or invalid"
      );
    }

    const { otp: storedOtp } = JSON.parse(redisData.data);

    if (otp !== storedOtp) {
      return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
    }

    // Mark as verified for 10 minutes
    await setKeyWithTime(`reset-verified:${phoneNumber}`, "true", 10 * 60);

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
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
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
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};
const resendResetOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number is required"
      );
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
    }

    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();
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
      return apiErrorRes(
        HTTP_STATUS.NOT_FOUND,
        res,
        "User with this email does not exist"
      );
    }

    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();
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
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Email and OTP are required"
      );
    }

    const redisData = await getKey(`reset:${email}`);
    if (redisData.statusCode !== CONSTANTS.SUCCESS) {
      console.warn(`[VERIFY OTP] OTP not found or expired for email: ${email}`);
      return apiErrorRes(
        HTTP_STATUS.UNAUTHORIZED,
        res,
        "OTP expired or invalid"
      );
    }

    const { otp: storedOtp } = JSON.parse(redisData.data);
    if (otp !== storedOtp) {
      console.warn(
        `[VERIFY OTP] Invalid OTP for ${email}. Provided: ${otp}, Expected: ${storedOtp}`
      );
      return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "Invalid OTP");
    }

    await setKeyWithTime(`reset-verified:${email}`, "true", 10 * 60);
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
      return apiErrorRes(
        HTTP_STATUS.UNAUTHORIZED,
        res,
        "OTP not verified or session expired"
      );
    }

    if (!newPassword || !confirmPassword || newPassword !== confirmPassword) {
      console.warn(`[RESET PASSWORD] Passwords do not match or missing`);
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "New password and confirm password must match"
      );
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
    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Password has been reset successfully"
    );
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

    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();
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
        userName: userCheckEmail.data.userName,
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
    const email = "guestxyz@gmail11.com";
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
        "0000000011"
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
        userName: userCheckEmail.data.userName,
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

      const userData = userCheckEmail?.data?.toObject
        ? userCheckEmail.data.toObject()
        : userCheckEmail?.data;

      return apiSuccessRes(HTTP_STATUS.OK, res, CONSTANTS_MSG.SUCCESS, {
        ...userData,
        ...output,
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
    const blockedUsers = await BlockUser.find({ blockBy: userId })
      .select("userId")
      .lean();
    const blockedUserIds = blockedUsers.map((b) => b.userId);

    const user = await User.findById(userId)
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ])
      .lean();
    if (!user) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
    }

    const [
      myThreadCount,
      productListed,
      boughtCount,
      sellCount,
      ThreadDraftCount,
      ProductDraftCount,
      sellerVerification,
    ] = await Promise.all([
      Thread.countDocuments({ userId, isDeleted: false }),
      SellProducts.countDocuments({ userId, isDeleted: false }),

      Order.countDocuments({ userId, isDeleted: false }),

      Order.countDocuments({
        sellerId: userId,
        isDeleted: false,
        paymentStatus: { $ne: PAYMENT_STATUS.PENDING },
      }),

      ThreadDraft.countDocuments({ userId, isDeleted: false }),
      SellProductDraft.countDocuments({ userId, isDeleted: false }),

      SellerVerification.findOne({
        userId: toObjectId(userId),
      }).sort({ createdAt: -1 }),
    ]);
    const likedProducts = await ProductLike.find({
      likeBy: toObjectId(userId),
      isDeleted: false,
    })
      .select("productId")
      .lean();

    const likedProductIds = likedProducts.map((lp) => lp.productId);
    const productLikeCount = await SellProduct.countDocuments({
      _id: { $in: likedProductIds },
      isDeleted: false,
      isDisable: false,
      ...(blockedUserIds.length ? { userId: { $nin: blockedUserIds } } : {}),
    });

    const likedThreads = await ThreadLike.find({
      likeBy: toObjectId(userId),
      isDeleted: false,
    })
      .select("threadId")
      .lean();

    const likedThreadIds = likedThreads.map((lt) => lt.threadId);

    const threadLikeCount = await Thread.countDocuments({
      _id: { $in: likedThreadIds },
      isDeleted: false,
      ...(blockedUserIds.length ? { userId: { $nin: blockedUserIds } } : {}),
    });

    const sellerVerificationStatus =
      !sellerVerification ||
      sellerVerification?.verificationStatus === "Rejected";

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
      sellerVerificationStatus: sellerVerificationStatus,
      is_Id_verified: user.is_Id_verified,
      is_Preferred_seller: user.is_Preferred_seller,
      myThreadCount,
      productListedCount: productListed,
      boughtCount,
      sellCount,
      ThreadDraftCount,
      ProductDraftCount,
      ThreadLikes: threadLikeCount,
      productLike: productLikeCount,
      provinceId: user?.provinceId,
      districtId: user?.districtId,
      dealChatnotification: user?.dealChatnotification,
      activityNotification: user?.activityNotification,
      alertNotification: user?.alertNotification,
      verifyPhone: user?.verifyPhone,
      verifyEmail: user?.verifyEmail,
      averageRatting: user?.averageRatting,
      walletBalance: parseFloat(Number(user?.walletBalance).toFixed(2)),
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
        return apiErrorRes(
          HTTP_STATUS.BAD_REQUEST,
          res,
          "Username must be at least 3 characters long."
        );
      }

      const usernameRegex = /^(?=.*[a-zA-Z])[a-zA-Z0-9@._]+$/;

      if (!usernameRegex.test(userName)) {
        return apiErrorRes(
          HTTP_STATUS.BAD_REQUEST,
          res,
          "Username must contain at least one letter and only include letters, numbers, '.', '_', or '@'."
        );
      }
      const existingUser = await User.findOne({
        userName,
        _id: { $ne: userId },
      });
      if (existingUser) {
        return apiErrorRes(
          HTTP_STATUS.CONFLICT,
          res,
          "Username is already in use."
        );
      }
    }

    // Check for existing email
    if (email && email.trim() !== "") {
      const normalizedEmail = email.toLowerCase();
      const userInfo = await getDocumentByQuery(User, {
        email: normalizedEmail,
        _id: { $ne: toObjectId(userId) },
      });
      if (userInfo.statusCode === CONSTANTS.SUCCESS) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "email Already Exist");
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
      ...(profileImage && { profileImage }),
    };

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    })
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ])
      .select("-password");

    // 🔍 Update the user in Algolia after successful profile update
    try {
      await indexUser(updatedUser);
    } catch (algoliaError) {
      console.error(
        "Algolia update failed for user:",
        updatedUser._id,
        algoliaError
      );
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
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number is required"
      );
    }

    const existing = await getDocumentByQuery(User, { phoneNumber });
    if (
      existing.statusCode === CONSTANTS.SUCCESS &&
      existing.data._id.toString() !== userId
    ) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number already in use"
      );
    }

    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

    if (process.env.NODE_ENV == "production") {
      await sendOtpSMS(phoneNumber, otp);
    }

    await setKeyWithTime(`verify-update:${userId}:${phoneNumber}`, otp, 5);

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent successfully");
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to send OTP",
      error.message
    );
  }
};

const verifyPhoneNumberUpdateOtp = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    const userId = req.user.userId;

    if (!phoneNumber || !otp) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number and OTP are required"
      );
    }

    const redisKey = `verify-update:${userId}:${phoneNumber}`;
    const savedOtp = await getKey(redisKey);

    if (!savedOtp?.data) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "OTP expired or not requested"
      );
    }

    if (savedOtp?.data !== otp) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid OTP");
    }

    // Update phone number
    await User.findByIdAndUpdate(userId, {
      phoneNumber: phoneNumber.toLowerCase(),
      verifyPhone: true,
    });

    const updatedUser = await User.findById(userId)
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ])
      .select("-password");

    // Clean up OTP

    await removeKey(redisKey);

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Phone number updated successfully",
      updatedUser
    );
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to verify OTP",
      error.message
    );
  }
};

const resendPhoneNumberUpdateOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const userId = req.user.userId;

    if (!phoneNumber) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Phone number is required"
      );
    }

    const formattedPhone = phoneNumber.toLowerCase();

    // Check if phone number already exists for another user
    const existingUser = await getDocumentByQuery(User, {
      phoneNumber: formattedPhone,
      _id: { $ne: toObjectId(userId) }, // exclude current user
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
    const newOtp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

    if (process.env.NODE_ENV == "production") {
      await sendOtpSMS(formattedPhone, newOtp);
    }

    await setKeyWithTime(redisKey, newOtp, 5); // 5-minute TTL

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP resent successfully");
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to resend OTP",
      error.message
    );
  }
};

const requestEmailUpdateOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email is required");
    }

    const existing = await getDocumentByQuery(User, {
      email: email.toLowerCase(),
    });
    if (
      existing.statusCode === CONSTANTS.SUCCESS &&
      existing.data._id.toString() !== userId
    ) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email already in use");
    }

    const otp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

    if (process.env.NODE_ENV === "production") {
      await sendEmail({
        to: email,
        subject: "Your Kadsun Email OTP",
        text: `Your OTP code is: ${otp}`,
        html: `<p>Your OTP code is: <strong>${otp}</strong></p>`,
      });
    }

    await setKeyWithTime(
      `verify-email-update:${userId}:${email.toLowerCase()}`,
      otp,
      5
    );

    return apiSuccessRes(HTTP_STATUS.OK, res, "OTP sent to email successfully");
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to send email OTP",
      error.message
    );
  }
};

const verifyEmailUpdateOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const userId = req.user.userId;

    if (!email || !otp) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Email and OTP are required"
      );
    }

    const redisKey = `verify-email-update:${userId}:${email.toLowerCase()}`;
    const savedOtp = await getKey(redisKey);

    if (!savedOtp?.data) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "OTP expired or not requested"
      );
    }

    if (savedOtp.data !== otp) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid OTP");
    }

    // Update email
    await User.findByIdAndUpdate(userId, {
      email: email.toLowerCase(),
      verifyEmail: true,
    });

    const updatedUser = await User.findById(userId)
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ])
      .select("-password");

    // Clean up OTP
    await removeKey(redisKey);

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Email updated successfully",
      updatedUser
    );
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to verify email OTP",
      error.message
    );
  }
};
const resendEmailUpdateOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email is required");
    }

    const formattedEmail = email.toLowerCase();

    const existingUser = await getDocumentByQuery(User, {
      email: formattedEmail,
      _id: { $ne: toObjectId(userId) },
    });

    if (existingUser.statusCode === CONSTANTS.SUCCESS) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Email already exists");
    }

    const redisKey = `verify-email-update:${userId}:${formattedEmail}`;
    const previousOtp = await getKey(redisKey);

    if (!previousOtp) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "No OTP request found for this email. Please initiate email update first."
      );
    }

    const newOtp =
      process.env.NODE_ENV !== "production" ? "123456" : generateOTP();

    if (process.env.NODE_ENV === "production") {
      await sendEmail({
        to: formattedEmail,
        subject: "Your Kadsun Email  OTP",
        text: `Your OTP code is: ${newOtp}`,
        html: `<p>Your OTP code is: <strong>${newOtp}</strong></p>`,
      });
    }

    await setKeyWithTime(redisKey, newOtp, 5); // 5-minute TTL

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "OTP resent to email successfully"
    );
  } catch (error) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to resend email OTP",
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
        // { email: regex },
        // { phoneNumber: regex },
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
            $ifNull: [
              { $arrayElemAt: ["$sellerVerification.verificationStatus", 0] },
              null,
            ],
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

    const totalUsersAgg = await User.aggregate([
      ...aggregation,
      { $count: "total" },
    ]);
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
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Failed to fetch user list",
      err.message
    );
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
      liveAuctions,
    ] = await Promise.all([
      // Users (excluding SUPER_ADMIN, GUEST)
      User.countDocuments({
        isDeleted: false,
        // isDisable: false,
        roleId: { $nin: [roleId.SUPER_ADMIN, roleId.GUEST] },
      }),

      // Threads
      Thread.countDocuments({
        isDeleted: false,
        isDisable: false,
      }),

      // Total fixed-type products (regardless of sold status)
      SellProduct.countDocuments({
        isDeleted: false,
        isDisable: false,
        saleType: SALE_TYPE.FIXED,
      }),

      // Sold products
      SellProduct.countDocuments({
        isDeleted: false,
        isDisable: false,
        saleType: SALE_TYPE.FIXED,
        isSold: true,
      }),

      // Unsold products
      SellProduct.countDocuments({
        isDeleted: false,
        isDisable: false,
        saleType: SALE_TYPE.FIXED,
        isSold: false,
      }),

      // Live auctions
      SellProduct.countDocuments({
        saleType: SALE_TYPE.AUCTION,
        "auctionSettings.isBiddingOpen": true,
        isDeleted: false,
        isDisable: false,
      }),
    ]);

    const summary = {
      totalUsers,
      totalThreads,
      totalFixedProducts,
      totalSoldProducts,
      totalUnsoldProducts,
      liveAuctions,
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

    return apiSuccessRes(HTTP_STATUS.OK, res, "Password updated successfully");
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
    const currentUser = req.user.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid userId");
    }

    // 1. Get user basic info
    const user = await User.findById(userId)
      .populate([
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ])
      .select("-password -otp -__v");
    if (!user) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "User not found");
    }

    // 2. Get follower and following counts
    const [totalFollowers, totalFollowing] = await Promise.all([
      Follow.countDocuments({
        userId: userId,
        isDeleted: false,
        isDisable: false,
      }),
      Follow.countDocuments({
        followedBy: userId,
        isDeleted: false,
        isDisable: false,
      }),
    ]);

    // 3. Check if currentUser follows the profile user
    const isFollow = await Follow.exists({
      userId: userId,
      followedBy: currentUser,
      isDeleted: false,
      isDisable: false,
    });

    const [totalThreads, totalProducts, totalReviews] = await Promise.all([
      Thread.countDocuments({ userId, isDeleted: false, isDisable: false }),
      SellProduct.countDocuments({
        userId,
        isDeleted: false,
        isDisable: false,
      }),
      ProductReview.countDocuments({
        otheruserId: userId,
        isDeleted: false,
        isDisable: false,
      }),
    ]);
    return apiSuccessRes(HTTP_STATUS.OK, res, "User Info", {
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
      averageBuyerRatting: user.averageBuyerRatting,
      averageRatting: user.averageRatting,
      totalBuyerRatingCount: user.totalBuyerRatingCount,
      totalRatingCount: user.totalRatingCount,
      province: user?.provinceId?.value,
      district: user?.districtId?.value || null,
      isFollow: Boolean(isFollow),
      myAccount: userId.toString() == currentUser,
    });
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
      isDisable: false,
    }).populate({
      path: "userId",
      select: "_id userName profileImage provinceId districtId",
      populate: [
        {
          path: "provinceId",
          select: "_id value",
        },
        {
          path: "districtId",
          select: "_id value",
        },
      ],
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
          totalFollowers: 0,
        });
        continue;
      }

      const [isFollowed, totalFollowers] = await Promise.all([
        Follow.exists({
          userId: user._id,
          followedBy: currentUserId,
          isDeleted: false,
          isDisable: false,
        }),
        Follow.countDocuments({
          userId: user._id,
          isDeleted: false,
          isDisable: false,
        }),
      ]);

      result.push({
        _id: user._id || null,
        userName: user.userName || null,
        profileImage: user.profileImage || null,
        isFollowed: !!isFollowed,
        province: user.provinceId?.value || null,
        district: user.districtId?.value || null,
        totalFollowers,
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
      isDisable: false,
    }).populate({
      path: "followedBy",
      select: "_id userName profileImage provinceId districtId",
      populate: [
        {
          path: "provinceId",
          select: "_id value",
        },
        {
          path: "districtId",
          select: "_id value",
        },
      ],
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
          totalFollowers: 0,
        });
        continue;
      }

      const [isFollowed, totalFollowers] = await Promise.all([
        Follow.exists({
          userId: user._id,
          followedBy: currentUserId,
          isDeleted: false,
          isDisable: false,
        }),
        Follow.countDocuments({
          userId: user._id,
          isDeleted: false,
          isDisable: false,
        }),
      ]);

      result.push({
        _id: user._id || null,
        userName: user.userName || null,
        profileImage: user.profileImage || null,
        isFollowed: !!isFollowed,
        province: user.provinceId?.value || null,
        district: user.districtId?.value || null,
        totalFollowers,
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
      confirmPassword: Joi.ref("newPassword"),
    }).with("newPassword", "confirmPassword");

    const { error, value } = schema.validate(req.body);
    if (error) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        error.details[0].message
      );
    }

    const { oldPassword, newPassword } = value;
    const userId = req.user?.userId; // Assuming `req.user` is set by auth middleware

    const user = await getDocumentByQuery(User, { _id: toObjectId(userId) });
    if (!user) {
      return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, "User not found");
    }

    // ✅ Continue with password verification
    const isMatch = await verifyPassword(user?.data?.password, oldPassword);
    if (!isMatch) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Old password is incorrect"
      );
    }

    if (oldPassword === newPassword) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "New password must be different from old password"
      );
    }

    user.data.password = newPassword;
    await user?.data?.save();

    return apiSuccessRes(HTTP_STATUS.OK, res, "Password updated successfully");
  } catch (err) {
    console.error("updatePassword error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};


const deleteAccount = async (req, res) => {
  try {
    const userId = req.user?.userId;

    // Find active user
    const user = await getDocumentByQuery(User, {
      _id: userId,
      isDeleted: false,
    });
    if (user.statusCode !== CONSTANTS.SUCCESS) {
      return apiErrorRes(
        HTTP_STATUS.NOT_FOUND,
        res,
        "User not found or already deleted"
      );
    }

    // --- 1. Immediately soft delete user ---
    user.data.isDeleted = true;
    await user.data.save();

    try {
      await deleteUsers(userId); // Algolia user index
    } catch (algoliaError) {
      console.error(
        "❌ Algolia deletion failed for user:",
        userId,
        algoliaError
      );
    }

    // ✅ Send response early
    apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Account deletion started. All products & threads will be removed shortly."
    );

    // --- 2. Continue in background (non-blocking) ---
    process.nextTick(async () => {
      try {
        // Delete Products
        const products = await SellProduct.find({ userId, isDeleted: false });
        await Promise.all(
          products.map(async (product) => {
            try {
              if (product.photos?.length) {
                await Promise.all(
                  product.photos.map((url) =>
                    deleteImageCloudinary(url).catch((err) => {
                      console.error("Cloudinary delete failed:", url, err);
                    })
                  )
                );
              }
              product.isDeleted = true;
              await product.save();
              await deleteProducts(product._id).catch((err) => {
                console.error(
                  "Algolia product delete failed:",
                  product._id,
                  err
                );
              });
            } catch (e) {
              console.error("Product delete failed:", product._id, e);
            }
          })
        );

        // Delete Threads
        const threads = await Thread.find({ userId, isDeleted: false });
        await Promise.all(
          threads.map(async (thread) => {
            thread.isDeleted = true;
            await thread.save();
            await deleteThreads(thread._id).catch((err) => {
              console.error("Algolia thread delete failed:", thread._id, err);
            });
          })
        );

        // Delete Drafts (no Algolia)
        const drafts = await ThreadDraft.find({ userId, isDeleted: false });
        await Promise.all(
          drafts.map(async (draft) => {
            draft.isDeleted = true;
            await draft.save();
          })
        );

        console.log(`✅ Cleanup completed for user ${userId}`);
      } catch (cleanupErr) {
        console.error(
          "❌ Background cleanup failed for user:",
          userId,
          cleanupErr
        );
      }
    });
  } catch (err) {
    console.error("deleteAccount error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const blockUser = async (req, res) => {
  try {
    const blockBy = req.user.userId; // from auth middleware
    const { userId } = req.body;
    if (
      !mongoose.Types.ObjectId.isValid(blockBy) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      return res
        .status(400)
        .json({ status: false, message: "Invalid user IDs." });
    }
    if (blockBy === userId) {
      return res
        .status(400)
        .json({ status: false, message: "You cannot block yourself." });
    }
    const existingBlock = await BlockUser.findOne({ blockBy, userId });
    if (existingBlock) {
      await BlockUser.deleteOne({ _id: existingBlock._id });
      return apiSuccessRes(HTTP_STATUS.OK, res, "User unblocked successfully.");
    } else {
      const newBlock = new BlockUser({ blockBy, userId });
      await newBlock.save();
      return apiSuccessRes(HTTP_STATUS.OK, res, "User blocked successfully.");
    }
  } catch (err) {
    console.error("updatePassword error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getBlockedUsers = async (req, res) => {
  try {
    const blockBy = req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(blockBy)) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid user ID.");
    }

    // Step 1: Get blocked users
    const blockedList = await BlockUser.find({ blockBy }).populate({
      path: "userId",
      select: "name userName email profileImage provinceId districtId",
      populate: [
        { path: "provinceId", select: "value" },
        { path: "districtId", select: "value" },
      ],
    });

    // Step 2: Get follower counts
    const userIds = blockedList.map((item) => item.userId?._id).filter(Boolean);

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
    followerCounts.forEach((fc) => {
      countMap[fc._id.toString()] = fc.count;
    });

    // Step 3: Build response
    const result = blockedList.map((item) => {
      const user = item.userId;
      const userIdStr = user?._id?.toString();
      return {
        _id: user?._id,
        name: user?.name,
        username: user?.userName,
        email: user?.email,
        profileImage: user?.profileImage,
        province: user?.provinceId?.value || null,
        district: user?.districtId?.value || null,
        followerCount: countMap[userIdStr] || 0,
        blockedAt: item.createdAt,
      };
    });

    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Blocked users fetched successfully",
      result
    );
  } catch (err) {
    console.error("getBlockedUsers error:", err);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getUserNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Try to find user selecting only the notification fields
    let user = await User.findById(userId).select(
      "dealChatnotification activityNotification alertNotification"
    );

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
        {
          new: true,
          select: "dealChatnotification activityNotification alertNotification",
        }
      );
    }
    return apiSuccessRes(HTTP_STATUS.OK, res, "Notification List", user);
  } catch (err) {
    return res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json(apiErrorRes(CONSTANTS_MSG.INTERNAL_SERVER_ERROR));
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
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json(apiErrorRes(error.details[0].message));
    }

    // Update only those fields in user document
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: value },
      {
        new: true,
        select: "dealChatnotification activityNotification alertNotification",
      }
    );

    if (!updatedUser) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(apiErrorRes("User not found"));
    }
    return apiSuccessRes(
      HTTP_STATUS.OK,
      res,
      "Notification settings updated successfully",
      updatedUser
    );
  } catch (err) {
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      CONSTANTS_MSG.INTERNAL_SERVER_ERROR
    );
  }
};

//upload api
router.post("/upload", upload.single("file"), uploadfile);

// Registration Process
router.post("/requestOtp", perApiLimiter(), upload.none(), requestOtp);
router.post("/verifyOtp", perApiLimiter(), upload.none(), verifyOtp);
router.post("/resendOtp", perApiLimiter(), upload.none(), resendOtp);
router.post(
  "/saveEmailPassword",
  perApiLimiter(),
  upload.none(),
  saveEmailPassword
);
router.post("/saveCategories", perApiLimiter(), upload.none(), saveCategories);
router.post(
  "/completeRegistration",
  perApiLimiter(),
  upload.single("file"),
  completeRegistration
);
router.get(
  "/getOnboardingStep",
  perApiLimiter(),
  upload.none(),
  getOnboardingStep
);

//login
router.post("/loginStepOne", perApiLimiter(), upload.none(), loginStepOne);
router.post(
  "/loginStepTwo",
  perApiLimiter(),
  upload.none(),
  loginStepTwoPassword
);
router.post(
  "/loginStepThree",
  perApiLimiter(),
  upload.none(),
  loginStepThreeVerifyOtp
);
router.post("/resendLoginOtp", perApiLimiter(), upload.none(), resendLoginOtp);

router.post(
  "/login",
  perApiLimiter(),
  upload.none(),
  validateRequest(loginSchema),
  login
);
router.post("/loginAsGuest", perApiLimiter(), upload.none(), loginAsGuest);
router.post("/googleSignIn", perApiLimiter(), upload.none(), googleSignIn);
router.post("/appleSignIn", perApiLimiter(), upload.none(), appleSignIn);




//RESET PASSWORD
router.post(
  "/requestResetOtp",
  perApiLimiter(),
  upload.none(),
  requestResetOtp
);
router.post("/verifyResetOtp", perApiLimiter(), upload.none(), verifyResetOtp);
router.post("/resetPassword", perApiLimiter(), upload.none(), resetPassword);
router.post("/resendResetOtp", perApiLimiter(), upload.none(), resendResetOtp);
//for email
router.post(
  "/requestResetOtpByEmail",
  perApiLimiter(),
  upload.none(),
  requestResetOtpByEmail
);
router.post(
  "/verifyResetOtpByEmail",
  perApiLimiter(),
  upload.none(),
  verifyResetOtpByEmail
);
router.post(
  "/resetPasswordByEmail",
  perApiLimiter(),
  upload.none(),
  resetPasswordByEmail
);
router.post(
  "/resendResetOtpByEmail",
  perApiLimiter(),
  upload.none(),
  resendResetOtpByEmail
);
//
router.post("/updatePassword", perApiLimiter(), upload.none(), updatePassword);
router.post("/deleteAccount", perApiLimiter(), upload.none(), deleteAccount);

//Follow //Like
router.post(
  "/follow",
  perApiLimiter(),
  upload.none(),
  validateRequest(followSchema),
  follow
);
router.post("/threadlike", perApiLimiter(), upload.none(), threadlike);
router.post(
  "/productLike",
  perApiLimiter(),
  upload.none(),
  validateRequest(productLikeSchema),
  productLike
);
router.get(
  "/getLikedProducts",
  perApiLimiter(),
  upload.none(),
  getLikedProducts
);
router.get("/getLikedThreads", perApiLimiter(), upload.none(), getLikedThreads);
//login_user
router.get("/userList", perApiLimiter(), upload.none(), userList);
router.get("/getProfile", perApiLimiter(), upload.none(), getProfile);
router.post(
  "/updateProfile",
  perApiLimiter(),
  upload.single("profileImage"),
  updateProfile
);
// router.get('/countApi', perApiLimiter(), upload.none(), getProfile);

router.get(
  "/getOtherProfile/:id",
  perApiLimiter(),
  upload.none(),
  getOtherProfile
);
router.get(
  "/getFollowersList/:id",
  perApiLimiter(),
  upload.none(),
  getFollowersList
);
router.get(
  "/getFollowingList/:id",
  perApiLimiter(),
  upload.none(),
  getFollowingList
);

//updatePhoneNumber
router.post(
  "/requestPhoneNumberUpdateOtp",
  perApiLimiter(),
  upload.none(),
  requestPhoneNumberUpdateOtp
);
router.post(
  "/verifyPhoneNumberUpdateOtp",
  perApiLimiter(),
  upload.none(),
  verifyPhoneNumberUpdateOtp
);
router.post(
  "/resendPhoneNumberUpdateOtp",
  perApiLimiter(),
  upload.none(),
  resendPhoneNumberUpdateOtp
);

//Email
router.post(
  "/requestEmailUpdateOtp",
  perApiLimiter(),
  upload.none(),
  requestEmailUpdateOtp
);
router.post(
  "/verifyEmailUpdateOtp",
  perApiLimiter(),
  upload.none(),
  verifyEmailUpdateOtp
);
router.post(
  "/resendEmailUpdateOtp",
  perApiLimiter(),
  upload.none(),
  resendEmailUpdateOtp
);

router.post(
  "/hardDelete",
  perApiLimiter(),
  upload.none(),
  validateRequest(moduleSchemaForId),
  globalCrudController.hardDelete(User)
);
router.post(
  "/softDelete",
  perApiLimiter(),
  upload.none(),
  validateRequest(moduleSchemaForId),
  globalCrudController.softDelete(User)
);
router.post(
  "/update",
  perApiLimiter(),
  upload.none(),
  globalCrudController.update(User)
);
router.get(
  "/getDashboardSummary",
  perApiLimiter(),
  upload.none(),
  getDashboardSummary
);

router.post(
  "/adminChangeUserPassword",
  perApiLimiter(),
  upload.none(),
  adminChangeUserPassword
);

//Block User

router.post("/blockUser", perApiLimiter(), upload.none(), blockUser);
router.get("/getBlockedUsers", perApiLimiter(), upload.none(), getBlockedUsers);

router.get(
  "/getUserNotificationSettings",
  perApiLimiter(),
  upload.none(),
  getUserNotificationSettings
);
router.post(
  "/updateUserNotificationSettings",
  perApiLimiter(),
  upload.none(),
  updateUserNotificationSettings
);

//Notifiaction
module.exports = router;
