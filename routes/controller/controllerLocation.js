const express = require("express");
const multer = require("multer");
const upload = multer();
const router = express.Router();
const globalCrudController = require("./globalCrudController");
const { Location } = require("../../db");
const validateRequest = require("../../middlewares/validateRequest");
const { moduleSchema } = require("../services/validations/moduleValidation");
const {
  moduleSchemaForId,
} = require("../services/validations/globalCURDValidation");
const perApiLimiter = require("../../middlewares/rateLimiter");
const { apiErrorRes, apiSuccessRes } = require("../../utils/globalFunction");
const HTTP_STATUS = require("../../utils/statusCode");

const getListById = async (req, res) => {
  try {
    const { parentId } = req.params;

    // Find all child locations with the given parentId
    const locations = await Location.find({
      parentId: parentId ? parentId : null,
      isDeleted: false,
      isDisable: false,
    }).sort({ value: 1 });
    return apiSuccessRes(req,
      HTTP_STATUS.OK,
      res,
      "Products fetched successfully",
      locations
    );
  } catch (error) {
    console.error("showAllProducts error:", error);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const getParent = async (req, res) => {
  try {
    // Find all child locations with the given parentId
    const locations = await Location.find({
      parentId: null,
      isDeleted: false,
      isDisable: false,
    }).sort({ value: 1 });
    return apiSuccessRes(req,
      HTTP_STATUS.OK,
      res,
      "Products fetched successfully",
      locations
    );
  } catch (error) {
    console.error("showAllProducts error:", error);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const all = async (req, res) => {
  try {
    // Fetch all locations that are not deleted or disabled
    const locations = await Location.find({
      isDeleted: false,
      isDisable: false,
    }).sort({ createdAt: 1 });

    // Separate parents and children
    const parents = locations.filter((loc) => loc.parentId === null);
    const children = locations.filter((loc) => loc.parentId !== null);

    // Group children under their parents
    const grouped = parents.map((parent) => {
      const parentIdStr = parent._id.toString();
      const childItems = children
        .filter(
          (child) => child.parentId && child.parentId.toString() === parentIdStr
        )
        .map((child) => ({
          key: child._id,
          value: child.value,
        }));

      return {
        key: parent._id,
        value: parent.value,
        children: childItems,
      };
    });

    return apiSuccessRes(req,
      HTTP_STATUS.OK,
      res,
      "All locations fetched successfully",
      grouped
    );
  } catch (error) {
    console.error("all error:", error);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

const update = async (req, res) => {
  try {
    let { id } = req.body;

    if (!id) {
      return apiErrorRes(
        HTTP_STATUS.BAD_REQUEST,
        res,
        "Location ID is required"
      );
    }

    const location = await Location.findById(id);
    if (!location) {
      return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Location not found");
    }

    if (req.body.value !== undefined) location.value = req.body.value;
    if (typeof req.body.isDisable !== "undefined")
      location.isDisable =
        req.body.isDisable === "true" || req.body.isDisable === true;
    if (typeof req.body.isDeleted !== "undefined")
      location.isDeleted =
        req.body.isDeleted === "true" || req.body.isDeleted === true;
    if (typeof req.body.parentId !== "undefined")
      location.parentId = req.body.parentId || null;

    await location.save();

    return apiSuccessRes(req,
      HTTP_STATUS.OK,
      res,
      "Location updated successfully",
      location
    );
  } catch (error) {
    console.error("update error:", error);
    return apiErrorRes(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      res,
      "Something went wrong"
    );
  }
};

router.get("/getProvince", perApiLimiter(), getParent);
router.get("/getDistrict/:parentId", perApiLimiter(), getListById);
router.get("/all", perApiLimiter(), all);

// router.get('/getList', perApiLimiter(), globalCrudController.getList(Location));
router.post("/update", perApiLimiter(), upload.none(), update);
router.post(
  "/create",
  perApiLimiter(),
  upload.none(),
  globalCrudController.create(Location)
);
router.post(
  "/getById",
  perApiLimiter(),
  upload.none(),
  validateRequest(moduleSchemaForId),
  globalCrudController.getById(Location)
);
router.post(
  "/harddelete",
  perApiLimiter(),
  upload.none(),
  validateRequest(moduleSchemaForId),
  globalCrudController.hardDelete(Location)
);
router.post(
  "/softDelete",
  perApiLimiter(),
  upload.none(),
  validateRequest(moduleSchemaForId),
  globalCrudController.softDelete(Location)
);

module.exports = router;
