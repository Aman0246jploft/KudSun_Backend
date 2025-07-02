
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Bank } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');


const getList = async (req, res) => {
    try {
        let { pageNo = 1, size = 10 } = req.query;
        pageNo = parseInt(pageNo);
        size = parseInt(size);

        const filter = { isDeleted: false, isDisable:false };

        const total = await Bank.countDocuments(filter);
        const data = await Bank.find(filter)
            .skip((pageNo - 1) * size)
            .limit(size)
            .sort({ createdAt: -1 });

        const obj = {
            total,
            pageNo,
            size,
            data
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Bank list', obj);

    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


router.post('/create', perApiLimiter(), upload.none(), globalCrudController.create(Bank));
router.get('/getList', perApiLimiter(),getList);
router.get('/getList1', perApiLimiter(), globalCrudController.getList(Bank));

router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(Bank));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(Bank));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(Bank));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(Bank));

module.exports = router;
