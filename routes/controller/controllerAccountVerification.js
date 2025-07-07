
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { SellerVerification, AccountVerification, SellProduct, User } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');

const create = async (req, res) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return apiErrorRes(HTTP_STATUS.UNAUTHORIZED, res, 'Unauthorized');
        }

        const { legalFullName, idNumber } = req.body;

        const existing = await AccountVerification.findOne({ userId: toObjectId(userId) });


        const idFrontFile = req.files?.idDocumentFront?.[0];
        const selfieFile = req.files?.selfieWithId?.[0];
        // const idBackFile = req.files?.idDocumentBack?.[0];

        const hasNewDocs = idFrontFile && selfieFile;

        // Case: existing record but no new docs
        if (existing) {
            if (existing.verificationStatus === 'Approved') {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'You are already verified');
            }
            if (existing.verificationStatus === 'Pending') {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Your verification is under process');
            }
        }

        // Upload files (required for new/retry)
        let idDocumentFrontUrl = idFrontFile ? await uploadImageCloudinary(idFrontFile, 'seller-verification') : null;
        let selfieWithIdUrl = selfieFile ? await uploadImageCloudinary(selfieFile, 'seller-verification') : null;
        // let idDocumentBackUrl = idBackFile ? await uploadImageCloudinary(idBackFile, 'seller-verification') : null;

        if (!idDocumentFrontUrl || !selfieWithIdUrl) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'All documents are required to submit verification');
        }

        const payload = {
            userId,
            legalFullName,
            idNumber,
            idDocumentFrontUrl,
            selfieWithIdUrl,
            // idDocumentBackUrl,
            verificationStatus: 'Pending',
        };

        const result = await AccountVerification.create(payload);

        return apiSuccessRes(HTTP_STATUS.CREATED, res, 'Seller verification submitted successfully', result);

    } catch (err) {
        console.error('createSellerVerification error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};

const getVerificationIdList = async (req, res) => {

    try {
        let pageNo = 1;
        let pageSize = 1;

        const skip = (pageNo - 1) * pageSize;

        const [data, totalCount] = await Promise.all([
            SellerVerification.find({ isDeleted: false, userId: toObjectId(req.user.userId) })
                .sort({ createdAt: -1 }) // newest first
                .skip(skip)
                .limit(pageSize)
                .select('-__v -isDisable -isDeleted '), // optional: exclude __v

            SellerVerification.countDocuments({ isDeleted: false })
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Verification list fetched successfully', {
            verificiationList: data,
            total: totalCount,
            pageNo,
            size: pageSize

        });
    } catch (err) {
        console.error('getAllVerifications error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
}

const changeVerificationStatus = async (req, res) => {
    try {
        const { id } = req.body; // verification document ID
        const { status } = req.body; // 'Approved' or 'Rejected'

        if (!['Approved', 'Rejected'].includes(status)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid status');
        }

        const verification = await AccountVerification.findById(id);
        if (!verification) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Verification request not found');
        }

        verification.verificationStatus = status;
        await verification.save();

        // Update user's is_Id_verified based on new status
        await User.findByIdAndUpdate(verification.userId, {
            is_Id_verified: status === 'Approved'
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, `Verification status updated to ${status}`, verification);
    } catch (error) {
        console.error('changeVerificationStatus error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};




router.post('/create', perApiLimiter(),
    upload.fields([
        { name: 'idDocumentFront', maxCount: 1 },
        { name: 'selfieWithId', maxCount: 1 },
        // { name: 'idDocumentBack', maxCount: 1 }
    ]),
    create
);








const getMyVerificationList = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get query parameters for filtering
        const {
            status,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build filter object
        const filter = { userId };

        // Add status filter if provided
        if (status && ['Pending', 'Approved', 'Rejected'].includes(status)) {
            filter.verificationStatus = status;
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Get only the top/latest verification record
        const verification = await AccountVerification.findOne(filter)
            .sort(sort)
            .select('-__v') // Exclude version field
            .lean();

        if (!verification) {
            return apiSuccessRes(
                HTTP_STATUS.OK,
                res,
                'No verification found',
                null
            );
        }

        return apiSuccessRes(
            HTTP_STATUS.OK,
            res,
            'My verification retrieved successfully',
            verification
        );

    } catch (err) {
        console.error('getMyVerificationList error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Something went wrong');
    }
};

router.get('/getMyVerificationList', perApiLimiter(),
    getMyVerificationList
);




// SellerVerification
router.get('/getVerificationIdList', perApiLimiter(), getVerificationIdList);

router.get('/getList', perApiLimiter(), globalCrudController.getList(SellerVerification));

router.post('/changeVerificationStatus', perApiLimiter(), upload.none(), changeVerificationStatus);



module.exports = router;
