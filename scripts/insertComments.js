require('dotenv').config();
// insertComments.js
const mongoose = require('mongoose');
const { faker } = require('@faker-js/faker'); // For generating fake data
const { ThreadComment } = require('../db');
const { DB_STRING } = process.env;


mongoose.connect(DB_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});



// Dummy values for fixed references (update these accordingly)
const authorId = new mongoose.Types.ObjectId('685d18231a55f0ebf24859db');
const threadId = new mongoose.Types.ObjectId('68871426ffafffd7ae062b9a');

const insertComments = async () => {
    const bulkComments = [];

    for (let i = 0; i < 1000; i++) {
        const now = new Date();

        bulkComments.push({
            content: faker.lorem.words({ min: 1, max: 5 }),
            photos: [],
            associatedProducts: [],
            author: authorId,
            thread: threadId,
            parent: null,
            isDisable: false,
            isDeleted: false,
            createdAt: now,
            updatedAt: now,
        });
    }

    try {
        await ThreadComment.insertMany(bulkComments);
        console.log('✅ Inserted 1000 comments successfully.');
    } catch (error) {
        console.error('❌ Error inserting comments:', error);
    } finally {
        mongoose.connection.close();
    }
};

insertComments();
