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

    REVIEW: 'REVIEW',
    DISPUTE: 'Dispute'
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
    DEAL_CHAT: 'deal_chat',
    SYSTEM: 'system',
    ACTIVITY: 'activity',
    ALERT: 'alert',
    THREAD: 'thread',
    REVIEW: 'review',
    DISPUTE: 'dispute'
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


const createStandardizedChatMeta = (data = {}) => {
    return {
        orderNumber: data.orderNumber || null,
        rating: data.rating || null,
        ratingText: data.ratingText || null,
        reviewText: data.reviewText || null,
        raterRole: data.raterRole || null,
        raterName: data.raterName || null,

        totalAmount: data.totalAmount || null,
        amount: data.amount || null,
        itemCount: data.itemCount || null,
        timestamp: data.timestamp || new Date().toISOString(),
        paymentId: data.paymentId || null,
        paymentMethod: data.paymentMethod || null,
        cardInfo: data.cardInfo || null,
        carrier: data.carrier || null,
        trackingNumber: data.trackingNumber || null,
        previousStatus: data.previousStatus || null,
        newStatus: data.newStatus || null,
        notes: data.notes || null,
        withdrawalFee: data.withdrawalFee || null,
        netAmount: data.netAmount || null,
        withdrawalAmount: data.withdrawalAmount || null,
        transactionId: data.transactionId || null,
        productTitle: data.productTitle || null,
        productId: data.productId || null,
        sellerId: data.sellerId || null,
        buyerId: data.buyerId || null,
        orderStatus: data.orderStatus || null,
        paymentStatus: data.paymentStatus || null,
        shippingStatus: data.shippingStatus || null,
        disputeId: data.disputeId || null,
        disputeStatus: data.disputeStatus || null,
        decision: data.decision || null,
        resolvedBy: data.resolvedBy || null,
        decisionNote: data.decision || null,
        disputeAmountPercent: data.disputeAmountPercent || null,


        refundAmount: data.refundAmount || null,
        processingFee: data.processingFee || null
    };
};

// Helper function to create standardized notification meta
const createStandardizedNotificationMeta = (data = {}) => {
    return {
        orderNumber: data.orderNumber || null,
        orderId: data.orderId || null,
        itemCount: data.itemCount || null,
        totalAmount: data.totalAmount || null,
        amount: data.amount || null,
        trackingNumber: data.trackingNumber || null,
        oldStatus: data.oldStatus || null,
        newStatus: data.newStatus || null,
        paymentMethod: data.paymentMethod || null,
        paymentId: data.paymentId || null,
        cardType: data.cardType || null,
        cardLast4: data.cardLast4 || null,
        withdrawalId: data.withdrawalId || null,
        withdrawalFee: data.withdrawalFee || null,
        withdrawalAmount: data.withdrawalAmount || null,
        netAmount: data.netAmount || null,
        netAmountPaid: data.netAmountPaid || null,
        status: data.status || null,
        processedBy: data.processedBy || null,
        actionBy: data.actionBy || null,
        transactionId: data.transactionId || null,
        productId: data.productId || null,
        productTitle: data.productTitle || null,
        sellerId: data.sellerId || null,
        buyerId: data.buyerId || null,
        timestamp: data.timestamp || new Date().toISOString(),
        disputeId: data.disputeId || null,
        disputeStatus: data.disputeStatus || null,
        refundAmount: data.refundAmount || null,
        processingFee: data.processingFee || null,
        carrier: data.carrier || null,
        shippingFee: data.shippingFee || null,
        taxAmount: data.taxAmount || null,
        serviceCharge: data.serviceCharge || null,
        platformFee: data.platformFee || null,
        roomId: data.roomId || null,
        userName: data.userName || null,
        // Thread-related metadata
        threadId: data.threadId || null,
        threadTitle: data.threadTitle || null,
        threadImage: data.threadImage || null,

        commentId: data.commentId || null,
        parentCommentId: data.parentCommentId || null,
        commentContent: data.commentContent || null,
        commenterName: data.commenterName || null,
        commenterId: data.commenterId || null,
        associatedProductsCount: data.associatedProductsCount || null,
        // Product details for association notifications
        productImage: data.productImage || null,
        productTitle: data.productTitle || null,

        productPrice: data.productPrice || null,
        productFixedPrice: data.productFixedPrice || null,
        productDeliveryType: data.productDeliveryType || null,
        productSaleType: data.productSaleType || null,
        productCondition: data.productCondition || null,
        // User/Commenter image,

        commenterImage: data.commenterImage || null,
        userImage: data.userImage || null,
        // Follow-related metadata
        followerId: data.followerId || null,
        followerName: data.followerName || null,
        followerImage: data.followerImage || null,
        followedUserId: data.followedUserId || null,
        followedUserName: data.followedUserName || null,
        // Like-related metadata
        likerName: data.likerName || null,
        likerId: data.likerId || null
    };
};


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
    createStandardizedChatMeta,
    createStandardizedNotificationMeta,





    DISPUTE_DECISION,
    DISPUTE_RESPONSE_TYPE
}