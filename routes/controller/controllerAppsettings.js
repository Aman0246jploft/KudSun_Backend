
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { AppSetting } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
// upload.none()




// router.post('/create', perApiLimiter(), upload.array('file'), globalCrudController.create(AppSetting));
// router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(AppSetting));
// router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(AppSetting));
// router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(AppSetting));
// router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(AppSetting));
// router.get('/getList', perApiLimiter(), globalCrudController.getList(AppSetting));




module.exports = router;
