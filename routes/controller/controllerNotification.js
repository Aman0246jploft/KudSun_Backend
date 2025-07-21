const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const globalCrudController = require('./globalCrudController');
const { Notification } = require('../../db');

const { moduleSchema } = require('../services/validations/moduleValidation');
const { moduleSchemaForId } = require('../services/validations/globalCURDValidation');
const perApiLimiter = require('../../middlewares/rateLimiter');
const HTTP_STATUS = require('../../utils/statusCode');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');

const list = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            read,
            type,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const page = parseInt(pageNo);
        const limit = parseInt(size);
        const skip = (page - 1) * limit;

        // Build filter object
        const filter = {
            recipientId: req.user.userId,
            isDeleted: { $ne: true }
        };

        // Optional filters
        if (read !== undefined) {
            filter.read = read === 'true';
        }

        if (type) {
            filter.type = type;
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Fetch notifications with pagination
        const [notifications, total] = await Promise.all([
            Notification.find(filter)
                .populate('userId', 'userName profileImage')
                .populate('productId', 'title productImages')
                .populate('orderId', 'totalAmount status')
                .populate('chatId', 'lastMessage')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            Notification.countDocuments(filter)
        ]);

        return apiSuccessRes(HTTP_STATUS.OK, res, 'Notifications fetched successfully', {
            pageNo: page,
            size: limit,
            total,
            totalPages: Math.ceil(total / limit),
            data: notifications
        });

    } catch (error) {
        console.error('Error fetching notifications:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, 'Failed to fetch notifications', error.message);
    }
};

router.get('/list', list)

module.exports = router;
