const roleId = {
    SUPER_ADMIN: 1,
    USER: 2
}

const conditions = {
    brand_new: 'brand_new',
    like_new: "like_new",
    good: 'good',
    fair: 'fair',
    works: 'works'
}
const SALE_TYPE={
    FIXED: 'fixed',
    AUCTION: 'auction'
}

const DeliveryType={
    FREE_SHIPPING: 'free_shipping',
    CHARGE_SHIPPING: 'charge_shipping'

}



module.exports={
    roleId,
    conditions,
    SALE_TYPE,
    DeliveryType
}