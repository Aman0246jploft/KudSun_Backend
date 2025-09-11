
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Category } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { roleId } = require('../../utils/Role');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const { getDocumentById } = require('../services/serviceGlobalCURD');
const CONSTANTS = require('../../utils/constants');
const { hasPermission } = require('../../middlewares/hasPermission');
const { uploadImageCloudinary, deleteImageCloudinary } = require('../../utils/cloudinary');




const createOrUpdateCategory = async (req, res) => {
    try {
        const { _id, name } = req.body;
        const imageFile = req.file;

        if (_id) {
            // Update existing category
            const existingCategory = await Category.findOne({ _id, isDeleted: false });
            if (!existingCategory) {
                return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Category not found');
            }

            // If name provided, check for duplicate and update
            if (name) {
                const normalizedName = name.toLowerCase();
                const duplicateCategory = await Category.findOne({
                    name: normalizedName,
                    isDeleted: false,
                    _id: { $ne: _id }
                });
                if (duplicateCategory) {
                    return apiErrorRes(req,HTTP_STATUS.CONFLICT, res, 'Category name already in use');
                }
                existingCategory.name = normalizedName;
            }

            // Update image if new file sent
            if (imageFile) {
                const imageUrl = await uploadImageCloudinary(imageFile, 'category-images');
                existingCategory.image = imageUrl;
            }

            await existingCategory.save();

            return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Category updated successfully', {
                _id: existingCategory._id,
                name: existingCategory.name,
                image: existingCategory.image
            });
        } else {
            // Create new category
            if (!name) {
                return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Category name is required');
            }
            const normalizedName = name.toLowerCase();

            const existing = await Category.findOne({ name: normalizedName, isDeleted: false });
            if (existing) {
                return apiErrorRes(req,HTTP_STATUS.CONFLICT, res, 'Category already exists');
            }
            const softDeleted = await Category.findOne({ name: normalizedName, isDeleted: true });

            let imageUrl = null;
            if (imageFile) {
                imageUrl = await uploadImageCloudinary(imageFile, 'category-images');
            }


            if (softDeleted) {
                softDeleted.isDeleted = false;
                if (imageUrl) softDeleted.image = imageUrl;
                await softDeleted.save();

                return apiSuccessRes(req,HTTP_STATUS.OK, res, "Category restored successfully", {
                    _id: softDeleted._id,
                    name: softDeleted.name,
                    image: softDeleted.image,
                });
            }


            const newCategory = new Category({ name: normalizedName, image: imageUrl });
            await newCategory.save();

            return apiSuccessRes(req,HTTP_STATUS.CREATED, res, 'Category created successfully', {
                _id: newCategory._id,
                name: newCategory.name,
                image: newCategory.image
            });
        }
    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};






const addOrUpdateSubCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { name, subCategoryId } = req.body; // subCategoryId optional for update
        const imageFile = req.file;

        if (!name) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Subcategory name is required');
        }

        const category = await Category.findById(categoryId);
        if (!category || category.isDeleted) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        const lowerName = name.trim().toLowerCase();

        let imageUrl = null;
        if (imageFile) {
            imageUrl = await uploadImageCloudinary(imageFile, 'subcategory-images');
        }



        if (subCategoryId) {
            // Update flow
            const subCategory = category.subCategories.id(subCategoryId);
            if (!subCategory) {
                return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
            }


            // Handle deletion
            if (req.body.isDeleted === true || req.body.isDeleted === 'true') {
                subCategory.deleteOne(); // Mongoose subdocument deletion
                await category.save();
                return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Subcategory deleted successfully');
            }

            // Check if the new name is unique among other subcategories
            const duplicate = category.subCategories.find(
                sub => sub._id.toString() !== subCategoryId && sub.name.toLowerCase() === lowerName
            );
            if (duplicate) {
                return apiErrorRes(req,HTTP_STATUS.CONFLICT, res, 'Another subcategory with this name already exists');
            }

            // Update only provided fields
            subCategory.name = lowerName || subCategory.name;
            if (imageUrl) subCategory.image = imageUrl;

            await category.save();

            return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Subcategory updated successfully', {
                _id: subCategory._id,
                name: subCategory.name,
                image: subCategory.image,
                slug: subCategory.slug,
            });
        } else {
            // Create flow: check duplicate name
            const existingSubCategory = category.subCategories.find(
                sub => sub.name.toLowerCase() === lowerName
            );

            if (existingSubCategory) {
                return apiErrorRes(req,HTTP_STATUS.CONFLICT, res, 'Subcategory with this name already exists');
            }

            const slug = category.subCategories.length + 1;

            category.subCategories.push({ name: lowerName, image: imageUrl, slug });
            await category.save();

            const newSubCat = category.subCategories[category.subCategories.length - 1];

            return apiSuccessRes(req,HTTP_STATUS.CREATED, res, 'Subcategory added successfully', {
                _id: newSubCat._id,
                name: newSubCat.name,
                image: newSubCat.image,
                slug: newSubCat.slug,
            });
        }
    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const addParameterToSubCategory = async (req, res) => {
    try {
        const { subCategoryId } = req.params;
        const { key } = req.body;
        const valuesRaw = req.body.values || req.body.value; // handle singular/plural form
        const userId = req.user?.userId;
        const roleId = req.user?.roleId;

        if (!key || !valuesRaw) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Key and values are required');
        }

        // Normalize values to array
        const valuesArray = Array.isArray(valuesRaw) ? valuesRaw : [valuesRaw];

        // Only admins can add/update parameters
        if (roleId !== 1) {
            return apiErrorRes(req,HTTP_STATUS.UNAUTHORIZED, res, 'Only admin can add/update parameters');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        const paramKey = key.trim().toLowerCase();

        // Prepare values to add, all admin added so isAddedByAdmin: true, addedByUserId: null
        const newValues = valuesArray.map(val => ({
            value: val.trim().toLowerCase(),
            isAddedByAdmin: true,
            addedByUserId: null
        }));

        // Check if parameter already exists
        const existingParam = subCategory.parameters.find(p => p.key === paramKey);

        if (existingParam) {
            // Filter out values that already exist
            const existingValueSet = new Set(existingParam.values.map(v => v.value));
            const uniqueValuesToAdd = newValues.filter(v => !existingValueSet.has(v.value));

            if (uniqueValuesToAdd.length === 0) {
                return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameter already up to date');
            }

            existingParam.values.push(...uniqueValuesToAdd);
        } else {
            // Create new parameter
            subCategory.parameters.push({
                key: paramKey,
                values: newValues
            });
        }

        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.CREATED, res, 'Parameter added/updated successfully', {
            key: paramKey,
            addedValues: newValues.map(v => v.value)
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const updateParameterForSubCategory = async (req, res) => {
    try {
        const { subCategoryId, paramKey } = req.params;
        const { newKey, newValues } = req.body;
        const userId = req.user?.userId;
        const roleId = req.user?.roleId;



        if (!newKey && !newValues) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Nothing to update');
        }

        if (roleId !== 1) {
            return apiErrorRes(req,HTTP_STATUS.UNAUTHORIZED, res, 'Only admin can update parameters');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        const parameter = subCategory.parameters.find(p => p.key === paramKey.trim().toLowerCase());

        if (!parameter) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        if (newKey) {
            parameter.key = newKey.trim().toLowerCase();
        }

        if (newValues) {
            const valuesArray = Array.isArray(newValues) ? newValues : [newValues];
            parameter.values = valuesArray.map(val => ({
                value: val.trim().toLowerCase(),
                isAddedByAdmin: true,
                addedByUserId: null
            }));
        }

        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameter updated successfully', {
            key: parameter.key,
            values: parameter.values.map(v => v.value)
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};



const deleteParameterFromSubCategory = async (req, res) => {
    try {
        const { subCategoryId, paramKey } = req.params;
        const { value } = req.body; // optional - if provided, delete only that value

        const roleId = req.user?.roleId;
        if (roleId !== 1) {
            return apiErrorRes(req,HTTP_STATUS.UNAUTHORIZED, res, 'Only admin can delete parameters');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        const paramKeyTrimmed = paramKey.trim().toLowerCase();
        const parameterIndex = subCategory.parameters.findIndex(p => p.key === paramKeyTrimmed);

        if (parameterIndex === -1) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        const parameter = subCategory.parameters[parameterIndex];

        if (value) {
            const valueTrimmed = value.trim().toLowerCase();
            const initialLength = parameter.values.length;
            parameter.values = parameter.values.filter(v => v.value !== valueTrimmed);

            if (parameter.values.length === initialLength) {
                return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Value not found in parameter');
            }

            // If no values left, remove the entire parameter
            if (parameter.values.length === 0) {
                subCategory.parameters.splice(parameterIndex, 1);
            }

            await category.save();
            return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Value deleted from parameter');
        }

        // Delete the entire parameter
        subCategory.parameters.splice(parameterIndex, 1);
        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameter deleted successfully');

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const addParameterValue = async (req, res) => {
    try {
        const { categoryId, subCategoryId, parameterKey, value } = req.body;

        const category = await getDocumentById(Category, categoryId);

        if (category.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        let categoryDoc = category.data;

        // Find subcategory
        const subCat = categoryDoc.subCategories.find(sc => sc._id.toString() === subCategoryId);
        if (!subCat) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        // Find parameter
        const param = subCat.parameters.find(p => p._id.toString() === parameterKey);

        if (!param) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        // Check for duplicate value
        const alreadyExists = param.values.some(v => v.value.toLowerCase() === value.toLowerCase());
        if (alreadyExists) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Value already exists');
        }

        // Add value
        param.values.push({
            value,
            isAddedByAdmin: false,
            addedByUserId: req.user.userId
        });

        await categoryDoc.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Value added successfully', param.values);
    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const deleteParameterValue = async (req, res) => {
    try {
        const { categoryId, subCategoryId, parameterId, value } = req.body;

        // Validate category
        const category = await getDocumentById(Category, categoryId);
        if (category.statusCode !== CONSTANTS.SUCCESS) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        let categoryDoc = category.data;

        // Find subcategory
        const subCat = categoryDoc.subCategories.find(sc => sc._id.toString() === subCategoryId);
        if (!subCat) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        // Find parameter
        const param = subCat.parameters.find(p => p._id.toString() === parameterId);
        if (!param) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        // Find index of the value to remove (case-insensitive match)
        const index = param.values.findIndex(v => v.value.toLowerCase() === value.toLowerCase());
        if (index === -1) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Value not found');
        }

        // Remove value
        param.values.splice(index, 1);
        await categoryDoc.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Value deleted successfully', param.values);
    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};


// const listCategoryNames = async (req, res) => {
//     try {
//         const { keyWord = '', pageNo = 1, size = 10 } = req.query;

//         const searchRegex = new RegExp(keyWord.trim(), 'i');
//         const skip = (parseInt(pageNo) - 1) * parseInt(size);
//         const limit = parseInt(size);

//         const query = {
//             isDeleted: false,
//             name: { $regex: searchRegex }
//         };

//         const [categories, total] = await Promise.all([
//             Category.find(query, { _id: 1, name: 1, image: 1, subCategories: 1, createdAt: 1 })
//                 .skip(skip)
//                 .limit(limit)
//                 .sort({ 'createdAt': -1 }),
//             Category.countDocuments(query)
//         ]);

//         const enrichedCategories = categories.map(cat => {
//             return ({
//                 _id: cat._id,
//                 name: cat.name,
//                 image: cat.image,
//                 createdAt: cat.createdAt,
//                 subCategoryCount: cat.subCategories?.length || 0
//             })
//         });


//         return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Category names fetched successfully', {
//             total,
//             pageNo: parseInt(pageNo),
//             size: limit,
//             data: enrichedCategories
//         });
//     } catch (error) {
//         return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
//     }
// };


const listCategoryNames = async (req, res) => {
    try {
        const { keyWord = '', pageNo = 1, size = 10 } = req.query;

        const searchRegex = new RegExp(keyWord.trim(), 'i');
        const skip = (parseInt(pageNo) - 1) * parseInt(size);
        const limit = parseInt(size);

        const query = {
            isDeleted: false,
            name: { $regex: searchRegex }
        };

        const [categories, total] = await Promise.all([
            Category.find(query, { _id: 1, name: 1, image: 1, subCategories: 1, createdAt: 1 })
                .skip(skip)
                .limit(limit)
                .sort({ 'createdAt': -1 }),
            Category.countDocuments(query)
        ]);

        const enrichedCategories = categories.map(cat => {
            return ({
                _id: cat._id,
                name: cat.name,
                image: cat.image,
                createdAt: cat.createdAt,
                subCategoryCount: cat.subCategories?.length || 0,
                subCategoryNames: cat.subCategories
                    ?.slice(0, 6)                     // take max 6
                    .map(sub => sub.name) || []      // just names
            })
        });

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Category names fetched successfully', {
            total,
            pageNo: parseInt(pageNo),
            size: limit,
            data: enrichedCategories
        });
    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
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

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Categories fetched successfully', {
            total: filteredCategories.length,
            pageNo: parseInt(pageNo),
            size: parseInt(size),
            data: paginatedCategories
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
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

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Admin category list fetched successfully', {
            total: filteredCategories.length,
            pageNo: parseInt(pageNo),
            size: parseInt(size),
            data: paginatedCategories
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};





const approveParameterValueByAdmin = async (req, res) => {
    try {
        const { categoryId, subCategoryId, parameterKey, value } = req.body;

        const category = await Category.findOne({ _id: categoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        const subCat = category.subCategories.find(sc => sc._id.toString() === subCategoryId);
        if (!subCat) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const param = subCat.parameters.find(p => p.key === parameterKey.toLowerCase());
        if (!param) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter not found');
        }

        const paramValue = param.values.find(v => v.value === value.toLowerCase() && !v.isAddedByAdmin);
        if (!paramValue) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'User-added value not found or already approved');
        }

        // Approve the value
        paramValue.isAddedByAdmin = true;
        paramValue.addedByUserId = null;

        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameter value approved successfully', paramValue);

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const getSubCategoriesByCategoryId = async (req, res) => {
    try {
        const { categoryId } = req.params;

        if (!categoryId) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Category ID is required');
        }

        const category = await Category.findOne(
            { _id: categoryId, isDeleted: false },
            { subCategories: 1 } // Only project subCategories
        );

        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Category not found');
        }

        // Map only required subcategory fields
        const subCategories = category.subCategories.map(subCat => {
            const adminParamCount = subCat.parameters?.filter(param => param.isAddedByAdmin)?.length || 0;
            return {

                _id: subCat._id,
                name: subCat.name,
                slug: subCat.slug,
                image: subCat.image,
                parameterCount: adminParamCount
                // ||subCat.parameters?.length || 0
            }
        });

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Subcategories fetched successfully', {
            categoryId,
            total: subCategories.length,
            data: subCategories
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

// const getParametersBySubCategoryId = async (req, res) => {
//     try {
//         const { subCategoryId } = req.params;
//         const userId = req.user?.userId;  // assuming userId is set in req.user after auth

//         if (!subCategoryId) {
//             return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Subcategory ID is required');
//         }

//         // Find the category containing the subcategory
//         const category = await Category.findOne(
//             { 'subCategories._id': subCategoryId, isDeleted: false },
//             { 'subCategories.$': 1 }
//         );

//         if (!category || !category.subCategories.length) {
//             return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
//         }

//         const subCategory = category.subCategories[0];

//         // Filter parameter values according to admin/user logic
//         const parameters = subCategory.parameters.map(param => {
//             const filteredValues = param.values.filter(val =>
//                 val.isAddedByAdmin ||
//                 (userId && val.addedByUserId?.toString() === userId)
//             );

//             return {
//                 _id: param._id,
//                 key: param.key,
//                 values: filteredValues
//             };
//         }).filter(param => param.values.length > 0); // optionally exclude params with no visible values

//         return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameters fetched successfully', {
//             subCategoryId,
//             parameters
//         });

//     } catch (error) {
//         return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
//     }
// };






const getParametersBySubCategoryId = async (req, res) => {
    try {
        const { subCategoryId } = req.params;
        const userId = req.user?.userId;
        // const isAdmin = req.user?.roleId === 1; // Assuming role is stored in JWT payload

        const isAdmin = false; // Assuming role is stored in JWT payload

        if (!subCategoryId) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Subcategory ID is required');
        }

        const category = await Category.findOne(
            { 'subCategories._id': subCategoryId, isDeleted: false },
            { 'subCategories.$': 1 }
        );

        if (!category || !category.subCategories.length) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories[0];

        // const parameters = subCategory.parameters.map(param => {
        //     // Show all values to admin
        //     let filteredValues;
        //     if (isAdmin) {
        //         filteredValues = param.values;
        //     } else {
        //         filteredValues = param.values.filter(val =>
        //             val.isAddedByAdmin ||
        //             (userId && val.addedByUserId?.toString() === userId)
        //         );
        //     }

        //     return {
        //         _id: param._id,
        //         key: param.key,
        //         values: filteredValues
        //     };
        // });




        const parameters = subCategory.parameters
            .filter(param => {
                if (isAdmin) return true;

                // Filter entire param if:
                // 1. The param key was added by admin (assume isAddedByAdmin on param)
                // 2. OR if any of the values are visible to user
                const hasVisibleValues = param.values.some(val =>
                    val.isAddedByAdmin ||
                    (userId && val.addedByUserId?.toString() === userId)
                );

                const isParamVisible =
                    param.isAddedByAdmin ||
                    (userId && param.addedByUserId?.toString() === userId);

                return isParamVisible && hasVisibleValues;
            })
            .map(param => {
                const filteredValues = isAdmin
                    ? param.values
                    : param.values.filter(val =>
                        val.isAddedByAdmin ||
                        (userId && val.addedByUserId?.toString() === userId)
                    );

                return {
                    _id: param._id,
                    key: param.key,
                    values: filteredValues
                };
            });



        // Optionally, filter out parameters with no visible values for non-admins
        const finalParameters = isAdmin ? parameters : parameters.filter(p => p.values.length > 0);

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameters fetched successfully', {
            subCategoryId,
            parameters: finalParameters
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const addUserParameterValue = async (req, res) => {
    try {
        const { subCategoryId } = req.params;
        const { key } = req.body;
        const values = req.body.values;
        const userId = req.user?.userId;

        if (!key || !values) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Key and values are required');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        const paramKey = key.trim().toLowerCase();

        const incomingValues = Array.isArray(values) ? values : [values];
        const newValuesToAdd = incomingValues.map(val => val.trim().toLowerCase());

        const existingParam = subCategory.parameters.find(p => p.key === paramKey);
        if (!existingParam) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter key not found in this subcategory');
        }

        // Prevent duplicate insertion (check all existing values, not just current user)
        const existingValuesSet = new Set(existingParam.values.map(v => v.value));
        const uniqueValuesToAdd = newValuesToAdd.filter(v => !existingValuesSet.has(v));

        if (uniqueValuesToAdd.length === 0) {
            return apiSuccessRes(req,HTTP_STATUS.OK, res, 'No new values to add, all values already exist');
        }

        uniqueValuesToAdd.forEach(value => {
            existingParam.values.push({
                value,
                isAddedByAdmin: false,
                addedByUserId: userId
            });
        });

        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.CREATED, res, 'User values added successfully', {
            key: paramKey,
            addedValues: uniqueValuesToAdd
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};



const addUserParameterAndValue = async (req, res) => {
    try {
        const { subCategoryId } = req.params;
        const { key, values } = req.body;
        const userId = req.user?.userId;

        if (!subCategoryId || !key || !values) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Subcategory ID, key and values are required');
        }

        const paramKey = key.trim().toLowerCase();
        const incomingValues = Array.isArray(values) ? values : [values];
        const trimmedValues = incomingValues.map(v => v.trim().toLowerCase()).filter(Boolean);

        if (trimmedValues.length === 0) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'No valid values provided');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        if (!subCategory) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found in category');
        }

        let parameter = subCategory.parameters.find(p => p.key === paramKey);

        if (parameter) {
            // ✅ Parameter exists — filter out existing values
            const existingValuesSet = new Set(parameter.values.map(v => v.value));
            const uniqueValuesToAdd = trimmedValues.filter(val => !existingValuesSet.has(val));

            if (uniqueValuesToAdd.length === 0) {
                return apiSuccessRes(req,HTTP_STATUS.OK, res, 'No new values to add, all already exist');
            }

            uniqueValuesToAdd.forEach(value => {
                parameter.values.push({
                    value,
                    isAddedByAdmin: false,
                    addedByUserId: userId
                });
            });
        } else {
            // ✅ Parameter does not exist — create a new one
            const newParam = {
                key: paramKey,
                isAddedByAdmin: false,
                addedByUserId: userId,
                values: trimmedValues.map(value => ({
                    value,
                    isAddedByAdmin: false,
                    addedByUserId: userId
                }))
            };

            subCategory.parameters.push(newParam);
        }

        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.CREATED, res, 'Parameter and values added successfully', {
            key: paramKey,
            addedValues: trimmedValues
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};




const acceptParameterValueByAdmin = async (req, res) => {
    try {

        const { subCategoryId } = req.params;
        const { key, value } = req.body;  // form-data fields are strings by default
        const userId = req.user?.userId;
        const roleId = req.user?.roleId;

        if (roleId !== 1) {
            return apiErrorRes(req,HTTP_STATUS.UNAUTHORIZED, res, 'Only admin can accept parameter values');
        }

        if (!key || !value) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Parameter key and value are required');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        const paramKey = key.trim().toLowerCase();
        const targetValue = value.trim().toLowerCase();

        const parameter = subCategory.parameters.find(p => p.key === paramKey);
        if (!parameter) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter key not found');
        }

        const paramValueObj = parameter.values.find(v => v.value === targetValue);
        if (!paramValueObj) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter value not found');
        }

        if (paramValueObj.isAddedByAdmin) {
            return apiErrorRes(req,HTTP_STATUS.CONFLICT, res, 'Parameter value is already accepted by admin');
        }

        // Update the value as accepted by admin
        paramValueObj.isAddedByAdmin = true;
        paramValueObj.addedByUserId = null;

        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameter value accepted by admin successfully', {
            key: paramKey,
            value: targetValue
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};
const rejectParameterValueByAdmin = async (req, res) => {
    try {
        const { subCategoryId } = req.params;
        const { key, value } = req.body; // assuming this is sent as form-data
        const userId = req.user?.userId;
        const roleId = req.user?.roleId;

        if (roleId !== 1) {
            return apiErrorRes(req,HTTP_STATUS.UNAUTHORIZED, res, 'Only admin can reject parameter values');
        }

        if (!key || !value) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Parameter key and value are required');
        }

        const category = await Category.findOne({ 'subCategories._id': subCategoryId, isDeleted: false });
        if (!category) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Subcategory not found');
        }

        const subCategory = category.subCategories.id(subCategoryId);
        const paramKey = key.trim().toLowerCase();
        const targetValue = value.trim().toLowerCase();

        const parameter = subCategory.parameters.find(p => p.key === paramKey);
        if (!parameter) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Parameter key not found');
        }

        const index = parameter.values.findIndex(v =>
            v.value === targetValue && v.isAddedByAdmin === false
        );

        if (index === -1) {
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'User-added parameter value not found');
        }

        // Remove the value
        parameter.values.splice(index, 1);
        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Parameter value rejected and removed successfully', {
            key: paramKey,
            value: targetValue
        });

    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};


const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, "Invalid Category ID");
        }

        const category = await Category.findOne({ _id: id, isDeleted: false });



        if (!category) {
            return apiErrorRes(req,
                HTTP_STATUS.NOT_FOUND,
                res,
                "Category not found or already deleted"
            );
        }
        if (category.image) {
            // Your image deletion utility, e.g. for Cloudinary
            const deleted = await deleteImageCloudinary(category.image);
            if (!deleted) {
                // You can decide whether to proceed or fail here
                console.warn('Failed to delete category image:', category.image);
            } else {
                // category.image = null;  // Remove image URL after deleting from cloud
            }
        }
        category.isDeleted = true;
        await category.save();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Category deleted successfully");
    } catch (error) {
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};



// hasPermission([roleId.SUPER_ADMIN]),
//admin
router.post('/createCategory', perApiLimiter(), upload.single('file'), createOrUpdateCategory);
router.post('/deleteCategory/:id', perApiLimiter(), upload.none(), deleteCategory);
router.post('/addSubCategory/:categoryId', perApiLimiter(), upload.single('file'), addOrUpdateSubCategory);
router.post('/addParameterToSubCategory/:subCategoryId', perApiLimiter(), upload.none(), addParameterToSubCategory);
router.post('/acceptParameterValueByAdmin/:subCategoryId', perApiLimiter(), upload.none(), acceptParameterValueByAdmin);
router.post('/rejectParameterValueByAdmin/:subCategoryId', upload.none(), rejectParameterValueByAdmin);


router.post('/updateParameterForSubCategory/:subCategoryId/:paramKey', upload.none(), updateParameterForSubCategory);
router.post('/deleteParameterFromSubCategory/:subCategoryId/:paramKey', upload.none(), deleteParameterFromSubCategory);



router.post('/addUserParameterValue/:subCategoryId', perApiLimiter(), upload.none(), addUserParameterValue);
router.post('/addUserParameterAndValue/:subCategoryId', perApiLimiter(), upload.none(), addUserParameterAndValue);


router.get('/listCategoryNames', perApiLimiter(), listCategoryNames);
router.get('/getSubCategoriesByCategoryId/:categoryId', perApiLimiter(), getSubCategoriesByCategoryId);
router.get('/getParametersBySubCategoryId/:subCategoryId', perApiLimiter(), getParametersBySubCategoryId);



router.post('/update', perApiLimiter(), hasPermission([roleId.SUPER_ADMIN]), upload.none(), globalCrudController.update(Category));
router.get('/listCategoriesForAdmin', hasPermission([roleId.SUPER_ADMIN]), perApiLimiter(), listCategoriesForAdmin);
// router.post('/approveParameterValueByAdmin', hasPermission([roleId.SUPER_ADMIN]), perApiLimiter(), approveParameterValueByAdmin);

//for user update
router.post('/deleteParameterValue', perApiLimiter(), upload.none(), deleteParameterValue);
router.get('/list', perApiLimiter(), listCategories);



module.exports = router;
