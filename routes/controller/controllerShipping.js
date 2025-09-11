
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const {Shipping, Order, Carrier } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const {apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const { default: mongoose } = require('mongoose');
const { SHIPPING_STATUS } = require('../../utils/Role');


const addShipping = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { trackingNumber, orderId, carrierId, status } = req.body;

        if (!orderId || !carrierId) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'orderId and carrierId are required');
        }

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Invalid orderId');
        }

        if (!mongoose.Types.ObjectId.isValid(carrierId)) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(req,HTTP_STATUS.BAD_REQUEST, res, 'Invalid carrierId');
        }

        const order = await Order.findOne({ _id: orderId, isDeleted: false, isDisable: false }).session(session);
        if (!order) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Order not found');
        }

        const carrier = await Carrier.findById(carrierId).session(session);
        if (!carrier) {
            await session.abortTransaction();
            session.endSession();
            return apiErrorRes(req,HTTP_STATUS.NOT_FOUND, res, 'Carrier not found');
        }

        let shipping = await Shipping.findOne({ orderId }).session(session);

        if (shipping) {
            shipping.trackingNumber = trackingNumber || shipping.trackingNumber;
            shipping.carrier = carrierId;
            shipping.status = status || shipping.status;
            await shipping.save({ session });
        } else {
            shipping = new Shipping({
                orderId,
                addressId: order.addressId,
                trackingNumber,
                carrier: carrierId,
                status: status || SHIPPING_STATUS.NOT_DISPATCHED,
            });
            await shipping.save({ session });
        }

        order.shippingId = shipping._id;
        await order.save({ session });

        await session.commitTransaction();
        session.endSession();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, 'Shipping information saved', shipping);

    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error('Add shipping error:', err);
        return apiErrorRes(req,HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || 'Failed to add shipping info');
    }
};




//creat and Update
router.post('/addShipping', perApiLimiter(), upload.none(), addShipping);


module.exports = router;
shippingId