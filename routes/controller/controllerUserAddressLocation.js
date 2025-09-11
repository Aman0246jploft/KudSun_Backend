
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
        const userId = req?.user?.userId;
        let value = { ...req.body, userId };

        // Convert isActive string to boolean if needed
        if (typeof req.body.isActive === 'string') {
            value["isActive"] = req.body.isActive.toLowerCase() === 'true';
        }

        // Check if this is the first address for the user
        const existingAddressCount = await UserLocation.countDocuments({ userId: toObjectId(userId), isDeleted: false });

        if (existingAddressCount === 0) {
            // First address — force it to be active
            value.isActive = true;
        } else if (value.isActive === true) {
            // If this is not the first address and the new one is to be active,
            // deactivate all other addresses
            await UserLocation.updateMany(
                { userId: toObjectId(userId), isDeleted: false },
                { $set: { isActive: false } }
            );
        }

        const address = new UserLocation(value);
        await address.save();

        return apiSuccessRes(req,HTTP_STATUS.CREATED, res, "Address created", address);
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

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Address updated", address);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


const getList = async (req, res) => {
    try {
        const userId = toObjectId(req.user.userId);

        const addresses = await UserLocation.find({
            userId,
            isDeleted: false
        }).sort({ createdAt: -1 });

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Address list fetched", addresses);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


router.post('/create', perApiLimiter(), upload.none(), createAddress);
router.post('/update', perApiLimiter(), upload.none(), updateAddress);
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(UserLocation));
router.get('/getList', perApiLimiter(), getList);
router.post('/delete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(UserLocation));


module.exports = router;
