
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { AppSetting, Supportkey } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { uploadImageCloudinary, deleteImageCloudinary } = require('../../utils/cloudinary');

// upload.none()


// const termAndPolicy = async (req, res) => {
//     try {
//         const [term, policy] = await Promise.all([
//             AppSetting.findOne({ key: "Term_Of_Service" }),
//             AppSetting.findOne({ key: "Privacy_Policy" }),
//         ]);
//         return apiSuccessRes(HTTP_STATUS.OK, res, "Policy fetched successfully", { term, policy });
//     } catch (error) {
//         return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
//     }
// };

const termAndPolicy = async (req, res) => {
  try {
    // Only fetch documents matching the required keys
    const keys = ["Term_Of_Service", "Privacy_Policy", "Auction_rules"];
    const settings = await AppSetting.find({ key: { $in: keys } });

    const result = {
      term: settings.find(setting => setting.key === "Term_Of_Service") || null,
      policy: settings.find(setting => setting.key === "Privacy_Policy") || null,
      auctionRule: settings.find(setting => setting.key === "Auction_rules") || null,
    };

    return apiSuccessRes(HTTP_STATUS.OK, res, "Policy fetched successfully", result);
  } catch (error) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};




const auctionRule = async (req, res) => {
  try {
    // Get all documents first
    const allSettings = await AppSetting.find();

    // Filter to find the specific documents
    const Auction_rules = allSettings.find(setting => setting.key === "Auction_rules");


    return apiSuccessRes(HTTP_STATUS.OK, res, "Auction_rules fetched successfully", { Auction_rules });
  } catch (error) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};


const getFAQs = async (req, res) => {
  try {
    // Get all documents first
    const allSettings = await AppSetting.find();

    // Filter for FAQ documents
    const faqSettings = allSettings.filter(setting => {
      // Check if key matches faq pattern (faq followed by digits)
      const isFaqKey = /^faq\d+$/i.test(setting.key);
      const isNotDeleted = setting.isDeleted === false;
      const isNotDisabled = setting.isDisable === false;

      return isFaqKey && isNotDeleted && isNotDisabled;
    });

    // Sort by FAQ number (extract number from key and sort)
    const sortedFaqs = faqSettings.sort((a, b) => {
      const numA = parseInt(a.key.substring(3)); // extract number after 'faq'
      const numB = parseInt(b.key.substring(3));
      return numA - numB;
    });

    // Transform to match your desired output format
    const faqs = sortedFaqs.map(faq => ({
      name: faq.name,
      value: faq.value,
      key: faq.key,
      _id: faq?._id
    }));

    return apiSuccessRes(HTTP_STATUS.OK, res, "FAQs fetched successfully", { faqs });
  } catch (error) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};

const getVideo = async (req, res) => {
  try {
    // Get all documents first
    const allSettings = await AppSetting.find().select('value key');
  
    // Filter to find the specific documents
    const Auction_rules = allSettings.find(setting => setting.key === "11videoXYZ");


    return apiSuccessRes(HTTP_STATUS.OK, res, "VideoUrl", Auction_rules);
  } catch (error) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};

const updateVideo = async (req, res) => {
  try {
    const key = "11videoXYZ"; // Hardcoded key

    if (!req.file) {
      return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Video file is required.");
    }

    // Find existing setting
    const setting = await AppSetting.findOne({ key });

    // Delete previous video if exists
    if (setting && setting.value) {
      await deleteImageCloudinary(setting.value); // assumes function handles full Cloudinary URL
    }

    // Upload new video
    const videoUrl = await uploadImageCloudinary(req.file, 'app-video'); // or uploadVideoCloudinary

    // Update or create the setting
    const updatedSetting = await AppSetting.findOneAndUpdate(
      { key },
      { value: videoUrl },
      { new: true, upsert: true }
    );

    return apiSuccessRes(HTTP_STATUS.OK, res, "Video updated successfully", updatedSetting);
  } catch (error) {
    return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, error.message);
  }
};

router.post('/create', upload.none(), globalCrudController.create(AppSetting));
router.get('/termAndPolicy', termAndPolicy);
router.get('/auctionRule', auctionRule);
router.get('/getFAQs', getFAQs);

router.get('/getVideo', getVideo);
router.post('/updateVideo', upload.single('video'), updateVideo);




router.post('/update', upload.none(), globalCrudController.update(AppSetting));
router.post('/harddelete', upload.none(), globalCrudController.hardDelete(AppSetting));


// router.post('/getById', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.getById(AppSetting));
// router.post('/softDelete', perApiLimiter(), upload.none(), validateRequest(moduleSchemaForId), globalCrudController.softDelete(AppSetting));
// router.get('/getList', perApiLimiter(), globalCrudController.getList(AppSetting));




module.exports = router;
