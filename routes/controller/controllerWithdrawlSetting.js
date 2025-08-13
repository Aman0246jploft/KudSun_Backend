
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { WithdrawlSetting } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchema } = require('../services/validations/moduleValidation');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');

router.get('/getList', perApiLimiter(), globalCrudController.getList(WithdrawlSetting));
router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(WithdrawlSetting));
router.post('/create', perApiLimiter(), upload.none(),  globalCrudController.create(WithdrawlSetting));


module.exports = router;
