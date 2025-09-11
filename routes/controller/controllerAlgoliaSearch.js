const express = require('express');
const multer = require('multer');
const upload = multer();
const router = express.Router();
const { SearchHistory, User, Category } = require('../../db');
const perApiLimiter = require('../../middlewares/rateLimiter');
const { apiErrorRes, apiSuccessRes, toObjectId } = require('../../utils/globalFunction');
const HTTP_STATUS = require('../../utils/statusCode');
const { searchProducts, searchThreads, searchUsers } = require('../services/serviceAlgolia');

/**
 * Universal search API using Algolia
 * Searches across products, threads, and users
 */
const universalSearch = async (req, res) => {
    try {
        const {
            q = '', // search query
            type = 'all', // 'products', 'threads', 'users', 'all'
            pageNo = 1,
            size = 20,
            // Filters
            categoryId,
            subCategoryId,
            minPrice,
            maxPrice,
            condition,
            saleType,
            deliveryFilter,
            isTrending,
            // Sorting
            sortBy = 'relevance',
            orderBy = 'desc'
        } = req.query;

        console.log('[UniversalSearch] Query Params:', req.query);

        const page = parseInt(pageNo) - 1; // Algolia uses 0-based pagination
        const limit = parseInt(size);
        const userId = req.user?.userId;

        console.log(`[UniversalSearch] Processed pagination - page: ${page}, limit: ${limit}`);
        if (userId && q.trim()) {
            console.log(`[UniversalSearch] Tracking search history for user: ${userId}, query: "${q.trim()}"`);
            await trackSearchHistory(userId, q.trim());
        }

        const results = {};

        if (type === 'all' || type === 'products') {
            console.log('[UniversalSearch] Searching products with:', {
                q,
                page,
                hitsPerPage: limit,
                categoryId,
                subCategoryId,
                minPrice,
                maxPrice,
                condition,
                saleType,
                deliveryFilter,
                isTrending,
                sortBy,
                orderBy,
                isSold: false,
                isDeleted: false,
                isDisable: false
            });
            results.products = await searchProductsWithAlgolia(q, {
                page,
                hitsPerPage: limit,
                categoryId,
                subCategoryId,
                minPrice,
                maxPrice,
                condition,
                saleType,
                deliveryFilter,
                isTrending,
                sortBy,
                orderBy,
                isSold: false,
                isDeleted: false,
                isDisable: false
            });
            console.log('[UniversalSearch] Product search results:', results.products);
        }

        if (type === 'all' || type === 'threads') {
            console.log('[UniversalSearch] Searching threads with:', {
                q,
                page,
                hitsPerPage: limit,
                categoryId,
                subCategoryId,
                sortBy,
                orderBy
            });
            results.threads = await searchThreadsWithAlgolia(q, {
                page,
                hitsPerPage: limit,
                categoryId,
                subCategoryId,
                sortBy,
                orderBy
            });
            console.log('[UniversalSearch] Thread search results:', results.threads);
        }

        // If searching all, limit results per category
        if (type === 'all') {
            if (results.products) {
                console.log('[UniversalSearch] Limiting product hits to 10');
                results.products.hits = results.products.hits.slice(0, 10);
            }
            if (results.threads) {
                console.log('[UniversalSearch] Limiting thread hits to 10');
                results.threads.hits = results.threads.hits.slice(0, 10);
            }
        }

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Search results", {
            query: q,
            type,
            pageNo: parseInt(pageNo),
            size: limit,
            results
        });

    } catch (error) {
        console.error('Universal search error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Search failed", error.message);
    }
};


/**
 * Search products using Algolia with advanced filters
 */
const searchProductsAPI = async (req, res) => {
    try {
        const {
            q = '',
            pageNo = 1,
            size = 20,
            // Filters
            categoryId,
            subCategoryId,
            minPrice,
            maxPrice,
            condition,
            saleType,
            deliveryFilter,
            isTrending,
            tags,
            // Sorting
            sortBy = 'createdAt',
            orderBy = 'desc',
            // Location filters
            provinceId,
            districtId
        } = req.query;

        const page = parseInt(pageNo) - 1; // Algolia uses 0-based pagination
        const limit = parseInt(size);
        const userId = req.user?.userId;

        // Track search query if user is logged in and query is not empty
        if (userId && q.trim()) {
            await trackSearchHistory(userId, q.trim());
        }

        const searchOptions = {
            page,
            hitsPerPage: limit,
            categoryId,
            subCategoryId,
            minPrice,
            maxPrice,
            condition,
            saleType,
            deliveryFilter,
            isTrending,
            tags,
            provinceId,
            districtId,
            sortBy,
            orderBy
        };

        const algoliaResults = await searchProductsWithAlgolia(q, searchOptions);

        // Convert Algolia results to your API format
        const products = algoliaResults.hits.map(hit => ({
            ...hit,
            _id: hit.objectID,
            isLiked: false // Will be populated separately if needed
        }));

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Products found", {
            query: q,
            pageNo: parseInt(pageNo),
            size: limit,
            total: algoliaResults.nbHits,
            totalPages: algoliaResults.nbPages,
            products,
            facets: algoliaResults.facets,
            processingTimeMS: algoliaResults.processingTimeMS
        });

    } catch (error) {
        console.error('Product search error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Product search failed", error.message);
    }
};

/**
 * Search threads using Algolia
 */
const searchThreadsAPI = async (req, res) => {
    try {
        const {
            q = '',
            pageNo = 1,
            size = 20,
            // Filters
            categoryId,
            subCategoryId,
            minBudget,
            maxBudget,
            isTrending,
            tags,
            // Sorting
            sortBy = 'relevance',
            orderBy = 'desc'
        } = req.query;

        const page = parseInt(pageNo) - 1;
        const limit = parseInt(size);
        const userId = req.user?.userId;

        // Track search query
        if (userId && q.trim()) {
            await trackSearchHistory(userId, q.trim());
        }

        const searchOptions = {
            page,
            hitsPerPage: limit,
            categoryId,
            subCategoryId,
            minBudget,
            maxBudget,
            isTrending,
            tags,
            sortBy,
            orderBy
        };

        const algoliaResults = await searchThreadsWithAlgolia(q, searchOptions);

        const threads = algoliaResults.hits.map(hit => ({
            ...hit,
            _id: hit.objectID
        }));

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Threads found", {
            query: q,
            pageNo: parseInt(pageNo),
            size: limit,
            total: algoliaResults.nbHits,
            totalPages: algoliaResults.nbPages,
            threads,
            facets: algoliaResults.facets,
            processingTimeMS: algoliaResults.processingTimeMS
        });

    } catch (error) {
        console.error('Thread search error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Thread search failed", error.message);
    }
};

/**
 * Get search suggestions/autocomplete
 */
const getSearchSuggestions = async (req, res) => {
    try {
        const {
            q = '',
            type = 'all', // default to 'all'
            limit = 10,
            // Filters for products
            categoryId,
            subCategoryId,
            minPrice,
            maxPrice,
            condition,
            saleType,
            deliveryFilter,
            isTrending,
            tags,
            // Filters for threads
            minBudget,
            maxBudget
        } = req.query;

        if (!q || q.length < 2) {
            return apiSuccessRes(req,HTTP_STATUS.OK, res, "Suggestions", []);
        }

        let suggestions = [];

        // Helper to fetch product suggestions
        const getProductSuggestions = async () => {
            const filters = ['isSold=0', 'isDeleted=0', 'isDisable=0'];
            const facetFilters = [];
            const numericFilters = [];
            if (categoryId) facetFilters.push(`categoryId:${categoryId}`);
            if (subCategoryId) facetFilters.push(`subCategoryId:${subCategoryId}`);
            if (condition) facetFilters.push(`condition:${condition}`);
            if (saleType) facetFilters.push(`saleType:${saleType}`);
            if (isTrending !== undefined) facetFilters.push(`isTrending:${isTrending}`);
            if (minPrice !== undefined && minPrice !== '') numericFilters.push(`fixedPrice >= ${parseFloat(minPrice)}`);
            if (maxPrice !== undefined && maxPrice !== '') numericFilters.push(`fixedPrice <= ${parseFloat(maxPrice)}`);
            const searchOptions = {
                hitsPerPage: parseInt(limit),
                page: 0,
                filters: filters.join(' AND '),
                facetFilters,
                numericFilters,
                attributesToRetrieve: ['title', 'objectID'],
                attributesToHighlight: ['title'],
                typoTolerance: true
            };
            const results = await searchProducts(q, searchOptions);
            return results.hits.map(hit => ({
                id: hit.objectID,
                title: hit.title,
                type: 'product',
                highlight: hit._highlightResult?.title?.value || hit.title
            }));
        };

        // Helper to fetch thread suggestions
        const getThreadSuggestions = async () => {
            const facetFilters = [];
            const numericFilters = [];
            if (categoryId) facetFilters.push(`categoryId:${categoryId}`);
            if (subCategoryId) facetFilters.push(`subCategoryId:${subCategoryId}`);
            if (isTrending !== undefined) facetFilters.push(`isTrending:${isTrending}`);
            if (minBudget !== undefined && minBudget !== '') numericFilters.push(`budgetRange.min >= ${parseFloat(minBudget)}`);
            if (maxBudget !== undefined && maxBudget !== '') numericFilters.push(`budgetRange.max <= ${parseFloat(maxBudget)}`);
            const searchOptions = {
                hitsPerPage: parseInt(limit),
                page: 0,
                // No filters for isClosed, isDeleted, isDisable
                facetFilters,
                numericFilters,
                attributesToRetrieve: ['title', 'objectID', 'isClosed'],
                attributesToHighlight: ['title'],
                typoTolerance: true
            };
            const results = await searchThreads(q, searchOptions);
            return results.hits.map(hit => ({
                id: hit.objectID,
                title: hit.title,
                type: 'thread',
                highlight: hit._highlightResult?.title?.value || hit.title
            }));
        };

        // Helper to fetch user suggestions
        const getUserSuggestions = async () => {
            const filters = ['isDeleted=0', 'isDisable=0'];
            const searchOptions = {
                hitsPerPage: parseInt(limit),
                page: 0,
                filters: filters.join(' AND '),
                attributesToRetrieve: ['userName', 'objectID'],
                attributesToHighlight: ['userName'],
                typoTolerance: true
            };
            // You may need to implement searchUsers in your Algolia service if not already present
            const results = await searchUsers(q, searchOptions);
            return results.hits.map(hit => ({
                id: hit.objectID,
                title: hit.userName,
                type: 'user',
                highlight: hit._highlightResult?.userName?.value || hit.userName
            }));
        };

        if (type === 'products') {
            suggestions = await getProductSuggestions();
        } else if (type === 'threads') {
            suggestions = await getThreadSuggestions();
        } else if (type === 'users') {
            suggestions = await getUserSuggestions();
        } else { // type === 'all' or not specified
            const [productSuggestions, threadSuggestions, userSuggestions] = await Promise.all([
                getProductSuggestions(),
                getThreadSuggestions(),
                getUserSuggestions()
            ]);
            // Option 1: Combine and limit total
            suggestions = [...productSuggestions, ...threadSuggestions, ...userSuggestions].slice(0, limit);
            // Option 2: Return separately
            // suggestions = { products: productSuggestions, threads: threadSuggestions, users: userSuggestions };
        }

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Search suggestions", suggestions);

    } catch (error) {
        console.error('Search suggestions error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to get suggestions", error.message);
    }
};

/**
 * Track product view/click
 */
const trackProductView = async (req, res) => {
    try {
        const { productId } = req.params;
        const userId = req.user?.userId;

        if (!productId) {
            return apiErrorRes(HTTP_STATUS.BAD_REQUEST, res, "Product ID is required");
        }

        // Here you can implement view tracking logic
        // For now, we'll just track it as a search history with the product title
        if (userId) {
            // You might want to fetch the product title and save it
            // For now, just save the product ID as search term
            await trackSearchHistory(userId, `viewed:${productId}`, 'product_view');
        }

        return apiSuccessRes(req,HTTP_STATUS.OK, res, "Product view tracked");

    } catch (error) {
        console.error('Track product view error:', error);
        return apiErrorRes(HTTP_STATUS.INTERNAL_SERVER_ERROR, res, "Failed to track view");
    }
};

/**
 * Helper function to search products with Algolia filters
 */
async function searchProductsWithAlgolia(query, options = {}) {
    const {
        page = 0,
        hitsPerPage = 20,
        categoryId,
        subCategoryId,
        minPrice,
        maxPrice,
        condition,
        saleType,
        deliveryFilter,
        isTrending,
        tags,
        provinceId,
        districtId,
        sortBy = 'relevance',
        orderBy = 'desc'
    } = options;


    // Build filters
    const filters = [];
    const facetFilters = [];
    const numericFilters = [];

    // // Basic filters
    filters.push('isDeleted:false');
    filters.push('isDisable:false');
    filters.push('isSold:false');

    // Category filters
    if (categoryId) facetFilters.push(`categoryId:${categoryId}`);
    if (subCategoryId) facetFilters.push(`subCategoryId:${subCategoryId}`);

    // Condition filter
    if (condition) facetFilters.push(`condition:${condition}`);

    // Sale type filter
    if (saleType) facetFilters.push(`saleType:${saleType}`);

    // Delivery filter
    if (deliveryFilter === 'free') {
        facetFilters.push(['deliveryType:FREE_SHIPPING', 'deliveryType:LOCAL_PICKUP']);
    } else if (deliveryFilter === 'charged') {
        facetFilters.push('deliveryType:CHARGE_SHIPPING');
    }

    // Trending filter
    if (isTrending !== undefined) {
        facetFilters.push(`isTrending:${isTrending}`);
    }

    // Tags filter
    if (tags) {
        const tagArray = Array.isArray(tags) ? tags : tags.split(',');
        tagArray.forEach(tag => facetFilters.push(`tags:${tag.trim()}`));
    }

    // Price range filter
    if (minPrice !== undefined && minPrice !== '') {
        numericFilters.push(`fixedPrice >= ${parseFloat(minPrice)}`);
    }
    if (maxPrice !== undefined && maxPrice !== '') {
        numericFilters.push(`fixedPrice <= ${parseFloat(maxPrice)}`);
    }

    // Sort options
    let sortOptions = [];
    if (sortBy !== 'relevance') {
        const direction = orderBy === 'desc' ? 'desc' : 'asc';
        if (sortBy === 'price') {
            sortOptions = [`fixedPrice:${direction}`];
        } else if (sortBy === 'created') {
            sortOptions = [`createdAt:${direction}`];
        } else if (sortBy === 'views') {
            sortOptions = [`viewCount:${direction}`];
        }
    }

    const searchOptions = {
        page,
        hitsPerPage,
        ignorePlurals: true,
        removeStopWords: true,
        typoTolerance: true,
        filters: filters.join(' AND '),
        facetFilters,
        numericFilters,
        facets: ['categoryId', 'subCategoryId', 'condition', 'saleType', 'deliveryType', 'tags'],
        ...(sortOptions.length > 0 && { indexName: `kudsun_products_${sortOptions[0]}` })
    };

    return await searchProducts(query, searchOptions);
}

/**
 * Helper function to search threads with Algolia filters
 */
async function searchThreadsWithAlgolia(query, options = {}) {
    const {
        page = 0,
        hitsPerPage = 20,
        categoryId,
        subCategoryId,
        minBudget,
        maxBudget,
        isTrending,
        tags,
        sortBy = 'relevance',
        orderBy = 'desc'
    } = options;

    const filters = [];
    const facetFilters = [];
    const numericFilters = [];

    // Basic filters
    filters.push('isDeleted:false');

    // Category filters
    if (categoryId) facetFilters.push(`categoryId:${categoryId}`);
    if (subCategoryId) facetFilters.push(`subCategoryId:${subCategoryId}`);

    // Budget filters
    if (minBudget !== undefined && minBudget !== '') {
        numericFilters.push(`budgetRange.min >= ${parseFloat(minBudget)}`);
    }
    if (maxBudget !== undefined && maxBudget !== '') {
        numericFilters.push(`budgetRange.max <= ${parseFloat(maxBudget)}`);
    }

    // Trending filter
    if (isTrending !== undefined) {
        facetFilters.push(`isTrending:${isTrending}`);
    }

    // Tags filter
    if (tags) {
        const tagArray = Array.isArray(tags) ? tags : tags.split(',');
        tagArray.forEach(tag => facetFilters.push(`tags:${tag.trim()}`));
    }

    const searchOptions = {
        page,
        hitsPerPage,
        filters: filters.join(' AND '),
        facetFilters,
        numericFilters,
        facets: ['categoryId', 'subCategoryId', 'isTrending', 'tags']
    };

    return await searchThreads(query, searchOptions);
}

/**
 * Helper function to track search history
 */
async function trackSearchHistory(userId, searchQuery, type = 'search') {
    try {
        // Only track non-empty queries and avoid duplicates from the same session
        if (!searchQuery || searchQuery.length < 2) return;

        let history = await SearchHistory.findOne({
            userId: toObjectId(userId),
            searchQuery,
            type: type || 'search'
        });

        if (history) {
            // Update timestamp if exists
            history.lastSearched = new Date();
            history.searchCount = (history.searchCount || 0) + 1;
            if (history.isDeleted || history.isDisable) {
                history.isDeleted = false;
                history.isDisable = false;
            }
            await history.save();
        } else {
            // Create new search history
            await SearchHistory.create({
                userId: toObjectId(userId),
                searchQuery,
                type: type || 'search',
                searchCount: 1,
                lastSearched: new Date()
            });
        }
    } catch (error) {
        console.error('Error tracking search history:', error);
        // Don't throw error to avoid breaking the main search operation
    }
}

// Routes
router.get('/search', perApiLimiter(), universalSearch);


router.get('/products/search', searchProductsAPI);
router.get('/threads/search', perApiLimiter(), searchThreadsAPI);
router.get('/suggestions', perApiLimiter(), getSearchSuggestions);
router.post('/track-view/:productId', perApiLimiter(), trackProductView);

module.exports = router; 