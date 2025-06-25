
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { FeeSetting } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchema } = require('../services/validations/moduleValidation');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');

router.get('/getList', perApiLimiter(), globalCrudController.getList(FeeSetting));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(FeeSetting));
router.post('/create', perApiLimiter(), upload.none(), globalCrudController.create(FeeSetting));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(FeeSetting));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(FeeSetting));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(FeeSetting));

module.exports = router;
