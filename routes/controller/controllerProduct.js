const express = require('express');
const router = express.Router();
const { SellProduct, Category, User } = require('../../db');
const { apiSuccessRes, apiErrorRes } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { SALE_TYPE } = require('../../utils/Role');
const mongoose = require('mongoose');

/**
 * Get products with advanced filtering
 * 
 * Filters supported:
 * - Search by title/description
 * - Category/Subcategory
 * - Price range
 * - Sale type (Fixed/Auction)
 * - Product status
 * - Location
 * - Seller rating
 * - Sort options
 * - Pagination
 */
const getProducts = async (req, res) => {
    try {
        const {
            // Search
            search,
            
            // Categories
            categoryId,
            subCategoryId,
            
            // Price Range
            minPrice,
            maxPrice,
            
            // Product Type
            saleType,
            
            // Status Filters
            isNew,
            isSold,
            
            // Location
            location,
            
            // Seller Filters
            sellerId,
            minSellerRating,
            isVerifiedSeller,
            
            // Auction Specific
            isAuctionOpen,
            
            // Sorting
            sortBy = 'createdAt',
            sortOrder = 'desc',
            
            // Pagination
            page = 1,
            limit = 10
        } = req.query;

        // Build filter object
        const filter = {
            isDeleted: false,
            isDisable: false
        };

        // Text Search
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Category Filters
        if (categoryId) {
            filter.categoryId = mongoose.Types.ObjectId(categoryId);
        }
        if (subCategoryId) {
            filter.subCategoryId = mongoose.Types.ObjectId(subCategoryId);
        }

        // Price Range
        if (minPrice !== undefined || maxPrice !== undefined) {
            filter.fixedPrice = {};
            if (minPrice !== undefined) filter.fixedPrice.$gte = Number(minPrice);
            if (maxPrice !== undefined) filter.fixedPrice.$lte = Number(maxPrice);
        }

        // Sale Type
        if (saleType) {
            filter.saleType = saleType;
        }

        // Product Status
        if (isNew !== undefined) {
            filter.isNew = isNew === 'true';
        }
        if (isSold !== undefined) {
            filter.isSold = isSold === 'true';
        }

        // Location
        if (location) {
            filter.location = { $regex: location, $options: 'i' };
        }

        // Seller ID
        if (sellerId) {
            filter.userId = mongoose.Types.ObjectId(sellerId);
        }

        // Auction Status
        if (isAuctionOpen !== undefined && saleType === SALE_TYPE.AUCTION) {
            filter['auctionSettings.isBiddingOpen'] = isAuctionOpen === 'true';
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Calculate skip value for pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Fetch products with populated fields
        const products = await SellProduct.find(filter)
            .populate({
                path: 'userId',
                select: 'userName profileImage isLive is_Id_verified is_Verified_Seller averageRatting',
                match: {
                    isDeleted: false,
                    isDisable: false,
                    ...(minSellerRating && { averageRatting: { $gte: Number(minSellerRating) } }),
                    ...(isVerifiedSeller && { is_Verified_Seller: true })
                }
            })
            .populate('categoryId', 'name')
            .populate('subCategoryId', 'name')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        // Filter out products where seller doesn't match criteria
        const filteredProducts = products.filter(product => product.userId !== null);

        // Get total count for pagination
        const total = await SellProduct.countDocuments(filter);

        // Format response
        const response = {
            products: filteredProducts.map(product => ({
                _id: product._id,
                title: product.title,
                description: product.description,
                price: product.fixedPrice,
                saleType: product.saleType,
                images: product.productImages,
                category: product.categoryId?.name,
                subCategory: product.subCategoryId?.name,
                location: product.location,
                condition: product.condition,
                seller: {
                    _id: product.userId?._id,
                    name: product.userId?.userName,
                    image: product.userId?.profileImage,
                    rating: product.userId?.averageRatting,
                    isVerified: product.userId?.is_Verified_Seller,
                    isLive: product.userId?.isLive
                },
                status: {
                    isNew: product.isNew,
                    isSold: product.isSold
                },
                auction: product.saleType === SALE_TYPE.AUCTION ? {
                    currentBid: product.auctionSettings?.currentBid,
                    isBiddingOpen: product.auctionSettings?.isBiddingOpen,
                    endsAt: product.auctionSettings?.biddingEndsAt
                } : null,
                createdAt: product.createdAt,
                updatedAt: product.updatedAt
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            },
            filters: {
                applied: {
                    search,
                    categoryId,
                    subCategoryId,
                    priceRange: minPrice || maxPrice ? { min: minPrice, max: maxPrice } : null,
                    saleType,
                    location,
                    seller: sellerId,
                    sort: { by: sortBy, order: sortOrder }
                }
            }
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Products fetched successfully", response);
    } catch (err) {
        console.error("Get products error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch products");
    }
};

/**
 * Get available filter options for products
 */
const getProductFilters = async (req, res) => {
    try {
        // Get unique categories
        const categories = await Category.find({ 
            isDeleted: false, 
            isDisable: false 
        })
        .select('name')
        .lean();

        // Get price range
        const priceStats = await SellProduct.aggregate([
            {
                $match: {
                    isDeleted: false,
                    isDisable: false,
                    fixedPrice: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: null,
                    minPrice: { $min: "$fixedPrice" },
                    maxPrice: { $max: "$fixedPrice" },
                    avgPrice: { $avg: "$fixedPrice" }
                }
            }
        ]);

        // Get unique locations
        const locations = await SellProduct.distinct('location', {
            isDeleted: false,
            isDisable: false,
            location: { $exists: true, $ne: null }
        });

        // Get seller rating range
        const sellerRatings = await User.aggregate([
            {
                $match: {
                    isDeleted: false,
                    isDisable: false,
                    averageRatting: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: null,
                    minRating: { $min: "$averageRatting" },
                    maxRating: { $max: "$averageRatting" }
                }
            }
        ]);

        const response = {
            categories: categories.map(cat => ({
                id: cat._id,
                name: cat.name
            })),
            priceRange: priceStats[0] ? {
                min: Math.floor(priceStats[0].minPrice),
                max: Math.ceil(priceStats[0].maxPrice),
                average: Math.round(priceStats[0].avgPrice)
            } : null,
            locations: locations,
            saleTypes: Object.values(SALE_TYPE),
            sellerRatings: sellerRatings[0] ? {
                min: Math.floor(sellerRatings[0].minRating),
                max: Math.ceil(sellerRatings[0].maxRating)
            } : null,
            sortOptions: [
                { field: 'createdAt', label: 'Date' },
                { field: 'fixedPrice', label: 'Price' },
                { field: 'title', label: 'Title' }
            ]
        };

        return apiSuccessRes(HTTP_STATUS.OK, res, "Filter options fetched successfully", response);
    } catch (err) {
        console.error("Get filter options error:", err);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, err.message || "Failed to fetch filter options");
    }
};

// Routes
router.get('/search', getProducts);
router.get('/filters', getProductFilters);

module.exports = router; 