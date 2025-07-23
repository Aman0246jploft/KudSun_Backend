const { SellProduct } = require('../../db');
const { createQueue, addJobToQueue, processQueue } = require('./serviceBull');

// Create trending update queue
const TRENDING_UPDATE_QUEUE = 'trending-update-queue';
const trendingQueue = createQueue(TRENDING_UPDATE_QUEUE);

// Trending thresholds (configurable)
const TRENDING_THRESHOLDS = {
    // VIEW_COUNT: 100,        // Minimum views to be considered trending
    // TIME_WINDOW_DAYS: 7,    // Views within last 7 days
    // MAX_TRENDING_PRODUCTS: 5000000000000 // Maximum products to mark as trending



    VIEW_COUNT: 5,        // Minimum views to be considered trending
    TIME_WINDOW_DAYS: 7,    // Views within last 7 days
    MAX_TRENDING_PRODUCTS: 5000000000000 // Maximum products to mark as trending





};

// Add job to update trending status
const addTrendingUpdateJob = async (productId) => {
    try {
        await addJobToQueue(trendingQueue, { productId }, {
            delay: 5000, // 5 second delay to batch updates
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });
        console.log(`Trending update job added for product: ${productId}`);
    } catch (error) {
        console.error('Error adding trending update job:', error);
    }
};

// Process trending update jobs
const processTrendingUpdate = async (job) => {
    try {
        const { productId } = job.data;

        // Get product with current view count
        const product = await SellProduct.findById(productId);
        if (!product) {
            console.log(`Product ${productId} not found for trending update`);
            return;
        }

        // Check if product meets trending criteria
        const shouldBeTrending = await checkTrendingCriteria(product);

        // Update trending status if changed
        if (product.isTrending !== shouldBeTrending) {
            await SellProduct.findByIdAndUpdate(productId, {
                isTrending: shouldBeTrending
            });
            console.log(`Product ${productId} trending status updated to: ${shouldBeTrending}`);
        }

    } catch (error) {
        console.error('Error processing trending update job:', error);
        throw error;
    }
};

// Check if product meets trending criteria
const checkTrendingCriteria = async (product) => {
    try {
        // Basic criteria: view count threshold
        if (product.viewCount < TRENDING_THRESHOLDS.VIEW_COUNT) {
            return false;
        }

        // Check if product is active and not sold
        if (product.isDeleted || product.isDisable || product.isSold) {
            return false;
        }

        // Check if we haven't exceeded max trending products
        const currentTrendingCount = await SellProduct.countDocuments({
            isTrending: true,
            isDeleted: false,
            isDisable: false
        });

        if (currentTrendingCount >= TRENDING_THRESHOLDS.MAX_TRENDING_PRODUCTS) {
            // If at max, check if this product has higher views than lowest trending
            const lowestTrending = await SellProduct.findOne({
                isTrending: true,
                isDeleted: false,
                isDisable: false
            }).sort({ viewCount: 1 });

            if (lowestTrending && product.viewCount <= lowestTrending.viewCount) {
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error checking trending criteria:', error);
        return false;
    }
};

// Manual trending update for all products
const updateAllTrendingStatus = async () => {
    try {
        console.log('Starting bulk trending status update...');

        // Get all active products
        const products = await SellProduct.find({
            isDeleted: false,
            isDisable: false,
            viewCount: { $gte: TRENDING_THRESHOLDS.VIEW_COUNT }
        }).sort({ viewCount: -1 });

        let updatedCount = 0;
        let trendingCount = 0;

        for (const product of products) {
            const shouldBeTrending = await checkTrendingCriteria(product);

            if (product.isTrending !== shouldBeTrending) {
                await SellProduct.findByIdAndUpdate(product._id, {
                    isTrending: shouldBeTrending
                });
                updatedCount++;
            }

            if (shouldBeTrending) {
                trendingCount++;
            }
        }

        console.log(`Bulk trending update completed: ${updatedCount} products updated, ${trendingCount} currently trending`);
        return { updatedCount, trendingCount };
    } catch (error) {
        console.error('Error in bulk trending update:', error);
        throw error;
    }
};

// Initialize queue processing
processQueue(trendingQueue, processTrendingUpdate);

module.exports = {
    addTrendingUpdateJob,
    updateAllTrendingStatus,
    checkTrendingCriteria,
    TRENDING_THRESHOLDS
}; 