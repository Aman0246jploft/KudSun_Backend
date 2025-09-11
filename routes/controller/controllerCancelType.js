
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { CancelType } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');


const getReports = async (req, res) => {
    try {
        const { pageNo = 1, size = 10, userId } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        const filter = { isDisable: false };
        if (userId) filter.userId = userId;

        const [totalCount, data] = await Promise.all([
            CancelType.countDocuments(filter),
            CancelType.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        const response = {
            totalCount,
            pageNo: page,
            size: limit,
            totalPages: Math.ceil(totalCount / limit),
            data,
        };

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Cancel Type fetched successfully", response);
    } catch (err) {
        console.error('Error fetching reports:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};







router.get('/getList', perApiLimiter(), getReports);
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(CancelType));
router.post('/create', perApiLimiter(), upload.none(), globalCrudController.create(CancelType));
router.post('/getById', perApiLimiter(), upload.none(), globalCrudController.getById(CancelType));
router.post('/harddelete', perApiLimiter(), upload.none(), globalCrudController.hardDelete(CancelType));
router.post('/softDelete', perApiLimiter(), upload.none(), globalCrudController.softDelete(CancelType));

module.exports = router;
