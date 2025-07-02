
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');

const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchema } = require('../services/validations/moduleValidation');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { Supportkey } = require('../../db');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');




const all = async (req, res) => {
    try {

        const locations = await Supportkey.find({ isDeleted: false, isDisable: false }).sort({ order: 1 });

        return apiSuccessRes(HTTP_STATUS.OK, res, "All locations fetched successfully", locations);

    } catch (error) {
        console.error("all error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};


router.get('/getList', perApiLimiter(), globalCrudController.getList(Supportkey));
router.get('/all', perApiLimiter(), all);

router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(Supportkey));
router.post('/create', perApiLimiter(), upload.none(),  globalCrudController.create(Supportkey));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(Supportkey));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(Supportkey));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(Supportkey));

module.exports = router;
