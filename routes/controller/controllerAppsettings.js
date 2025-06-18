
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { AppSetting } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
// upload.none()


const termAndPolicy = async (req, res) => {
    try {
        const [term, policy] = await Promise.all([
            AppSetting.findOne({ key: "Term_Of_Service" }),
            AppSetting.findOne({ key: "Privacy_Policy" }),
        ]);
        return apiSuccessRes(HTTP_STATUS.OK, res, "Policy fetched successfully", { term, policy });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};

const auctionRule = async (req, res) => {
    try {
        const [term] = await Promise.all([
            AppSetting.findOne({ key: "Auction_rules" })
        ]);
        return apiSuccessRes(HTTP_STATUS.OK, res, "Policy fetched successfully", { term });
    } catch (error) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
    }
};



const getFAQs = async (req, res) => {
  try {
    const faqs = await AppSetting.aggregate([
      {
        $match: {
          key: { $regex: /^faq\d+$/, $options: 'i' }, // match faq followed by digits
          isDeleted: false,
          isDisabled: false,
        },
      },
      {
        $addFields: {
          faqNumber: { $toInt: { $substr: ["$key", 3, -1] } }, // extract number from key
        },
      },
      {
        $sort: { faqNumber: 1 }, // ascending by number
      },
      {
        $project: {
          _id: 0,         // exclude _id
          name: 1,
          value: 1,
        },
      },
    ]);

    return apiSuccessRes(HTTP_STATUS.OK, res, "FAQs fetched successfully", { faqs });
  } catch (error) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};


router.post('/create', upload.none(), globalCrudController.create(AppSetting));
router.get('/termAndPolicy', termAndPolicy);
router.get('/auctionRule', auctionRule);
router.get('/getFAQs', getFAQs);



// router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(AppSetting));
// router.post('/harddelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.hardDelete(AppSetting));
// router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(AppSetting));
// router.post('/update', perApiLimiter(), upload.none(), globalCrudController.update(AppSetting));
// router.get('/getList', perApiLimiter(), globalCrudController.getList(AppSetting));




module.exports = router;
