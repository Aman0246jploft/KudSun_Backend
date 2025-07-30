
const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { Dispute, Order, DisputeHistory, OrderStatusHistory, ChatRoom, ChatMessage } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { uploadImageCloudinary } = require('../../utils/cloudinary');
const HTTP_STATUS = require('../../utils/statusCode');
const { DISPUTE_STATUS, ORDER_STATUS, NOTIFICATION_TYPES, createStandardizedChatMeta, createStandardizedNotificationMeta } = require('../../utils/Role');
const { apiErrorRes, apiSuccessRes } = require('../../utils/globalFunction');
const { createDisputeSchema, sellerRespondSchema, adminDecisionSchema } = require('../services/validations/disputeValidation');
const { findOrCreateOneOnOneRoom } = require('../services/serviceChat');
const { saveNotification } = require('../services/serviceNotification');
const { default: mongoose } = require('mongoose');




const toObjectId = id => new mongoose.Types.ObjectId(id);


async function logHistory({ disputeId, event, title, note, actor }, session = null) {
    return DisputeHistory.create([{ disputeId, event, title, note, actor }], { session });
}

const emitSystemMessage = async (io, systemMessage, room, buyerId, sellerId) => {
    if (!io) return;

    // Emit the new message to the room
    const messageWithRoom = {
        ...systemMessage.toObject(),
        chatRoom: room._id
    };
    io.to(room._id.toString()).emit('newMessage', messageWithRoom);

    // Update chat room for both users
    const roomObj = await ChatRoom.findById(room._id)
        .populate('participants', 'userName profileImage')
        .populate('lastMessage');

    // For buyer
    io.to(`user_${buyerId}`).emit('roomUpdated', {
        ...roomObj.toObject(),
        participants: roomObj.participants.filter(p => p._id.toString() !== buyerId.toString()),
        unreadCount: 0
    });

    // For seller
    io.to(`user_${sellerId}`).emit('roomUpdated', {
        ...roomObj.toObject(),
        participants: roomObj.participants.filter(p => p._id.toString() !== sellerId.toString()),
        unreadCount: 1
    });

    // Also emit a specific system notification event
    io.to(`user_${buyerId}`).emit('systemNotification', {
        type: systemMessage.messageType,
        meta: systemMessage.systemMeta
    });
    io.to(`user_${sellerId}`).emit('systemNotification', {
        type: systemMessage.messageType,
        meta: systemMessage.systemMeta
    });
};




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

        /* 7) create chat room and system message ------------------------------ */
        const { room } = await findOrCreateOneOnOneRoom(req.user.userId, order.sellerId);

        // Create system message for dispute creation
        const disputeMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'TEXT',
            systemMeta: {
                statusType: 'DISPUTE',
                status: DISPUTE_STATUS.PENDING,
                orderId: order._id,
                disputeId: saved._id,
                productId: order.items[0]?.productId,
                title: 'Dispute Raised',
                meta: createStandardizedChatMeta({
                    orderNumber: order._id.toString(),
                    disputeId: saved.disputeId,
                    disputeType: disputeType,
                    description: description,
                    raisedBy: 'buyer',
                    sellerId: order.sellerId,
                    buyerId: req.user.userId,
                    orderStatus: order.status,
                    disputeStatus: DISPUTE_STATUS.PENDING
                }),
                actions: [
                    {
                        label: "View Dispute",
                        url: `/dispute/${saved._id}`,
                        type: "primary"
                    },
                    {
                        label: "View Order",
                        url: `/order/${order._id}`,
                        type: "secondary"
                    }
                ],
                theme: 'warning',
                content: `Dispute raised by buyer: ${description}`
            }
        });

        await disputeMessage.save({ session });

        // Update chat room's last message
        await ChatRoom.findByIdAndUpdate(
            room._id,
            {
                lastMessage: disputeMessage._id,
                updatedAt: new Date()
            },
            { session }
        );

        await session.commitTransaction();

        // Post-transaction operations
        const io = req.app.get('io');
        await emitSystemMessage(io, disputeMessage, room, req.user.userId, order.sellerId);

        // Send notifications
        const disputeNotifications = [
            {
                recipientId: order.sellerId,
                userId: req.user.userId,
                orderId: order._id,
                disputeId: saved._id,
                productId: order.items[0]?.productId,
                type: NOTIFICATION_TYPES.DISPUTE,
                title: "Dispute Raised Against Your Order",
                message: `A buyer has raised a dispute for order ${order._id.toString().slice(-6)}. Reason: ${disputeType}`,
                meta: createStandardizedNotificationMeta({
                    orderNumber: order._id.toString(),
                    orderId: order._id.toString(),
                    disputeId: saved._id.toString(),
                    disputeType: disputeType,
                    description: description,
                    raisedBy: 'buyer',
                    sellerId: order.sellerId,
                    buyerId: req.user.userId,
                    status: DISPUTE_STATUS.PENDING,
                    newStatus: DISPUTE_STATUS.PENDING
                }),
                redirectUrl: `/dispute/${saved._id}`
            }
        ];

        await saveNotification(disputeNotifications);

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

        /* 4) create chat message for seller response ------------------------- */
        const { room } = await findOrCreateOneOnOneRoom(dispute.raisedBy, req.user.userId);

        // Create system message for seller response
        const responseMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'TEXT',
            systemMeta: {
                statusType: 'DISPUTE',
                status: DISPUTE_STATUS.UNDER_REVIEW,
                orderId: dispute.orderId,
                disputeId: dispute._id,
                title: 'Seller Responded to Dispute',
                meta: createStandardizedChatMeta({
                    disputeId: dispute.disputeId,
                    responseType: responseType,
                    description: description,
                    respondedBy: 'seller',
                    sellerId: req.user.userId,
                    buyerId: dispute.raisedBy,
                    disputeStatus: DISPUTE_STATUS.UNDER_REVIEW
                }),
                actions: [
                    {
                        label: "View Dispute",
                        url: `/dispute/${dispute._id}`,
                        type: "primary"
                    }
                ],
                theme: 'info',
                content: `Seller responded to dispute: ${description}`
            }
        });

        await responseMessage.save();

        // Update chat room's last message
        await ChatRoom.findByIdAndUpdate(
            room._id,
            {
                lastMessage: responseMessage._id,
                updatedAt: new Date()
            }
        );

        // Emit system message
        const io = req.app.get('io');
        await emitSystemMessage(io, responseMessage, room, dispute.raisedBy, req.user.userId);

        // Send notification to buyer
        const sellerResponseNotifications = [
            {
                recipientId: dispute.raisedBy,
                userId: req.user.userId,
                orderId: dispute.orderId,
                disputeId: dispute._id,
                type: NOTIFICATION_TYPES.DISPUTE,
                title: "Seller Responded to Your Dispute",
                message: `The seller has responded to your dispute. Response: ${responseType}`,
                meta: createStandardizedNotificationMeta({
                    disputeId: dispute._id.toString(),
                    responseType: responseType,
                    description: description,
                    respondedBy: 'seller',
                    sellerId: req.user.userId,
                    buyerId: dispute.raisedBy,
                    status: DISPUTE_STATUS.UNDER_REVIEW,
                    newStatus: DISPUTE_STATUS.UNDER_REVIEW
                }),
                redirectUrl: `/dispute/${dispute._id}`
            }
        ];

        await saveNotification(sellerResponseNotifications);

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

        /* create chat message for admin decision ----------------------------- */
        const { room } = await findOrCreateOneOnOneRoom(dispute.raisedBy, dispute.sellerId);

        // Determine message content based on decision
        let messageTitle = '';
        let messageTheme = '';
        let messageContent = '';

        if (decision === 'BUYER') {
            messageTitle = 'Dispute Resolved - In Favor of Buyer';
            messageTheme = 'success';
            messageContent = `Admin has resolved the dispute in favor of the buyer. ${disputeAmountPercent > 0 ? `Refund: ${disputeAmountPercent}%` : ''}`;
        } else if (decision === 'SELLER') {
            messageTitle = 'Dispute Resolved - In Favor of Seller';
            messageTheme = 'success';
            messageContent = 'Admin has resolved the dispute in favor of the seller.';
        } else {
            messageTitle = 'Dispute Resolved';
            messageTheme = 'info';
            messageContent = `Admin has resolved the dispute. Decision: ${decision}`;
        }

        // Create system message for admin decision
        const decisionMessage = new ChatMessage({
            chatRoom: room._id,
            messageType: 'TEXT',
            systemMeta: {
                statusType: 'DISPUTE',
                status: DISPUTE_STATUS.RESOLVED,
                orderId: dispute.orderId,
                disputeId: dispute._id,
                title: messageTitle,
                meta: createStandardizedChatMeta({
                    disputeId: dispute.disputeId,
                    decision: decision,
                    decisionNote: decisionNote,
                    disputeAmountPercent: disputeAmountPercent || 0,
                    resolvedBy: 'admin',
                    sellerId: dispute.sellerId,
                    buyerId: dispute.raisedBy,
                    disputeStatus: DISPUTE_STATUS.RESOLVED
                }),
                actions: [
                    {
                        label: "View Dispute",
                        url: `/dispute/${dispute._id}`,
                        type: "primary"
                    }
                ],
                theme: messageTheme,
                content: messageContent
            }
        });

        await decisionMessage.save();

        // Update chat room's last message
        await ChatRoom.findByIdAndUpdate(
            room._id,
            {
                lastMessage: decisionMessage._id,
                updatedAt: new Date()
            }
        );

        // Emit system message
        const io = req.app.get('io');
        await emitSystemMessage(io, decisionMessage, room, dispute.raisedBy, dispute.sellerId);

        // Send notifications to both buyer and seller
        const adminDecisionNotifications = [
            {
                recipientId: dispute.raisedBy,
                userId: req.user.userId,
                orderId: dispute.orderId,
                disputeId: dispute._id,
                type: NOTIFICATION_TYPES.DISPUTE,
                title: "Dispute Resolved",
                message: `Your dispute has been resolved by admin. Decision: ${decision === 'BUYER' ? 'In your favor' : decision === 'SELLER' ? 'In favor of seller' : decision}`,
                meta: createStandardizedNotificationMeta({
                    disputeId: dispute._id.toString(),
                    decision: decision,
                    decisionNote: decisionNote,
                    disputeAmountPercent: disputeAmountPercent || 0,
                    resolvedBy: 'admin',
                    sellerId: dispute.sellerId,
                    buyerId: dispute.raisedBy,
                    status: DISPUTE_STATUS.RESOLVED,
                    newStatus: DISPUTE_STATUS.RESOLVED
                }),
                redirectUrl: `/dispute/${dispute._id}`
            },
            {
                recipientId: dispute.sellerId,
                userId: req.user.userId,
                orderId: dispute.orderId,
                disputeId: dispute._id,
                type: NOTIFICATION_TYPES.DISPUTE,
                title: "Dispute Resolved",
                message: `The dispute has been resolved by admin. Decision: ${decision === 'SELLER' ? 'In your favor' : decision === 'BUYER' ? 'In favor of buyer' : decision}`,
                meta: createStandardizedNotificationMeta({
                    disputeId: dispute._id.toString(),
                    decision: decision,
                    decisionNote: decisionNote,
                    disputeAmountPercent: disputeAmountPercent || 0,
                    resolvedBy: 'admin',
                    sellerId: dispute.sellerId,
                    buyerId: dispute.raisedBy,
                    status: DISPUTE_STATUS.RESOLVED,
                    newStatus: DISPUTE_STATUS.RESOLVED
                }),
                redirectUrl: `/dispute/${dispute._id}`
            }
        ];

        await saveNotification(adminDecisionNotifications);

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
                .populate('raisedBy', 'userName profileImage isLive is_Id_verified is_Verified_Seller is_Preferred_seller is_Preferred_seller averageRatting')
                .populate('sellerId', 'userName profileImage isLive is_Id_verified is_Verified_Seller is_Preferred_seller is_Preferred_seller averageRatting')
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
            .populate('raisedBy', 'userName profileImage isLive is_Id_verified is_Verified_Seller is_Preferred_seller averageRatting')
            .populate('sellerId', 'userName profileImage isLive is_Id_verified is_Verified_Seller is_Preferred_seller averageRatting').lean()

        if (!dispute) {
            return apiErrorRes(HTTP_STATUS.NOT_FOUND, res, 'No dispute found for this order');
        }

        // Get dispute history
        const disputeHistory = await DisputeHistory.find({ disputeId: dispute._id })
            .populate('actor', 'userName profileImage isLive is_Id_verified is_Verified_Seller is_Preferred_seller averageRatting')
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
router.get('/disputeByOrderId/:orderId', perApiLimiter(), disputeByOrderId);

module.exports = router;