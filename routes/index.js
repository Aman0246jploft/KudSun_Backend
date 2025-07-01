module.exports = {
    user: require('./controller/controllerUser'),
    category: require('./controller/controllerCategory'),
    product: require('./controller/controllerproduct'),
    thread: require('./controller/controllerThread'),
    userAddress: require("./controller/controllerAddress"),
    carrier: require("./controller/controllerCarrier"),
    bid: require("./controller/controllerBids"),
    order: require("./controller/contorllerOrder"),
    dispute: require("./controller/controllerDispute"),
    bank: require("./controller/controllerBank"),
    sellerVerification: require("./controller/controllerSellerVerification"),
    productReview: require("./controller/controllerProductreview"),
    contactUs: require("./controller/controllerContactUs"),
    idVerifiy: require("./controller/controllerAccountVerification"),
    feeSetting: require("./controller/controllerFeeSetting"),
    userLocation: require('./controller/controllerUserAddressLocation'),
    reportUser: require('./controller/controllerReportUser'),
    location: require('./controller/controllerLocation'),

    // chat: require("./controller/controllerChat"),




    appsetting: require('./controller/controllerAppsettings'),
    module: require('./controller/controllerModule'),
}