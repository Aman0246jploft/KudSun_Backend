
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Dispute, Order, DisputeHistory, OrderStatusHistory } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const HTTP_STATUS = require('../../utils/statusCode');
const { DISPUTE_STATUS, ORDER_STATUS } = require('../../utils/Role');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const { createDisputeSchema, sellerRespondSchema, adminDecisionSchema } = require('../services/validations/disputeValidation');
const { default: mongoose } = require('mongoose');




const toObjectId = id => new mongoose.Types.ObjectId(id);


async function logHistory({ disputeId, event, title, note, actor }, session = null) {
    return DisputeHistory.create([{ disputeId, event, title, note, actor }], { session });
}




/* -------------------- BUYER -------------------- */
const createDispute = async (req, res) => {
    /* 1) validate input --------------------------------------------------- */
    const { value, error } = createDisputeSchema.validate(req.body);
    if (error) return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.message);
    const { orderId, disputeType, description } = value;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        /* 2) sanity‑check order & ownership ---------------------------------- */
        const order = await Order.findOne({ _id: orderId, userId: req.user.userId }).session(session);
        if (!order) {
            await session.abortTransaction();
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Order not found for this buyer');
        }

        const deliveredHistory = await OrderStatusHistory.findOne({
            orderId: order._id,
            newStatus: ORDER_STATUS.DELIVERED
        }).sort({ changedAt: -1 }).session(session);

        if (!deliveredHistory) {
            await session.abortTransaction();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Order has never been marked as delivered');
        }

        const deliveredAt = deliveredHistory.changedAt;
        const now = new Date();
        const THREE_DAYS_IN_MS = process.env.DAY * 24 * 60 * 60 * 1000;

        if ((now - deliveredAt) > THREE_DAYS_IN_MS) {
            await session.abortTransaction();
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, `Dispute can only be raised within ${process.env.DAY} days of delivery`);
        }


        /* 3) upload evidence ------------------------------------------------- */
        let evidence = [];
        if (req.files?.length) {
            for (const file of req.files) {
                const url = await uploadImageCloudinary(file, 'dispute-evidence');
                if (url) evidence.push(url);
            }
        }

        /* 4) create dispute -------------------------------------------------- */
        const dispute = await Dispute.create([{
            raisedBy: req.user.userId,
            orderId: order._id,
            sellerId: order.sellerId,
            disputeType,
            description,
            evidence
        }], { session });
        let saved = dispute && Array.isArray(dispute) && dispute[0];

        /* 5) reference dispute on order -------------------------------------- */
        await Order.updateOne(
            { _id: order._id },
            { $set: { disputeId: saved._id, status: ORDER_STATUS.DISPUTE } },
            { session }
        );
        /* 6) history --------------------------------------------------------- */
        await logHistory({
            disputeId: saved._id,
            event: 'CREATED',
            title: 'Dispute raised by buyer',
            note: description,
            actor: req.user.userId
        }, session);

        await session.commitTransaction();
        return apiSuccessRes(HTTP_STATUS.CREATED, res, 'Dispute raised successfully', saved);

    } catch (err) {
        await session.abortTransaction();
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    } finally {
        session.endSession();
    }
};

/* -------------------- SELLER -------------------- */
const sellerRespond = async (req, res) => {
    const { value, error } = sellerRespondSchema.validate(req.body);
    if (error) return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.message);
    const { disputeId, responseType, description } = value;

    try {
        /* 1) ensure seller owns the dispute --------------------------------- */
        const dispute = await Dispute.findOne({ _id: disputeId, sellerId: req.user.userId, isDeleted: false });
        if (!dispute) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Dispute not found for this seller');

        /* 2) upload attachments --------------------------------------------- */
        let attachments = [];
        if (req.files?.length) {
            for (const f of req.files) {
                const url = await uploadImageCloudinary(f, 'dispute-seller-attachments');
                if (url) attachments.push(url);
            }
        }

        /* 3) update --------------------------------------------------------- */
        dispute.sellerResponse = {
            responseType,
            description,
            attachments,
            respondedAt: new Date()
        };
        dispute.status = DISPUTE_STATUS.UNDER_REVIEW;
        await dispute.save();

        await logHistory({
            disputeId,
            event: 'SELLER_RESPONSE',
            title: 'Seller responded',
            note: description,
            actor: req.user.userId
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Response recorded', dispute);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};

/* -------------------- ADMIN -------------------- */
const adminDecision = async (req, res) => {
    const { value, error } = adminDecisionSchema.validate(req.body);
    if (error) return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.message);
    const { disputeId, decision, decisionNote, disputeAmountPercent } = value;

    try {
        const dispute = await Dispute.findById(disputeId);
        if (!dispute) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Dispute not found');

        // Validate disputeAmountPercent only when decision is in favor of buyer
        if (decision === 'BUYER' && disputeAmountPercent !== undefined) {
            if (disputeAmountPercent < 0 || disputeAmountPercent > 100) {
                return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Dispute amount percent must be between 0 and 100');
            }
        }

        dispute.adminReview = {
            reviewedBy: req.user.userId, // admin
            decision,
            decisionNote,
            disputeAmountPercent: decision === 'BUYER' ? disputeAmountPercent || 0 : 0,
            resolvedAt: new Date()
        };
        dispute.status = DISPUTE_STATUS.RESOLVED;
        await dispute.save();

        await logHistory({
            disputeId,
            event: 'ADMIN_DECISION',
            title: `Admin decided in favour of ${decision}`,
            note: decisionNote,
            actor: req.user.userId
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Dispute resolved', dispute);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};

/** POST /dispute/admin/update-status */
const updateStatus = async (req, res) => {
    const { value, error } = updateStatusSchema.validate(req.body);
    if (error) return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, error.message);
    const { disputeId, status } = value;

    try {
        const dispute = await Dispute.findByIdAndUpdate(disputeId, { status }, { new: true });
        if (!dispute) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'Dispute not found');

        await logHistory({
            disputeId,
            event: 'STATUS_UPDATE',
            title: `Status changed to ${status}`,
            note: '',
            actor: req.user.userId
        });

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Status updated', dispute);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


const adminListAll = async (req, res) => {
    try {
        const pageNo = Number(req.query.pageNo) || 1;
        const size = Number(req.query.size) || 10;
        const status = req.query.status;          // optional
        const type = req.query.disputeType;     // optional
        const keyword = req.query.q?.trim();       // optional free‑text search

        /* build filter ---------------------------------------------------- */
        const filter = { isDeleted: false };
        if (status) filter.status = status;
        if (type) filter.disputeType = type;

        /* simple keyword search on disputeId, orderId or description ------ */
        if (keyword) {
            const k = new RegExp(keyword, 'i');
            filter.$or = [
                { disputeId: k },
                { description: k },
                { orderId: keyword.match(/^[a-f\d]{24}$/i) ? keyword : undefined }
            ].filter(Boolean);
        }

        const skip = (pageNo - 1) * size;

        const [items, total] = await Promise.all([
            Dispute.find(filter)
                .populate('orderId')
                .populate('raisedBy', 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting')
                .populate('sellerId', 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(size),
            Dispute.countDocuments(filter)
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, 'All disputes fetched', {
            pageNo,
            size,
            total,
            disputes: items,
        });
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};

const disputeByOrderId = async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!orderId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, 'Order ID is required');
        }

        // Find dispute by order ID
        const dispute = await Dispute.findOne({
            orderId: orderId,
            isDeleted: false
        })
            .populate({ path: "orderId" })
            .populate('raisedBy', 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting')
            .populate('sellerId', 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting').lean()

        if (!dispute) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'No dispute found for this order');
        }

        // Get dispute history
        const disputeHistory = await DisputeHistory.find({ disputeId: dispute._id })
            .populate('actor', 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting')
            .sort({ createdAt: -1 }).lean()

        const response = {
            dispute,
            history: disputeHistory
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Dispute details fetched successfully', response);

    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
}


router.post('/create', perApiLimiter(), upload.array('file', 3), createDispute);
router.post('/sellerRespond', perApiLimiter(), upload.array('file', 3), sellerRespond);
router.post('/adminDecision', perApiLimiter(), upload.any(), adminDecision);
router.post('/updateStatus', perApiLimiter(), updateStatus);
router.get('/adminListAll', perApiLimiter(), adminListAll);
router.get('/byOrderId/:orderId', perApiLimiter(), disputeByOrderId);

module.exports = router;