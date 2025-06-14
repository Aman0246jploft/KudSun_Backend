
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Category } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { createCategorySchema } = require('../services/validations/categoryValidation');
const HTTP_STATUS = require('../../utils/statusCode');
const { roleId } = require('../../utils/Role');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const { getDocumentById } = require('../services/serviceGlobalCURD');
const CONSTANTS = require('../../utils/constants');
const CONSTANTS_MSG = require('../../utils/constantsMessage');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const { hasPermission } = require('../../middlewares/hasPermission');





const createCategory = async (req, res) => {
    try {

        const category = new Category({
            ...req.body,
            isAddedByAdmin: req.user.roleId === roleId.SUPER_ADMIN,
            addedByUserId: req.user.userId
        });

        await category.save();

        return apiSuccessRes(HTTP_STATUS.CREATED, res, CONSTANTS_MSG.SUCCESS, category);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }

}


const addParameterValue = async (req, res) => {
    try {
        const { categoryId, subCategoryId, parameterKey, value } = req.body;

        const category = await getDocumentById(Category, categoryId);
        console.log("category111", category)
        if (category.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        let categoryDoc = category.data;

        // Find subcategory
        const subCat = categoryDoc.subCategories.find(sc => sc._id.toString() === subCategoryId);
        if (!subCat) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        // Find parameter
        const param = subCat.parameters.find(p => p._id.toString() === parameterKey);

        if (!param) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        // Check for duplicate value
        const alreadyExists = param.values.some(v => v.value.toLowerCase() === value.toLowerCase());
        if (alreadyExists) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Value already exists');
        }

        // Add value
        param.values.push({
            value,
            isAddedByAdmin: false,
            addedByUserId: req.user.userId
        });

        await categoryDoc.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Value added successfully', param.values);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const deleteParameterValue = async (req, res) => {
    try {
        const { categoryId, subCategoryId, parameterId, value } = req.body;

        // Validate category
        const category = await getDocumentById(Category, categoryId);
        if (category.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        let categoryDoc = category.data;

        // Find subcategory
        const subCat = categoryDoc.subCategories.find(sc => sc._id.toString() === subCategoryId);
        if (!subCat) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        // Find parameter
        const param = subCat.parameters.find(p => p._id.toString() === parameterId);
        if (!param) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        // Find index of the value to remove (case-insensitive match)
        const index = param.values.findIndex(v => v.value.toLowerCase() === value.toLowerCase());
        if (index === -1) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Value not found');
        }

        // Remove value
        param.values.splice(index, 1);
        await categoryDoc.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Value deleted successfully', param.values);
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};






const listCategories = async (req, res) => {
    try {
        const userId = req.user?.userId || null;
        const { keyWord = '', pageNo = 1, size = 10 } = req.query;

        const searchRegex = new RegExp(keyWord, 'i');
        const skip = (parseInt(pageNo) - 1) * parseInt(size);

        const allCategories = await Category.find({ isDeleted: false });

        const filteredCategories = allCategories.map(category => {
            const matchedSubCategories = category.subCategories.map(subCat => {
                const matchedParams = subCat.parameters.map(param => {
                    const visibleValues = param.values.filter(v =>
                        v.isAddedByAdmin || (userId && v.addedByUserId?.toString() === userId)
                    );

                    return {
                        ...param.toObject(),
                        values: visibleValues
                    };
                }).filter(param =>
                    searchRegex.test(param.key) || param.values.length > 0
                );

                return {
                    ...subCat.toObject(),
                    parameters: matchedParams
                };
            }).filter(subCat =>
                searchRegex.test(subCat.name) || subCat.parameters.length > 0
            );

            return {
                ...category.toObject(),
                subCategories: matchedSubCategories
            };
        }).filter(category =>
            searchRegex.test(category.name) || category.subCategories.length > 0
        );

        const paginatedCategories = filteredCategories.slice(skip, skip + parseInt(size));

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Categories fetched successfully', {
            total: filteredCategories.length,
            pageNo: parseInt(pageNo),
            size: parseInt(size),
            data: paginatedCategories
        });

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};



const listCategoriesForAdmin = async (req, res) => {
    try {
        const { keyWord = '', pageNo = 1, size = 10 } = req.query;

        const searchRegex = new RegExp(keyWord, 'i');
        const skip = (parseInt(pageNo) - 1) * parseInt(size);

        // Get all non-deleted categories
        const allCategories = await Category.find({ isDeleted: false });

        const filteredCategories = allCategories.map(category => {
            const matchedSubCategories = category.subCategories.map(subCat => {
                const matchedParams = subCat.parameters.map(param => {
                    return {
                        ...param.toObject()
                    };
                }).filter(param =>
                    searchRegex.test(param.key) || param.values.length > 0
                );

                return {
                    ...subCat.toObject(),
                    parameters: matchedParams
                };
            }).filter(subCat =>
                searchRegex.test(subCat.name) || subCat.parameters.length > 0
            );

            return {
                ...category.toObject(),
                subCategories: matchedSubCategories
            };
        }).filter(category =>
            searchRegex.test(category.name) || category.subCategories.length > 0
        );

        const paginatedCategories = filteredCategories.slice(skip, skip + parseInt(size));

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Admin category list fetched successfully', {
            total: filteredCategories.length,
            pageNo: parseInt(pageNo),
            size: parseInt(size),
            data: paginatedCategories
        });

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};





const approveParameterValueByAdmin = async (req, res) => {
    try {
        const { categoryId, subCategoryId, parameterKey, value } = req.body;

        const category = await Category.findOne({ _id: categoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        const subCat = category.subCategories.find(sc => sc._id.toString() === subCategoryId);
        if (!subCat) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const param = subCat.parameters.find(p => p.key === parameterKey.toLowerCase());
        if (!param) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        const paramValue = param.values.find(v => v.value === value.toLowerCase() && !v.isAddedByAdmin);
        if (!paramValue) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'User-added value not found or already approved');
        }

        // Approve the value
        paramValue.isAddedByAdmin = true;
        paramValue.addedByUserId = null;

        await category.save();

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Parameter value approved successfully', paramValue);

    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




//admin
router.post('/create', perApiLimiter(), hasPermission([roleId.SUPER_ADMIN]), validateRequest(createCategorySchema), createCategory);
router.post('/update', perApiLimiter(), hasPermission([roleId.SUPER_ADMIN]), upload.none(), globalCrudController.update(Category));
router.get('/listCategoriesForAdmin', hasPermission([roleId.SUPER_ADMIN]), perApiLimiter(), listCategoriesForAdmin);
router.post('/approveParameterValueByAdmin', hasPermission([roleId.SUPER_ADMIN]), perApiLimiter(), approveParameterValueByAdmin);

//for user update
router.post('/addParameterValue', perApiLimiter(), upload.none(), addParameterValue);
router.post('/deleteParameterValue', perApiLimiter(), upload.none(), deleteParameterValue);
router.get('/list', perApiLimiter(), listCategories);






module.exports = router;
