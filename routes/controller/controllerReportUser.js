
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { ReportUser } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary } = require('../../utils/cloudinary');





const create = async (req, res) => {
    try {
        // Validate request body
        const schema = Joi.object({
            title: Joi.string().required(),
            description: Joi.string().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return apiErrorRes(res, HTTP_STATUS.BAD_REQUEST, error.details[0].message);

        const { title, description } = value;

        // Handle image uploads (if any)
        let imageUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'report-user-images');
                if (imageUrl) imageUrls.push(imageUrl);
            }
        }

        const newReport = await ReportUser.create({
            userId: req.user?.userId,
            title,
            description,
            image: imageUrls
        });

        return apiSuccessRes(res, HTTP_STATUS.CREATED, CONSTANTS_MSG.CREATED, newReport);
    } catch (err) {
        console.error('Error creating report:', err);
        return apiErrorRes(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);
    }
};


const softDelete = async (req, res) => {
    try {
        const reportId = req.params.id;

        if (!reportId) {
            return apiErrorRes(res, HTTP_STATUS.BAD_REQUEST, 'Report ID is required');
        }

        // Find the report
        const report = await ReportUser.findOne({ _id: reportId, isDisable: false });

        if (!report) {
            return apiErrorRes(res, HTTP_STATUS.NOT_FOUND, 'Report not found or already deleted');
        }

        // Delete images from Cloudinary
        if (Array.isArray(report.image) && report.image.length > 0) {
            for (const imageUrl of report.image) {
                try {
                    console.log('Deleting image:', imageUrl);
                    await deleteImageCloudinary(imageUrl);
                } catch (imgErr) {
                    console.error('Failed to delete image from Cloudinary:', imageUrl, imgErr);
                }
            }
        }

        // Soft delete the report
        report.isDisable = true;
        await report.save();

        return apiSuccessRes(res, HTTP_STATUS.OK, 'Report soft-deleted successfully', null);
    } catch (err) {
        console.error('Error during soft delete:', err);
        return apiErrorRes(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, CONSTANTS_MSG.INTERNAL_SERVER_ERROR);
    }
};





router.post('/create', perApiLimiter(), upload.none(), create);
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(ReportUser));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), softDelete);


router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(ReportUser));
router.get('/getList', perApiLimiter(), globalCrudController.getList(ReportUser));


module.exports = router;
