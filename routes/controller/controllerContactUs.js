
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');

const validateRequest = require('../../middlewares/validateRequest');

const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { createContactUs } = require('../services/validations/contactUsValidation');
const { ContactUs } = require('../../db');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');

const create = async (req, res) => {
    try {
        let images = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'contact-us-images');
                if (imageUrl) images.push(imageUrl);
            }
        }
        let obj = {
            ...req.body,
            image: images,
        }
        if (req.body.userId == "" || !req.body.userId) {
            delete obj.userId
        }

        const contactUs = new ContactUs({
            ...obj
        });
        await contactUs.save();
        return apiSuccessRes(HTTP_STATUS.CREATED, res, 'Message submitted successfully', { contactUs });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

router.post('/create', perApiLimiter(), upload.array("file", 3), validateRequest(createContactUs), create);
router.get('/getList', perApiLimiter(), globalCrudController.getList(ContactUs));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(ContactUs));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(ContactUs));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(ContactUs));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(ContactUs));

module.exports = router;
