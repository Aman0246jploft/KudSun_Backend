
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { UserAddress, Shipping, Order, Carrier } = require('../../db');
const validateRequest = require('../../middlewares/validateRequest');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { addressSchema } = require('../services/validations/addressValidation');
const HTTP_STATUS = require('../../utils/statusCode');
const { toObjectId, apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const { default: mongoose } = require('mongoose');
const { SHIPPING_STATUS } = require('../../utils/Role');


const addShipping = async (req, res) => {
    try {
        const { trackingNumber, orderId, carrierId, status } = req.body;

        if (!orderId || !carrierId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'orderId and carrierId are required');
        }

        // Validate ObjectIds
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid orderId');
        }
        if (!mongoose.Types.ObjectId.isValid(carrierId)) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Invalid carrierId');
        }

        // Find the order
        const order = await Order.findOne({ _id: toObjectId(orderId), isDeleted: false, isDisable: false });
        if (!order) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Order not found');
        }

        // Verify carrier exists
        const carrier = await Carrier.findById(carrierId);
        if (!carrier) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Carrier not found');
        }

        // Check if shipping record exists for the order
        let shipping = await Shipping.findOne({ orderId });

        if (shipping) {
            // Update existing shipping record
            shipping.trackingNumber = trackingNumber || shipping.trackingNumber;
            shipping.carrier = carrierId;
            shipping.status = status || shipping.status;

            await shipping.save();
        } else {
            // Create new shipping record
            shipping = new Shipping({
                orderId,
                addressId: order.addressId, // Use addressId from order
                trackingNumber,
                carrier: carrierId,
                status: status || SHIPPING_STATUS.NOT_DISPATCHED,
            });

            await shipping.save();
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Shipping information saved', shipping);
    } catch (err) {
        console.error('Add shipping error:', err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || 'Failed to add shipping info');
    }
};




//creat and Update
router.post('/addShipping', perApiLimiter(), upload.none(), addShipping);


module.exports = router;
