const Queue = require('bull');
const { client } = require('./serviceRedis');


const redisConfig = {};

// Function to create a Bull queue
const createQueue = (queueName) => {
    const queue = new Queue(queueName, {
        redis: client,
    });

    queue.on('ready', () => {
        console.log(`Queue ${queueName} connected to Redis successfully.`);
    });

    queue.on('error', (err) => {
        console.error(`Failed to connect queue ${queueName} to Redis:`, err.message);
    });



    if (!(queue instanceof Queue)) {
        throw new Error('Failed to create a valid Bull queue');
    }
    return queue;
};

// Adding a job to the queue
const addJobToQueue = async (queue, jobData, options = {}) => {
    try {
        const job = await queue.add(jobData, options);
        return job;
    } catch (error) {
        console.error(`Error adding job to queue ${queue.name}:`, error.message);
        throw error;
    }
};


// Processing the queue
const processQueue = (queue, processor) => {
    queue.process(async (job) => {
        try {
            await processor(job);
        } catch (error) {
            console.error(`Error processing job ${job.id} in queue ${queue.name}:`, error);
            throw error; // Let Bull retry the job based on configuration
        }
    });

    console.log(`Queue ${queue.name} is now processing jobs.`);
};



// Error handling and logging
const handleQueueEvents = (queue) => {
    queue.on('completed', (job) => {
        console.log(`Job ${job.id} in queue ${queue.name} completed successfully.`);
    });

    queue.on('failed', (job, error) => {
        console.error(`Job ${job.id} in queue ${queue.name} failed:`, error);
    });

    queue.on('stalled', (job) => {
        console.warn(`Job ${job.id} in queue ${queue.name} stalled and will be retried.`);
    });

    console.log(`Event handlers set up for queue ${queue.name}.`);
};



// Exporting the service methods
module.exports = {
    createQueue,
    addJobToQueue,
    processQueue,
    handleQueueEvents,
};