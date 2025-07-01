
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Location } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchema } = require('../services/validations/moduleValidation');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');


const getListById = async (req, res) => {
    try {
        const { parentId } = req.params;

        // Find all child locations with the given parentId
        const locations = await Location.find({ parentId: parentId ? parentId : null, isDeleted: false, isDisable: false }).sort({ value: 1 });
        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", locations);

    } catch (error) {
        console.error("showAllProducts error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};


const getParent = async (req, res) => {
    try {
        // Find all child locations with the given parentId
        const locations = await Location.find({ parentId: null, isDeleted: false, isDisable: false }).sort({ value: 1 });
        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", locations);

    } catch (error) {
        console.error("showAllProducts error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};

const all = async (req, res) => {
    try {
        // Fetch all locations that are not deleted or disabled
        const locations = await Location.find({ isDeleted: false, isDisable: false }).sort({ value: 1 });

        // Separate parents and children
        const parents = locations.filter(loc => loc.parentId === null);
        const children = locations.filter(loc => loc.parentId !== null);

        // Group children under their parents
        const grouped = parents.map(parent => {
            const parentIdStr = parent._id.toString();
            const childItems = children
                .filter(child => child.parentId && child.parentId.toString() === parentIdStr)
                .map(child => ({
                    key: child._id,
                    value: child.value
                }));

            return {
                key: parent._id,
                value: parent.value,
                children: childItems
            };
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, "All locations fetched successfully", grouped);

    } catch (error) {
        console.error("all error:", error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Something went wrong");
    }
};




router.get('/getParent', perApiLimiter(), getParent);
router.get('/getList/:parentId', perApiLimiter(), getListById);
router.get('/all', perApiLimiter(), all);


// router.get('/getList', perApiLimiter(), globalCrudController.getList(Location));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(Location));
router.post('/create', perApiLimiter(), upload.none(), globalCrudController.create(Location));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(Location));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(Location));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(Location));

module.exports = router;
