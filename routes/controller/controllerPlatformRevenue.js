const express = require('express');
const router = express.Router();
const { PlatformRevenue } = require('../../db');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const moment = require('moment');

// Get overall platform revenue analytics
const getPlatformRevenue = async (req, res) => {
    try {
        const { startDate, endDate, revenueType } = req.query;

        // Build date range filter
        const dateFilter = {};
        if (startDate) {
            dateFilter.createdAt = { $gte: new Date(startDate) };
        }
        if (endDate) {
            dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };
        }

        // Build base query
        const baseQuery = {
            status: 'COMPLETED',
            isDeleted: false,
            ...dateFilter
        };

        if (revenueType) {
            baseQuery.revenueType = revenueType;
        }

        // Get total revenue
        const totalRevenue = await PlatformRevenue.aggregate([
            { $match: baseQuery },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Get revenue by type
        const revenueByType = await PlatformRevenue.aggregate([
            { $match: baseQuery },
            {
                $group: {
                    _id: '$revenueType',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 },
                    avgAmount: { $avg: '$amount' }
                }
            }
        ]);

        // Get daily revenue for trend
        const dailyRevenue = await PlatformRevenue.aggregate([
            { $match: baseQuery },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        day: { $dayOfMonth: '$createdAt' }
                    },
                    total: { $sum: '$amount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ]);

        // Get monthly revenue
        const monthlyRevenue = await PlatformRevenue.aggregate([
            { $match: baseQuery },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    total: { $sum: '$amount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        // Format response
        const response = {
            totalRevenue: totalRevenue[0]?.total || 0,
            revenueByType: revenueByType.map(item => ({
                type: item._id,
                total: item.total,
                count: item.count,
                average: item.avgAmount
            })),
            dailyTrend: dailyRevenue.map(item => ({
                date: new Date(item._id.year, item._id.month - 1, item._id.day),
                amount: item.total
            })),
            monthlyTrend: monthlyRevenue.map(item => ({
                date: new Date(item._id.year, item._id.month - 1, 1),
                amount: item.total
            }))
        };

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Platform revenue analytics fetched successfully", response);
    } catch (err) {
        console.error("Get platform revenue error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch platform revenue");
    }
};

// Get detailed revenue transactions
const getRevenueTransactions = async (req, res) => {
    try {
        const {
            pageNo = 1,
            size = 10,
            startDate,
            endDate,
            revenueType,
            status,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build filter
        const filter = { isDeleted: false };
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }
        if (revenueType) filter.revenueType = revenueType;
        if (status) filter.status = status;

        // Calculate pagination
        const skip = (parseInt(pageNo) - 1) * parseInt(size);
        const limit = parseInt(size);

        // Build sort
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Get total count
        const total = await PlatformRevenue.countDocuments(filter);

        // Get transactions
        const transactions = await PlatformRevenue.find(filter)
            .populate('orderId', 'totalAmount status')
            .populate('withdrawalId', 'amount status')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean();

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Revenue transactions fetched successfully", {
            pageNo: parseInt(pageNo),
            size: parseInt(size),
            total,
            totalPages: Math.ceil(total / limit),
            transactions
        });
    } catch (err) {
        console.error("Get revenue transactions error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch revenue transactions");
    }
};

// Get revenue summary for dashboard
const getRevenueSummary = async (req, res) => {
    try {
        // Get today's revenue
        const today = moment().startOf('day');
        const todayRevenue = await PlatformRevenue.aggregate([
            {
                $match: {
                    status: 'COMPLETED',
                    isDeleted: false,
                    createdAt: { $gte: today.toDate() }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Get this month's revenue
        const thisMonth = moment().startOf('month');
        const monthlyRevenue = await PlatformRevenue.aggregate([
            {
                $match: {
                    status: 'COMPLETED',
                    isDeleted: false,
                    createdAt: { $gte: thisMonth.toDate() }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Get revenue by type for this month
        const revenueByType = await PlatformRevenue.aggregate([
            {
                $match: {
                    status: 'COMPLETED',
                    isDeleted: false,
                    createdAt: { $gte: thisMonth.toDate() }
                }
            },
            {
                $group: {
                    _id: '$revenueType',
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Get daily trend for this month
        const dailyTrend = await PlatformRevenue.aggregate([
            {
                $match: {
                    status: 'COMPLETED',
                    isDeleted: false,
                    createdAt: { $gte: thisMonth.toDate() }
                }
            },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
                    },
                    total: { $sum: '$amount' }
                }
            },
            { $sort: { '_id.date': 1 } }
        ]);

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Revenue summary fetched successfully", {
            todayRevenue: todayRevenue[0]?.total || 0,
            monthlyRevenue: monthlyRevenue[0]?.total || 0,
            revenueByType: revenueByType.reduce((acc, curr) => {
                acc[curr._id] = curr.total;
                return acc;
            }, {}),
            dailyTrend: dailyTrend.map(item => ({
                date: item._id.date,
                amount: item.total
            }))
        });
    } catch (err) {
        console.error("Get revenue summary error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch revenue summary");
    }
};

// Routes
router.get('/analytics', getPlatformRevenue);
router.get('/transactions', getRevenueTransactions);
router.get('/summary', getRevenueSummary);

module.exports = router; 