const mongoose = require('mongoose');

const { DB_STRING } = process.env;

const startTime = Date.now();

mongoose.connect(DB_STRING)
    .then(() => {
        const endTime = Date.now();
        console.log(`✅ DB Connected successfully in ${endTime - startTime}ms`);
    })
    .catch((err) => {
        console.error('❌ DB Connection Error:', err.message);
    });

module.exports = {
    User: require("./models/User"),
    Follow: require("./models/Follow"),
    Category: require('./models/Category'),
    SellProduct: require('./models/SellProducts'),
    Thread: require("./models/thread/PostThread"),
    ThreadLike: require("./models/thread/ThreadLike"),
    ThreadComment: require("./models/thread/ThreadComment"),
    //rbac---->
    AppSetting: require('./models/AppSetting'),
    Module: require("./models/Rbac/Module"),
    Role: require("./models/Rbac/Role"),
    ModulePermission: require("./models/Rbac/ModulePermission"),
    //rbac---->
};
