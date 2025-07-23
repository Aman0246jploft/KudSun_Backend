const { Thread } = require('../../db');
const { createQueue, addJobToQueue, processQueue } = require('./serviceBull');

// Create thread trending update queue
const THREAD_TRENDING_UPDATE_QUEUE = 'thread-trending-update-queue';
const threadTrendingQueue = createQueue(THREAD_TRENDING_UPDATE_QUEUE);

// Thread trending thresholds (configurable)
const THREAD_TRENDING_THRESHOLDS = {
    VIEW_COUNT: 10,        // Minimum views to be considered trending
    TIME_WINDOW_DAYS: 7,    // Views within last 7 days
    MAX_TRENDING_THREADS: 5000000000000 // Maximum threads to mark as trending
};

// Add job to update thread trending status
const addThreadTrendingUpdateJob = async (threadId) => {
    try {
        await addJobToQueue(threadTrendingQueue, { threadId }, { 
            delay: 5000, // 5 second delay to batch updates
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });
    } catch (error) {
        console.error('Error adding thread trending update job:', error);
    }
};

// Process thread trending update jobs
const processThreadTrendingUpdate = async (job) => {
    try {
        const { threadId } = job.data;
        
        // Get thread with current view count
        const thread = await Thread.findById(threadId);
        if (!thread) {
            return;
        }

        // Check if thread meets trending criteria
        const shouldBeTrending = await checkThreadTrendingCriteria(thread);
        
        // Update trending status if changed
        if (thread.isTrending !== shouldBeTrending) {
            await Thread.findByIdAndUpdate(threadId, { 
                isTrending: shouldBeTrending 
            });
        }

    } catch (error) {
        console.error('Error processing thread trending update job:', error);
        throw error;
    }
};

// Check if thread meets trending criteria
const checkThreadTrendingCriteria = async (thread) => {
    try {
        // Basic criteria: view count threshold
        if (thread.viewCount < THREAD_TRENDING_THRESHOLDS.VIEW_COUNT) {
            return false;
        }

        // Check if thread is active and not closed
        if (thread.isDeleted || thread.isDisable || thread.isClosed) {
            return false;
        }

        // Check if we haven't exceeded max trending threads
        const currentTrendingCount = await Thread.countDocuments({ 
            isTrending: true,
            isDeleted: false,
            isDisable: false
        });

        if (currentTrendingCount >= THREAD_TRENDING_THRESHOLDS.MAX_TRENDING_THREADS) {
            // If at max, check if this thread has higher views than lowest trending
            const lowestTrending = await Thread.findOne({ 
                isTrending: true,
                isDeleted: false,
                isDisable: false
            }).sort({ viewCount: 1 });

            if (lowestTrending && thread.viewCount <= lowestTrending.viewCount) {
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error checking thread trending criteria:', error);
        return false;
    }
};

// Manual trending update for all threads
const updateAllThreadTrendingStatus = async () => {
    try {
        // Get all active threads
        const threads = await Thread.find({
            isDeleted: false,
            isDisable: false,
            viewCount: { $gte: THREAD_TRENDING_THRESHOLDS.VIEW_COUNT }
        }).sort({ viewCount: -1 });

        let updatedCount = 0;
        let trendingCount = 0;

        for (const thread of threads) {
            const shouldBeTrending = await checkThreadTrendingCriteria(thread);
            
            if (thread.isTrending !== shouldBeTrending) {
                await Thread.findByIdAndUpdate(thread._id, { 
                    isTrending: shouldBeTrending 
                });
                updatedCount++;
            }
            
            if (shouldBeTrending) {
                trendingCount++;
            }
        }

        return { updatedCount, trendingCount };
    } catch (error) {
        console.error('Error in bulk thread trending update:', error);
        throw error;
    }
};

// Initialize queue processing
processQueue(threadTrendingQueue, processThreadTrendingUpdate);

module.exports = {
    addThreadTrendingUpdateJob,
    updateAllThreadTrendingStatus,
    checkThreadTrendingCriteria,
    THREAD_TRENDING_THRESHOLDS
}; 