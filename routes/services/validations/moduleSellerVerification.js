const Joi = require('joi');
const { SELLER_PAYOUT_METHOD } = require('../../../utils/Role');

const sellerVerificationSchema = Joi.object({
    legalFullName: Joi.string().required(),
    idNumber: Joi.string().required(),
    paymentPayoutMethod: Joi.string().valid(...Object.values(SELLER_PAYOUT_METHOD)).required(),
    bankName: Joi.string().optional().allow(null,""),
    accountNumber: Joi.string().optional().allow(null,""),
    accountHolderName: Joi.string().optional().allow(null,""),
    promptPayId: Joi.string().optional().allow(null,""),
    isAuthorized: Joi.boolean().required()
});




module.exports = {
sellerVerificationSchema
};