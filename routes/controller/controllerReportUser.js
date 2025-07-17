
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { ReportUser } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary, deleteImageCloudinary } = require('../../utils/cloudinary');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const CONSTANTS_MSG = require("../../utils/constantsMessage")

const create = async (req, res) => {
    try {

        const { title, description, userId } = req.body;

        // Handle image uploads (if any)
        let imageUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'report-user-images');
                if (imageUrl) imageUrls.push(imageUrl);
            }
        }

        const newReport = await ReportUser.create({
            reportedBy: req.user?.userId,
            userId,
            title,
            description,
            image: imageUrls
        });

        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Reported", newReport);
    } catch (err) {
        console.error('Error creating report:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);
    }
};


const softDelete = async (req, res) => {
    try {
        const reportId = req.params.id;

        if (!reportId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Report ID is required');
        }

        // Find the report
        const report = await ReportUser.findOne({ _id: reportId, isDisable: false });

        if (!report) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Report not found or already deleted');
        }

        // Delete images from Cloudinary
        if (Array.isArray(report.image) && report.image.length > 0) {
            for (const imageUrl of report.image) {
                try {
                    // console.log('Deleting image:', imageUrl);
                    await deleteImageCloudinary(imageUrl);
                } catch (imgErr) {
                    console.error('Failed to delete image from Cloudinary:', imageUrl, imgErr);
                }
            }
        }

        // Soft delete the report
        report.isDisable = true;
        await report.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Report soft-deleted successfully', null);
    } catch (err) {
        console.error('Error during soft delete:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);
    }
};


const getReports = async (req, res) => {
    try {
        const { pageNo = 1, size = 10, userId } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const filter = { isDisable: false };
        if (userId) filter.userId = userId;

        const [totalCount, reports] = await Promise.all([
            ReportUser.countDocuments(filter),
            ReportUser.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        const response = {
            totalCount,
            pageNo: page,
            size: limit,
            totalPages: Math.ceil(totalCount / limit),
            reports,
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Reports fetched successfully", response);
    } catch (err) {
        console.error('Error fetching reports:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);
    }
};


const getReportsByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const { pageNo = 1, size = 10 } = req.query;

        if (!userId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'User ID is required');
        }

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const filter = { isDisable: false, userId };

        const [totalCount, reports] = await Promise.all([
            ReportUser.countDocuments(filter),
            ReportUser.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('reportedBy', 'userName profileImage')
        ]);

        const response = {
            totalCount,
            pageNo: page,
            size: limit,
            reports,
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Reports fetched successfully", response);
    } catch (err) {
        console.error('Error fetching reports by userId:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);
    }
};

router.post('/create', perApiLimiter(), upload.array("image"), create);
router.post('/delete/:id', perApiLimiter(), upload.none(), softDelete);
router.get('/getList', perApiLimiter(), getReports);
router.get('/byUser/:userId', perApiLimiter(), getReportsByUserId);

module.exports = router;