const express = require('express');
const router = express.Router();
const { User, Order, SellProduct, PlatformRevenue } = require('../../db');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const moment = require('moment');

// Get monthly dashboard analytics with yearly filter
const getMonthlyAnalytics = async (req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;

        const startDate = new Date(Date.UTC(year, 0, 1)); // Jan 1st, 00:00:00 UTC
        const endDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)); // Dec 31st, 23:59:59.999 UTC


        // Users analytics - Monthly new users
        const monthlyUsers = await User.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    isDeleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: { month: { $month: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.month': 1 } }
        ]);




        // Revenue analytics - Monthly revenue from platform revenue
        const monthlyRevenue = await PlatformRevenue.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    status: 'COMPLETED',
                    isDeleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: { month: { $month: '$createdAt' } },
                    total: { $sum: '$amount' }
                }
            },
            { $sort: { '_id.month': 1 } }
        ]);

        // Products sold analytics - Monthly products sold (completed orders)
        const monthlyProductsSold = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    status: 'DELIVERED',
                    isDeleted: { $ne: true }
                }
            },
            {
                $unwind: '$items'
            },
            {
                $group: {
                    _id: { month: { $month: '$createdAt' } },
                    totalProducts: { $sum: '$items.quantity' }
                }
            },
            { $sort: { '_id.month': 1 } }
        ]);

        // Initialize all months with zero values
        const months = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];

        const formatData = (monthlyData, keyName, valueKey) => {
            const dataMap = {};
            monthlyData.forEach(item => {
                dataMap[item._id.month] = item[valueKey] || 0;
            });

            return months.map((month, index) => ({
                month,
                [keyName]: dataMap[index + 1] || 0
            }));
        };


        // Format response data
        // Format response data
        const response = {
            year: parseInt(year),
            users: formatData(monthlyUsers, 'users', 'count'),
            revenue: formatData(monthlyRevenue, 'revenue', 'total'),
            productsSold: formatData(monthlyProductsSold, 'productsSold', 'totalProducts')
        };


        console.log("response", response)
        return apiSuccessRes(HTTP_STATUS.OK, res, "Monthly analytics fetched successfully", response);
    } catch (err) {
        console.error("Get monthly analytics error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch monthly analytics");
    }
};

// Get dashboard summary stats
const getDashboardSummary = async (req, res) => {
    try {
        const { year = new Date().getFullYear() } = req.query;

        const startDate = new Date(`${year}-01-01`);
        const endDate = new Date(`${year}-12-31`);

        // Total users for the year
        const totalUsers = await User.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate },
            isDeleted: { $ne: true }
        });

        // Total revenue for the year
        const totalRevenueResult = await PlatformRevenue.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    status: 'COMPLETED',
                    isDeleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Total products sold for the year
        const totalProductsSoldResult = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    status: 'DELIVERED',
                    isDeleted: { $ne: true }
                }
            },
            {
                $unwind: '$items'
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$items.quantity' }
                }
            }
        ]);

        // Total orders for the year
        const totalOrders = await Order.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate },
            isDeleted: { $ne: true }
        });

        const response = {
            year: parseInt(year),
            totalUsers,
            totalRevenue: totalRevenueResult[0]?.total || 0,
            totalProductsSold: totalProductsSoldResult[0]?.total || 0,
            totalOrders
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Dashboard summary fetched successfully", response);
    } catch (err) {
        console.error("Get dashboard summary error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch dashboard summary");
    }
};

// Get available years for filter dropdown
const getAvailableYears = async (req, res) => {
    try {
        // Get years from different collections
        const userYears = await User.aggregate([
            { $match: { isDeleted: { $ne: true } } },
            { $group: { _id: { $year: '$createdAt' } } }
        ]);

        const revenueYears = await PlatformRevenue.aggregate([
            { $match: { isDeleted: { $ne: true } } },
            { $group: { _id: { $year: '$createdAt' } } }
        ]);

        const orderYears = await Order.aggregate([
            { $match: { isDeleted: { $ne: true } } },
            { $group: { _id: { $year: '$createdAt' } } }
        ]);

        // Combine all years and remove duplicates
        const allYears = [
            ...userYears.map(y => y._id),
            ...revenueYears.map(y => y._id),
            ...orderYears.map(y => y._id)
        ];

        const uniqueYears = [...new Set(allYears)].sort((a, b) => b - a);

        return apiSuccessRes(HTTP_STATUS.OK, res, "Available years fetched successfully", {
            years: uniqueYears
        });
    } catch (err) {
        console.error("Get available years error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch available years");
    }
};

// Routes
router.get('/monthly-analytics', getMonthlyAnalytics);
router.get('/summary', getDashboardSummary);
router.get('/available-years', getAvailableYears);

module.exports = router; 