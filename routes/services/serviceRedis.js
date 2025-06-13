const { createClient } = require('redis');

const CONSTANTS = require('../../utils/constants');
const { resultDb } = require('../../utils/globalFunction');
// Redis connection options



// Main client for general Redis operations
const client = createClient({});

// Dedicated clients for pub/sub
const publisher = createClient({});



const subscriber = createClient({});



// const subscriber = createClient({ socket: {
//     host: '127.0.0.1',
//     port: 6379
// }});

// Error handling for all clients
client.on('error', (err) => console.error('Redis Client Error:', err));
publisher.on('error', (err) => console.error('Redis Publisher Error:', err));
subscriber.on('error', (err) => console.error('Redis Subscriber Error:', err));


// Connect all clients
(async () => {
    try {
        await client.connect();
        console.log("Redis client connected");

        await publisher.connect();
        console.log("Redis publisher connected");

        await subscriber.connect();
        console.log("Redis subscriber connected");
    } catch (err) {
        console.error("Redis connection error:", err);
    }
})();

// Pub/Sub Functions
const publishMessage = async (channel, message) => {
    try {
        await publisher.publish(channel, message);
    } catch (error) {
        console.error('Unable to publish message:', error);
    }
};

const subscribeToChannel = async (channel, listener) => {
    try {
        await subscriber.subscribe(channel, (message) => {
            listener(channel, message);
        });
        console.log(`Subscribed to channel ${channel}`);
    } catch (error) {
        console.error('Unable to subscribe to channel:', error);
    }
};


// Key-Value Operations
const getKey = async (key) => {
    try {
        const value = await client.get(key.toString());
        if (value === null) {
            return resultDb(CONSTANTS.NOT_FOUND)
        } else {
            return resultDb(CONSTANTS.SUCCESS, value)
        }

    } catch (error) {
        // console.error("Unable to get key from redis, Query", error);
        return resultDb(CONSTANTS.SERVER_ERROR, CONSTANTS.DATA_NULL)
    }
};

const setKey = async (key, value) => {
    try {
        await client.set(key, value, 'EX', 60 * 10);
        return resultDb(CONSTANTS.SUCCESS)
    } catch (error) {
        // console.error("Unable to set key in redis, Query", error);
        return resultDb(CONSTANTS.SERVER_ERROR, CONSTANTS.DATA_NULL)
    }
};

const setKeyNoTime = async (key, value) => {
    try {
        await client.set(key, value);
        return resultDb(CONSTANTS.SUCCESS)
    } catch (error) {
        // console.error("Unable to set key no time in redis, Query", error);
        return resultDb(CONSTANTS.SERVER_ERROR, CONSTANTS.DATA_NULL)
    }
};

const setKeyWithTime = async (key, value, time = 5) => {
    try {
        await client.set(key, value, 'EX', 60 * time);
        return resultDb(CONSTANTS.SUCCESS)
    } catch (error) {
        // console.log(error);
        return resultDb(CONSTANTS.SERVER_ERROR, CONSTANTS.DATA_NULL)
    }
};

const removeKey = async (key) => {
    try {
        const value = await client.del(key.toString());
        if (value === null) {
            return resultDb(CONSTANTS.NOT_FOUND)
        } else {
            return resultDb(CONSTANTS.SUCCESS, value)
        }
    } catch (error) {
        // console.error("Unable to remove key in redis, Query", error);
        return resultDb(CONSTANTS.SERVER_ERROR, CONSTANTS.DATA_NULL)
    }
};

// Exporting all methods
module.exports = {
    getKey,
    setKey,
    setKeyNoTime,
    setKeyWithTime,
    removeKey,
    publishMessage,
    subscribeToChannel,
    client,
    publisher,
    subscriber
};