const mongoose = require('mongoose');

const { DB_STRING } = process.env;

const startTime = Date.now();

async function connectToDatabase() {
    const startTime = Date.now();
    try {
        await mongoose.connect(DB_STRING, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        const duration = Date.now() - startTime;
        console.log(`✅ MongoDB connected successfully in ${duration}ms`);
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        process.exit(1); // Exit the process if the DB connection fails
    }
}

connectToDatabase();


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
    Location: require('./models/Location'),
    Supportkey: require("./models/SupportKey"),
    //rbac---->
    Module: require("./models/Rbac/Module"),
    Role: require("./models/Rbac/Role"),
    ModulePermission: require("./models/Rbac/ModulePermission"),
    //rbac---->
};
