
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Dispute } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const HTTP_STATUS = require('../../utils/statusCode');
const { DISPUTE_STATUS } = require('../../utils/Role');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');



const createDispute = async (req, res) => {
    try {
        const { orderId, reason, description } = req.body;
        const userId = req.user.userId;

        if (!orderId || !description) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Order ID and description are required");
        }

        let evidenceUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const imageUrl = await uploadImageCloudinary(file, 'dispute-evidence');
                if (imageUrl) evidenceUrls.push(imageUrl);
            }
        }
        let newDispute = new Dispute({
            raisedBy: userId,
            orderId,
            reason,
            description,
            evidence: evidenceUrls
        })

        const dispute = await newDispute.save()

        return apiSuccessRes(HTTP_STATUS.CREATED, res, "Dispute raised successfully", dispute);
    } catch (err) {
        console.error("Create dispute error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};

const updateDisputeStatus = async (req, res) => {
    try {
        console.log("req.bodyreq.body", req.body)
        const { status, disputeId } = req.body;

        if (!DISPUTE_STATUS[status?.toUpperCase()]) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Invalid dispute status");
        }

        const updated = await Dispute.findByIdAndUpdate(disputeId, { status }, { new: true });

        if (!updated) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Dispute not found");

        return apiSuccessRes(HTTP_STATUS.OK, res, "Dispute status updated", updated);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


const deleteDispute = async (req, res) => {
    try {
        const { id } = req.body;

        const deleted = await Dispute.findByIdAndUpdate(id, { isDeleted: true });

        if (!deleted) return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, "Dispute not found");

        return apiSuccessRes(HTTP_STATUS.OK, res, "Dispute deleted");
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};



const listUserDisputes = async (req, res) => {
    try {
        const userId = req.user.userId;

        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;

        const skip = (pageNo - 1) * size;

        const [disputes, totalCount] = await Promise.all([
            Dispute.find({ raisedBy: userId, isDeleted: false })
                .populate('orderId')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(size),
            Dispute.countDocuments({ raisedBy: userId, isDeleted: false })
        ]);
        let obj = {
            disputes,
            pageNo,
            size,
            totalCount
        }

        return apiSuccessRes(HTTP_STATUS.OK, res, "Disputes fetched successfully", obj);
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};


const listAllDisputes = async (req, res) => {
    try {
        const pageNo = parseInt(req.query.pageNo) || 1;
        const size = parseInt(req.query.size) || 10;

        const skip = (pageNo - 1) * size;

        const [disputes, totalCount] = await Promise.all([
            Dispute.find({ isDeleted: false })
                .populate('raisedBy')
                .populate('orderId')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(size),
            Dispute.countDocuments({ isDeleted: false })
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, "All disputes fetched", {
            disputes,
            pagination: {
                pageNo,
                size,
                totalCount,
                totalPages: Math.ceil(totalCount / size)
            }
        });
    } catch (err) {
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message);
    }
};



router.post('/create', perApiLimiter(), upload.array('file', 3), createDispute);
router.post('/updateDisputeStatus', perApiLimiter(), upload.any(), updateDisputeStatus);
router.post('/deleteDispute', perApiLimiter(), upload.any(), deleteDispute);
router.get('/listUserDisputes', perApiLimiter(), listUserDisputes);
router.get('/listAllDisputes', perApiLimiter(), listAllDisputes);





module.exports = router;
