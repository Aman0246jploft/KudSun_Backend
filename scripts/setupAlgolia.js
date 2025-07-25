const { configureIndices } = require('../config/algolia');
const { batchIndexProducts, indexThread, indexUser } = require('../routes/services/serviceAlgolia');
const { SellProduct, Thread, User } = require('../db');
require('dotenv').config();

/**
 * Setup Algolia indices and sync existing data
 */
async function setupAlgolia() {
    try {
        console.log('🚀 Starting Algolia setup...');

        // Step 1: Configure indices
        console.log('📝 Configuring Algolia indices...');
        await configureIndices();

        // Step 2: Sync existing products
        console.log('📦 Syncing existing products...');
        await syncProducts();

        // Step 3: Sync existing threads
        console.log('💬 Syncing existing threads...');
        await syncThreads();

        // Step 4: Sync existing users
        console.log('👥 Syncing existing users...');
        await syncUsers();

        console.log('✅ Algolia setup completed successfully!');
        
    } catch (error) {
        console.error('❌ Algolia setup failed:', error);
        process.exit(1);
    }
}

/**
 * Sync all existing products to Algolia
 */
async function syncProducts() {
    try {
        const batchSize = 100;
        let skip = 0;
        let totalSynced = 0;

        while (true) {
            const products = await SellProduct.find({ 
                isDeleted: false,
                // Only sync published products (not drafts)
            })
            .populate('categoryId', 'name')
            .skip(skip)
            .limit(batchSize)
            .lean();

            if (products.length === 0) break;

            console.log(`📦 Syncing products ${skip + 1} to ${skip + products.length}...`);
            
            await batchIndexProducts(products);
            
            totalSynced += products.length;
            skip += batchSize;

            // Add a small delay to avoid overwhelming Algolia
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`✅ Synced ${totalSynced} products to Algolia`);
    } catch (error) {
        console.error('❌ Error syncing products:', error);
        throw error;
    }
}

/**
 * Sync all existing threads to Algolia
 */
async function syncThreads() {
    try {
        const batchSize = 100;
        let skip = 0;
        let totalSynced = 0;

        while (true) {
            const threads = await Thread.find({ 
                isDeleted: false 
            })
            .populate('categoryId', 'name')
            .skip(skip)
            .limit(batchSize)
            .lean();

            if (threads.length === 0) break;

            console.log(`💬 Syncing threads ${skip + 1} to ${skip + threads.length}...`);
            
            // Index threads one by one (no batch function for threads yet)
            for (const thread of threads) {
                await indexThread(thread);
            }
            
            totalSynced += threads.length;
            skip += batchSize;

            // Add a small delay to avoid overwhelming Algolia
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`✅ Synced ${totalSynced} threads to Algolia`);
    } catch (error) {
        console.error('❌ Error syncing threads:', error);
        throw error;
    }
}

/**
 * Sync all existing users to Algolia
 */
async function syncUsers() {
    try {
        const batchSize = 100;
        let skip = 0;
        let totalSynced = 0;

        while (true) {
            const users = await User.find({ 
                isDeleted: false,
                step: 5 // Only sync completed registrations
            })
            .skip(skip)
            .limit(batchSize)
            .lean();

            if (users.length === 0) break;

            console.log(`👥 Syncing users ${skip + 1} to ${skip + users.length}...`);
            
            // Index users one by one
            for (const user of users) {
                await indexUser(user);
            }
            
            totalSynced += users.length;
            skip += batchSize;

            // Add a small delay to avoid overwhelming Algolia
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`✅ Synced ${totalSynced} users to Algolia`);
    } catch (error) {
        console.error('❌ Error syncing users:', error);
        throw error;
    }
}

/**
 * Clear all Algolia indices (use with caution!)
 */
async function clearAlgolia() {
    try {
        const { getIndices } = require('../config/algolia');
        const indices = getIndices();

        console.log('🗑️ Clearing all Algolia indices...');
        
        await Promise.all([
            indices.products.clearObjects(),
            indices.threads.clearObjects(),
            indices.users.clearObjects()
        ]);

        console.log('✅ All Algolia indices cleared');
    } catch (error) {
        console.error('❌ Error clearing Algolia indices:', error);
        throw error;
    }
}

// Command line interface
async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'setup':
            await setupAlgolia();
            break;
        case 'sync-products':
            await syncProducts();
            break;
        case 'sync-threads':
            await syncThreads();
            break;
        case 'sync-users':
            await syncUsers();
            break;
        case 'clear':
            await clearAlgolia();
            break;
        case 'configure':
            await configureIndices();
            break;
        default:
            console.log(`
Usage: node scripts/setupAlgolia.js <command>

Commands:
  setup         - Complete Algolia setup (configure + sync all data)
  sync-products - Sync only products
  sync-threads  - Sync only threads  
  sync-users    - Sync only users
  configure     - Only configure indices settings
  clear         - Clear all indices (use with caution!)
            `);
    }

    process.exit(0);
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });
}

module.exports = {
    setupAlgolia,
    syncProducts,
    syncThreads,
    syncUsers,
    clearAlgolia
}; 