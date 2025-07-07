
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Module, SellerVerification, User } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { sellerVerificationSchema } = require('../services/validations/moduleSellerVerification');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { SELLER_PAYOUT_METHOD } = require('../../utils/Role');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { default: mongoose } = require('mongoose');

const create = async (req, res) => {
    try {
        let userId = req.user.userId

        const {
            legalFullName, idNumber,
            paymentPayoutMethod, bankName,
            accountNumber, accountHolderName,
            promptPayId, isAuthorized
        } = req.body;

        const existing = await SellerVerification.findOne({ userId });

        if (existing) {
            if (existing.verificationStatus === 'Approved') {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'You are already verified');
            }
            if (existing.verificationStatus === 'Pending') {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'You already Applied wait for verification');
            }
        }

        // Upload new files only if provided
        let idDocumentFrontUrl = existing?.idDocumentFrontUrl || null;
        let selfieWithIdUrl = existing?.selfieWithIdUrl || null;
        let bankBookUrl = existing?.bankDetails?.bankBookUrl || null;

        const idFrontFile = req.files?.idDocumentFront?.[0];
        const selfieFile = req.files?.selfieWithId?.[0];

        if (!existing && (!idFrontFile || !selfieFile)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Both ID Document Front and Selfie with ID are required');
        }

        if (idFrontFile) {
            idDocumentFrontUrl = await uploadImageCloudinary(idFrontFile, 'seller-verification');
        }

        if (selfieFile) {
            selfieWithIdUrl = await uploadImageCloudinary(selfieFile, 'seller-verification');
        }

        if (!idDocumentFrontUrl || !selfieWithIdUrl) {
            return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Image upload failed');
        }

        if (paymentPayoutMethod === SELLER_PAYOUT_METHOD.BANK_TRANSFER) {

            if (!existing && (!bankName || !accountNumber || !accountHolderName)) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'All bank details and bank book image are required for Bank Transfer');
            }


        }

        const payload = {
            userId,
            legalFullName,
            idNumber,
            idDocumentFrontUrl,
            selfieWithIdUrl,
            paymentPayoutMethod,
            isAuthorized,
            verificationStatus: 'Pending',
            bankDetails: {},
        };

        if (paymentPayoutMethod === SELLER_PAYOUT_METHOD.BANK_TRANSFER) {
            payload.bankDetails = {
                bankName,
                accountNumber,
                accountHolderName,
                bankBookUrl
            };
        }

        if (paymentPayoutMethod === SELLER_PAYOUT_METHOD.PROMPT_PAY) {
            payload.promptPayId = promptPayId;
        }

        let result;
        if (existing) {
            if (existing.verificationStatus === 'Approved') {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'You are already verified');
            }
            result = await SellerVerification.findOneAndUpdate({ userId }, payload, { new: true });
        } else {
            result = await SellerVerification.create(payload);
        }


        await User.findByIdAndUpdate(userId, {
            is_Verified_Seller: true,
            is_Id_verified: false,
        });
        
        return apiSuccessRes(HTTP_STATUS.CREATED, res, 'Seller verification submitted successfully', result);

    } catch (err) {
        console.error('createSellerVerification error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};



const changeVerificationStatus = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id, status } = req.body;

        // Validate status
        const allowedStatuses = ['Pending', 'Approved', 'Rejected'];
        if (!allowedStatuses.includes(status)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: 'Invalid status value' });
        }

        // Find and update the SellerVerification
        const verification = await SellerVerification.findById(id).session(session);
        if (!verification) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: 'Seller verification record not found' });
        }

        verification.verificationStatus = status;
        await verification.save({ session });

        // Update User based on status
        if (status === 'Approved') {
            await User.findByIdAndUpdate(
                verification.userId,
                { is_Verified_Seller: true, is_Id_verified: true },
                { session }
            );
        } else if (status === 'Rejected') {
            await User.findByIdAndUpdate(
                verification.userId,
                { is_Verified_Seller: false, is_Id_verified: false },
                { session }
            );
        }

        await session.commitTransaction();
        session.endSession();

        return res.json({ message: 'Verification status updated successfully', verification });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error updating verification status:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};





const getSellerRequests = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            search = '',
            status,
            userId
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const query = {
            isDeleted: false,
            isDisable: false,
            verificationStatus: "Pending"
        };

        if (userId) {
            query.userId = userId;
        }

        if (status && ['Pending', 'Approved', 'Rejected'].includes(status)) {
            query.verificationStatus = status;
        }

        if (search) {
            query.$or = [
                { legalFullName: { $regex: search, $options: 'i' } },
                { idNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const [totalCount, sellerRequests] = await Promise.all([
            SellerVerification.countDocuments(query),
            SellerVerification.find(query)
                .populate({ path: 'userId', select: 'fullName email phone' })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Seller requests fetched successfully', {
            totalCount,
            pageNo: page,
            size: limit,
            data: sellerRequests
        });

    } catch (err) {
        console.error('getSellerRequests error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};



router.post('/create', perApiLimiter(),
    upload.fields([
        { name: 'idDocumentFront', maxCount: 1 },
        { name: 'selfieWithId', maxCount: 1 }
        // { name: 'bankBook', maxCount: 1 }
    ]),
    validateRequest(sellerVerificationSchema),
    create
);

router.get('/getList', perApiLimiter(), globalCrudController.getList(SellerVerification));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(SellerVerification));
router.post('/changeVerificationStatus', perApiLimiter(), upload.none(), changeVerificationStatus);


router.get('/getSellerRequests', perApiLimiter(), getSellerRequests);

module.exports = router;
