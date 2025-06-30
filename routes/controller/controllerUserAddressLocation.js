
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { UserLocation } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');


const createAddress = async (req, res) => {
    try {
        let value = { ...req.body, userId: req?.user?.userId }
        if (typeof req.body.isActive === 'string') {
            value["isActive"] = req.body.isActive.toLowerCase() === 'true';
        }
        if (value.isActive === true) {
            await UserLocation.updateMany(
                { userId: toObjectId(value.userId), isDeleted: false },
                { $set: { isActive: false } }
            );
        }
        const address = new UserLocation({
            ...value
        });

        await address.save();

        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Address created", address);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


const updateAddress = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Address id is required");
        }

        // Convert isActive string to boolean if needed (e.g., from form-data)
        let value = { ...req.body };
        if (typeof value.isActive === 'string') {
            value.isActive = value.isActive.toLowerCase() === 'true';
        }

        // Find the address by ID and ensure it belongs to the current user
        const address = await UserLocation.findOne({
            _id: toObjectId(id),
            userId: toObjectId(req.user.userId),
            isDeleted: false
        });

        if (!address) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Address not found");
        }

        // If this update sets the address to active, deactivate all others
        if (value.isActive === true) {
            await UserLocation.updateMany(
                { userId: toObjectId(req.user.userId), isDeleted: false },
                { $set: { isActive: false } }
            );
        }

        // Apply updates
        Object.assign(address, value);
        await address.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, "Address updated", address);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


router.post('/create', perApiLimiter(), upload.none(), createAddress);
router.post('/update', perApiLimiter(), upload.none(), updateAddress);
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(UserLocation));
router.get('/getList', perApiLimiter(), globalCrudController.getList(UserLocation));
router.post('/delete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(UserLocation));


module.exports = router;
