const roleId = {
    SUPER_ADMIN: 1,
    USER: 2,
    GUEST: 3
}

const conditions = {
    brand_new: 'brand new',
    like_new: "like new",
    good: 'good',
    fair: 'fair',
    works: 'works'
}
const SALE_TYPE = {
    FIXED: 'fixed',
    AUCTION: 'auction'
}

const DeliveryType = {
    FREE_SHIPPING: 'free shipping',
    CHARGE_SHIPPING: 'charge shipping',
    LOCAL_PICKUP: 'local pickup'

}

const ORDER_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RETURNED: 'returned',
    FAILED: 'failed',
    COMPLETED: 'completed',
    CONFIRM_RECEIPT: 'confirm_receipt',
    
    DISPUTE:'Dispute'
};

const PAYMENT_STATUS = {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded'
};

const PAYMENT_METHOD = {
    COD: 'cash_on_delivery',
    ONLINE: 'online_payment',
};

const TNX_TYPE = {
    CREDIT: 'credit',
    WITHDRAWL: "withdrawl"
}


const SHIPPING_STATUS = {
    NOT_DISPATCHED: 'not_dispatched',
    IN_TRANSIT: 'in_transit',
    DELIVERED: 'delivered',
    RETURNED: 'returned'
};



const DEFAULT_AMOUNT = {
    PLATFORM_FEE: 5,
    SHIPPING_CHARGE: 5
};

const DISPUTE_STATUS = {
    PENDING: 'PENDING',
    UNDER_REVIEW: 'UNDER_REVIEW',
    RESOLVED: 'RESOLVED',
    CANCELLED: 'CANCELLED'
};
const DISPUTE_DECISION = {
    BUYER: 'BUYER',
    SELLER: 'SELLER'
};

const DISPUTE_RESPONSE_TYPE = {
    REFUND: 'REFUND',
    DENY: 'DENY'
};


const SELLER_PAYOUT_METHOD = {
    PROMPT_PAY: "PromptPay",
    BANK_TRANSFER: "BankTransfer"
}



const NOTIFICATION_TYPES = {
    USER: 'user',
    CHAT: 'chat',
    ORDER: 'order',
    SYSTEM: 'system',
    DEAL_CHAT: 'deal_chat',
    ACTIVITY: 'activity',
    ALERT: 'alert'
};

const PRICING_TYPE = {
    PERCENTAGE: "PERCENTAGE",
    FIXED: "FIXED"
}


const CHARGE_TYPE = {
    SERVICE_CHARGE: "SERVICE_CHARGE",
    TAX: "TAX",
    BUYER_PROTECTION_FEE: "BUYER_PROTECTION_FEE"
}

module.exports = {
    roleId,
    conditions,
    SALE_TYPE,
    DeliveryType,
    ORDER_STATUS,
    PAYMENT_STATUS,
    PAYMENT_METHOD,
    SHIPPING_STATUS,
    DEFAULT_AMOUNT,
    DISPUTE_STATUS,
    NOTIFICATION_TYPES,
    SELLER_PAYOUT_METHOD,
    PRICING_TYPE,
    CHARGE_TYPE,
    TNX_TYPE,






    DISPUTE_DECISION,
    DISPUTE_RESPONSE_TYPE
}