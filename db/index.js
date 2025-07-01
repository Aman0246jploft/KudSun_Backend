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
    AppSetting: require('./models/AppSetting'),
    User: require("./models/User"),
    Follow: require("./models/Follow"),
    Category: require('./models/Category'),
    SellProduct: require('./models/SellProducts'),
    Thread: require("./models/thread/PostThread"),
    ThreadLike: require("./models/thread/ThreadLike"),
    ProductLike: require("./models/ProductLike"),
    ThreadComment: require("./models/thread/ThreadComment"),
    UserAddress: require("./models/UserAddress"),
    Carrier: require("./models/Carrier"),
    Order: require("./models/Payment/Order"),
    Shipping: require('./models/Payment/Shipping'),
    Bid: require("./models/Bid"),
    Dispute: require("./models/Dispute"),
    Bank: require("./models/Bank"),
    SellerVerification: require("./models/SellerVerification"),
    ProductReview: require("./models/ProductReview"),
    ContactUs: require("./models/ContactUs"),
    AccountVerification: require("./models/AccountVerification"),
    ChatRoom: require("./models/Chat/ChatRoom"),
    ChatMessage: require("./models/Chat/ChatMessage"),
    Notification: require("./models/Notification"),
    SearchHistory: require("./models/SearchHistory"),
    ThreadDraft: require("./models/thread/ThreadDraft"),
    ProductComment: require("./models/ProductComment"),
    SellProductDraft: require('./models/SellProductDraft'),
    FeeSetting: require("./models/FeeSetting"),
    TempUser: require("./models/TempUser"),
    UserLocation: require("./models/UserLocation"),
    ReportUser: require('./models/ReportUser'),
    Location:require('./models/Location'),
    //rbac---->
    Module: require("./models/Rbac/Module"),
    Role: require("./models/Rbac/Role"),
    ModulePermission: require("./models/Rbac/ModulePermission"),
    //rbac---->
};
