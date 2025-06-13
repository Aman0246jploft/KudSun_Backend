
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { User } = require('../../db');
const { getDocumentByQuery } = require('../services/serviceGlobalCURD');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const CONSTANTS = require('../../utils/constants')
const HTTP_STATUS = require('../../utils/statusCode');
const { apiErrorRes, verifyPassword, apiSuccessRes, generateOTP, generateKey } = require('../../utils/globalFunction');
const { signToken } = require('../../utils/jwtTokenUtils');
const { loginSchema, mobileLoginSchema, otpVerification, categorySchema, completeRegistrationSchema, saveEmailPasswords } = require('../services/validations/userValidation');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const { setKeyWithTime, setKeyNoTime, getKey, removeKey } = require('../services/serviceRedis');
const { uploadImageCloudinary } = require('../../utils/cloudinary');



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
        parsed.categories = categories;

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

        if (req.body?.fmcToken && req.body?.fmcToken !== "") {
            obj['fmcToken'] = req.body.fmcToken;
        }

        // ✅ Create User
        const user = new User({
            ...obj
        });

        await user.save();

        // ✅ Cleanup
        await removeKey(`onboard:${phoneNumber}`);
        await removeKey(`verified:${phoneNumber}`);

        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Registration completed", user);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, err.message);
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
                role: userCheckEmail.data.role
            };

            const token = signToken(payload);

            const output = {
                token,
                userId: userCheckEmail.data._id,
                roleId: userCheckEmail.data.roleId,
                role: userCheckEmail.data.role
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


// Registration Process
router.post('/requestOtp', perApiLimiter(), upload.none(), validateRequest(mobileLoginSchema), requestOtp);
router.post('/verifyOtp', perApiLimiter(), upload.none(), validateRequest(otpVerification), verifyOtp);
router.post('/saveEmailPassword', perApiLimiter(), upload.none(), validateRequest(saveEmailPasswords), saveEmailPassword);
router.post('/saveCategories', perApiLimiter(), upload.none(), validateRequest(categorySchema), saveCategories);
router.post('/completeRegistration', perApiLimiter(), upload.single('file'), validateRequest(completeRegistrationSchema), completeRegistration);
//login 
router.post('/login', perApiLimiter(), upload.none(), validateRequest(loginSchema), login);



// router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(User));
// router.post('/update', upload.none(), globalCrudController.update(User));
// router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(User));
// router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(User));
// router.post('/getList', globalCrudController.getList(User));

module.exports = router;
