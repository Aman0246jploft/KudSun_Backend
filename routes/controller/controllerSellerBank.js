
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { UserAddress, SellerBank } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { addressSchema } = require('../services/validations/addressValidation');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');


const createBank = async (req, res) => {
    try {
        let value = { ...req.body, userId: req?.user?.userId };

        // Normalize isActive from string if provided
        if (typeof req.body.isActive === 'string') {
            value.isActive = req.body.isActive.toLowerCase() === 'true';
        }

        // Default isActive to true if not provided
        if (value.isActive === undefined) {
            value.isActive = true;
        }

        // If new address is active, deactivate all others for the user
        if (value.isActive === true) {
            await SellerBank.updateMany(
                { userId: toObjectId(value.userId), isDeleted: false },
                { $set: { isActive: false } }
            );
        }

        const address = new SellerBank(value);
        await address.save();

        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Bank Added", address);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


const getById = async (req, res) => {
    try {
        const { id } = req.body;
        const userId = req?.user?.userId;

        const address = await UserAddress.findOne({
            _id: toObjectId(id),
            userId: toObjectId(userId),
            isDeleted: false
        }).populate([
            { path: "provinceId", select: "_id value" },
            { path: "districtId", select: "_id value" }
        ]);

        if (!address) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Address not found");
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Address details fetched", address);
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
        let value = req.body;
        if (typeof value.isActive === 'string') {
            value.isActive = value.isActive.toLowerCase() === 'true';
        }

        // Find the address by ID and ensure it belongs to the current user
        const address = await SellerBank.findOne({
            _id: toObjectId(id),
            userId: toObjectId(req.user.userId),
            isDeleted: false
        });

        if (!address) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Address not found");
        }

        // If this update sets the address to active, deactivate all others
        if (value.isActive === true) {
            await SellerBank.updateMany(
                { userId: toObjectId(req.user.userId), isDeleted: false },
                { $set: { isActive: false } }
            );
        }

        // Apply updates
        Object.assign(address, value);
        await address.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, "Bank updated", address);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};



const getList = async (req, res) => {
    try {
        const userId = req?.user?.userId;
        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;

        const skip = (pageNo - 1) * size;

        const filter = {
            userId: toObjectId(userId),
            isDeleted: false
        };

        const [data, total] = await Promise.all([
            SellerBank.find(filter)
                .sort({ isActive: -1, createdAt: -1 }) // Newest first
                .skip(skip)
                .limit(size),
            SellerBank.countDocuments(filter)
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Addresses fetched", {
            total,
            pageNo,
            size,
            data
        });
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};

router.post('/addBank', perApiLimiter(), upload.none(), createBank);
router.post('/update', perApiLimiter(), upload.none(), updateAddress);
router.get('/getList', perApiLimiter(), getList); 

// router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), getById);
// router.post('/delete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(UserAddress));


module.exports = router;
