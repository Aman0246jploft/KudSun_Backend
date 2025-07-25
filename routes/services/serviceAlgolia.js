const { getIndices } = require('../../config/algolia');
const { Category } = require('../../db');

/**
 * Transform product data for Algolia indexing
 */
const transformProductForAlgolia = async (product) => {
    try {
        let categoryName = null;
        let subCategoryName = null;

        // Get category and subcategory names
        if (product.categoryId) {
            const category = await Category.findById(product.categoryId).lean();
            if (category) {
                categoryName = category.name;
                const subCategory = category.subCategories?.find(
                    sub => sub._id.toString() === product.subCategoryId?.toString()
                );
                subCategoryName = subCategory ? subCategory.name : null;
            }
        }

        const algoliaRecord = {
            objectID: product._id.toString(),
            title: product.title,
            description: product.description,
            categoryId: product.categoryId?.toString(),
            categoryName,
            subCategoryId: product.subCategoryId?.toString(),
            subCategoryName,
            userId: product.userId?.toString(),
            saleType: product.saleType,
            fixedPrice: product.fixedPrice || 0,
            condition: product.condition,
            tags: product.tags || [],
            specifics: product.specifics?.map(spec => ({
                parameterId: spec.parameterId?.toString(),
                parameterName: spec.parameterName,
                valueId: spec.valueId?.toString(),
                valueName: spec.valueName
            })) || [],
            productImages: product.productImages || [],
            deliveryType: product.deliveryType,
            isTrending: product.isTrending || false,
            isSold: product.isSold || false,
            isDisable: product.isDisable || false,
            isDeleted: product.isDeleted || false,
            viewCount: product.viewCount || 0,
            commentCount: 0, // Will be calculated separately if needed
            createdAt: product.createdAt ? new Date(product.createdAt).getTime() : Date.now(),
            updatedAt: product.updatedAt ? new Date(product.updatedAt).getTime() : Date.now(),
            // Auction specific fields
            ...(product.auctionSettings && {
                auctionSettings: {
                    startingPrice: product.auctionSettings.startingPrice,
                    reservePrice: product.auctionSettings.reservePrice,
                    biddingEndsAt: product.auctionSettings.biddingEndsAt ?
                        new Date(product.auctionSettings.biddingEndsAt).getTime() : null,
                    isBiddingOpen: product.auctionSettings.isBiddingOpen || false
                }
            })
        };

        return algoliaRecord;
    } catch (error) {
        console.error('Error transforming product for Algolia:', error);
        throw error;
    }
};

/**
 * Transform thread data for Algolia indexing
 */
const transformThreadForAlgolia = async (thread) => {
    try {
        let categoryName = null;
        let subCategoryName = null;

        // Get category and subcategory names
        if (thread.categoryId) {
            const category = await Category.findById(thread.categoryId).lean();
            if (category) {
                categoryName = category.name;
                const subCategory = category.subCategories?.find(
                    sub => sub._id.toString() === thread.subCategoryId?.toString()
                );
                subCategoryName = subCategory ? subCategory.name : null;
            }
        }

        const algoliaRecord = {
            objectID: thread._id.toString(),
            title: thread.title,
            description: thread.description,
            categoryId: thread.categoryId?.toString(),
            categoryName,
            subCategoryId: thread.subCategoryId?.toString(),
            subCategoryName,
            userId: thread.userId?.toString(),
            tags: thread.tags || [],
            budgetRange: {
                min: thread.budgetRange?.min || 0,
                max: thread.budgetRange?.max || 0
            },
            budgetFlexible: thread.budgetFlexible || false,
            photos: thread.photos || [],
            isTrending: thread.isTrending || false,
            isClosed: thread.isClosed,
            isDisable: thread.isDisable || false,
            isDeleted: thread.isDeleted || false,
            viewCount: thread.viewCount || 0,
            commentCount: 0, // Will be calculated separately if needed
            createdAt: thread.createdAt ? new Date(thread.createdAt).getTime() : Date.now(),
            updatedAt: thread.updatedAt ? new Date(thread.updatedAt).getTime() : Date.now()
        };

        return algoliaRecord;
    } catch (error) {
        console.error('Error transforming thread for Algolia:', error);
        throw error;
    }
};

/**
 * Transform user data for Algolia indexing
 */
const transformUserForAlgolia = (user) => {
    try {
        const algoliaRecord = {
            objectID: user._id.toString(),
            userName: user.userName,
            email: user.email,
            profileImage: user.profileImage,
            isDisable: user.isDisable || false,
            is_Verified_Seller: user.is_Verified_Seller || false,
            is_Id_verified: user.is_Id_verified || false,
            isDisable: user.isDisable || false,
            isDeleted: user.isDeleted || false,
            averageRatting: user.averageRatting || 0,
            averageBuyerRatting: user.averageBuyerRatting || 0,
            provinceId: user.provinceId?.toString(),
            districtId: user.districtId?.toString(),
            createdAt: user.createdAt ? new Date(user.createdAt).getTime() : Date.now()
        };

        return algoliaRecord;
    } catch (error) {
        console.error('Error transforming user for Algolia:', error);
        throw error;
    }
};

/**
 * Add or update a product in Algolia
 */
const indexProduct = async (product) => {
    try {
        const indices = getIndices();
        const algoliaRecord = await transformProductForAlgolia(product);

        await indices.products.saveObject(algoliaRecord);
        console.log(`✅ Product ${product._id} indexed in Algolia`);

        return algoliaRecord;
    } catch (error) {
        console.error(`❌ Error indexing product ${product._id} in Algolia:`, error);
        // Don't throw error to avoid breaking the main operation
        return null;
    }
};

/**
 * Add or update a thread in Algolia
 */
const indexThread = async (thread) => {
    try {
        const indices = getIndices();
        const algoliaRecord = await transformThreadForAlgolia(thread);

        await indices.threads.saveObject(algoliaRecord);
        console.log(`✅ Thread ${thread._id} indexed in Algolia`);

        return algoliaRecord;
    } catch (error) {
        console.error(`❌ Error indexing thread ${thread._id} in Algolia:`, error);
        // Don't throw error to avoid breaking the main operation
        return null;
    }
};

/**
 * Add or update a user in Algolia
 */
const indexUser = async (user) => {
    try {
        const indices = getIndices();
        const algoliaRecord = transformUserForAlgolia(user);

        await indices.users.saveObject(algoliaRecord);
        console.log(`✅ User ${user._id} indexed in Algolia`);

        return algoliaRecord;
    } catch (error) {
        console.error(`❌ Error indexing user ${user._id} in Algolia:`, error);
        // Don't throw error to avoid breaking the main operation
        return null;
    }
};

/**
 * Delete a product from Algolia
 */
const deleteProducts = async (productId) => {
    try {
        const indices = getIndices();
        await indices.products.deleteObject(productId.toString());
        console.log(`✅ Product ${productId} deleted from Algolia`);
    } catch (error) {
        console.error(`❌ Error deleting product ${productId} from Algolia:`, error);
    }
};

/**
 * Delete a thread from Algolia
 */
const deleteThreads = async (threadId) => {
    try {
        const indices = getIndices();
        await indices.threads.deleteObject(threadId.toString());
        console.log(`✅ Thread ${threadId} deleted from Algolia`);
    } catch (error) {
        console.error(`❌ Error deleting thread ${threadId} from Algolia:`, error);
    }
};

/**
 * Delete a user from Algolia
 */
const deleteUsers = async (userId) => {
    try {
        const indices = getIndices();
        await indices.users.deleteObject(userId.toString());
        console.log(`✅ User ${userId} deleted from Algolia`);
    } catch (error) {
        console.error(`❌ Error deleting user ${userId} from Algolia:`, error);
    }
};

/**
 * Batch index multiple products
 */
const batchIndexProducts = async (products) => {
    try {
        const indices = getIndices();
        const algoliaRecords = [];

        for (const product of products) {
            const record = await transformProductForAlgolia(product);
            algoliaRecords.push(record);
        }

        await indices.products.saveObjects(algoliaRecords);
        console.log(`✅ ${products.length} products batch indexed in Algolia`);

        return algoliaRecords;
    } catch (error) {
        console.error(`❌ Error batch indexing products in Algolia:`, error);
        return [];
    }
};

/**
 * Search products in Algolia
 */
const searchProducts = async (query, options = {}) => {

    try {
        const indices = getIndices();
        const searchOptions = {
            hitsPerPage: options.hitsPerPage || 20,
            page: options.page || 0,
            filters: options.filters || '',
            facetFilters: options.facetFilters || [],
            numericFilters: options.numericFilters || [],
            ...options
        };
        const result = await indices.products.search(query, searchOptions);
        return result;
    } catch (error) {
        console.error('❌ Error searching products in Algolia:', error);
        throw error;
    }
};

/**
 * Search threads in Algolia
 */
const searchThreads = async (query, options = {}) => {

    try {
        const indices = getIndices();
        const searchOptions = {
            hitsPerPage: options.hitsPerPage || 20,
            page: options.page || 0,
            filters: options.filters || '',
            facetFilters: options.facetFilters || [],
            numericFilters: options.numericFilters || [],
            ...options
        };

        const result = await indices.threads.search(query, searchOptions);
        return result;
    } catch (error) {
        console.error('❌ Error searching threads in Algolia:', error);
        throw error;
    }
};

/**
 * Search users in Algolia
 */
const searchUsers = async (query, options = {}) => {
    try {
        const indices = getIndices();
        const searchOptions = {
            hitsPerPage: options.hitsPerPage || 20,
            page: options.page || 0,
            filters: options.filters || '',
            facetFilters: options.facetFilters || [],
            numericFilters: options.numericFilters || [],
            ...options
        };
        const result = await indices.users.search(query, searchOptions);
        return result;
    } catch (error) {
        console.error('❌ Error searching users in Algolia:', error);
        throw error;
    }
};

module.exports = {
    // Indexing functions
    indexProduct,
    indexThread,
    indexUser,
    batchIndexProducts,

    // Delete functions
    deleteProducts,
    deleteThreads,
    deleteUsers,

    // Search functions
    searchProducts,
    searchThreads,
    searchUsers,

    // Transform functions (for external use)
    transformProductForAlgolia,
    transformThreadForAlgolia,
    transformUserForAlgolia
}; 