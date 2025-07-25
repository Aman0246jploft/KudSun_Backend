const algoliasearch = require('algoliasearch');

require('dotenv').config();

// Initialize Algolia client
const client = algoliasearch(
    process.env.ALGOLIA_APPLICATION_ID || 'YOUR_APP_ID',
    process.env.ALGOLIA_ADMIN_API_KEY || 'YOUR_ADMIN_KEY'
);

// Define index names
const INDICES = {
    PRODUCTS:  'kudsun_products',
    THREADS:  'kudsun_threads',
    USERS: 'kudsun_users',
};

// Get indices
const getIndices = () => ({
    products: client.initIndex(INDICES.PRODUCTS),
    threads: client.initIndex(INDICES.THREADS),
    users: client.initIndex(INDICES.USERS),
});

// Configure index settings
const configureIndices = async () => {
    const indices = getIndices();
    
    try {
        // Products index configuration
        await indices.products.setSettings({
            searchableAttributes: [
                'title',
                'description',
                'tags',
                'categoryName',
                'subCategoryName',
                'condition'
            ],
            attributesForFaceting: [
                'categoryId',
                'subCategoryId',
                'userId',
                'saleType',
                'condition',
                'deliveryType',
                'isTrending',
                'isSold',
                'tags',
                'specifics.parameterName',
                'specifics.valueName',
                'isDisable',
                "isDeleted"
            ],
            numericAttributesToIndex: [
                'fixedPrice',
                'viewCount',
                'commentCount',
                'createdAt'
            ],
            ranking: [
                'typo',
                'geo',
                'words',
                'filters',
                'proximity',
                'attribute',
                'exact',
                'custom'
            ],
            customRanking: [
                'desc(isTrending)',
                'desc(viewCount)',
                'desc(createdAt)'
            ]
        });

        // Threads index configuration
        await indices.threads.setSettings({
            searchableAttributes: [
                'title',
                'description',
                'tags',
                'categoryName',
                'subCategoryName'
            ],
            attributesForFaceting: [
                'categoryId',
                'subCategoryId',
                'userId',
                'isTrending',
                'tags',
                'budgetRange.min',
                'budgetRange.max'
            ],
            numericAttributesToIndex: [
                'budgetRange.min',
                'budgetRange.max',
                'viewCount',
                'commentCount',
                'createdAt'
            ],
            customRanking: [
                'desc(isTrending)',
                'desc(viewCount)',
                'desc(createdAt)'
            ]
        });

        // Users index configuration
        await indices.users.setSettings({
            searchableAttributes: [
                'userName',
                'email'
            ],
            attributesForFaceting: [
                'isDisable',
                'is_Verified_Seller',
                'is_Id_verified',
                'provinceId',
                'districtId',
                'averageRatting'
            ],
            numericAttributesToIndex: [
                'averageRatting',
                'createdAt'
            ],
            customRanking: [
                'desc(averageRatting)',
                'desc(is_Verified_Seller)',
                'desc(createdAt)'
            ]
        });

        console.log('✅ Algolia indices configured successfully');
    } catch (error) {
        console.error('❌ Error configuring Algolia indices:', error);
    }
};

module.exports = {
    client,
    getIndices,
    configureIndices,
    INDICES
}; 