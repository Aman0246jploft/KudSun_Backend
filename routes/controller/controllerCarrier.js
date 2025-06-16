
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Carrier } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { carrierValidationSchema } = require('../services/validations/carrierValidation');

router.post('/create', perApiLimiter(), upload.none(), validateRequest(carrierValidationSchema), globalCrudController.create(Carrier));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(Carrier));
router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(Carrier));
router.get('/getList', perApiLimiter(), globalCrudController.getList(Carrier));
router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(Carrier));
router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(Carrier));

module.exports = router;
