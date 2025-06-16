const Joi = require('joi');

const bidSchema = Joi.object({
  productId: Joi.string().required(),
  amount: Joi.number().positive().required()
});

const productBidQuerySchema = Joi.object({
  pageNo: Joi.number().integer().min(1).optional().default(1),
  size: Joi.number().integer().min(1).max(100).optional().default(10)
});


module.exports = {
  bidSchema,
  productBidQuerySchema
};