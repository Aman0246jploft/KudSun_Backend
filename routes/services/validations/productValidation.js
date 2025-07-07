const Joi = require('joi');

const addProductSchema = Joi.object({
  categoryId: Joi.string().required(),
  subCategoryId: Joi.string().required(),
  title: Joi.string().required(),
  description: Joi.string().allow('', null),
  productImages: Joi.array().items(Joi.string()).default([]),
  specifics: Joi.array().items(
    Joi.object({
      parameterId: Joi.string().required(),
      parameterName: Joi.string().required(),
      valueId: Joi.string().required(),
      valueName: Joi.string().required()
    })
  ).required(),
  condition: Joi.string().valid('brand_new', 'like_new', 'good', 'fair', 'works').required(),
  saleType: Joi.string().valid('fixed', 'auction').required(),
  fixedPrice: Joi.number().when('saleType', { is: 'fixed', then: Joi.required() }),
  originPriceView: Joi.boolean().default(false),
  originPrice: Joi.number().optional(),
  auctionSettings: Joi.object({
    startingPrice: Joi.number().required(),
    reservePrice: Joi.number().required(),
    biddingIncrementPrice: Joi.number().optional(),
    duration: Joi.number().required(),
    endDate: Joi.date().optional(),
    endTime: Joi.string().optional()
  }).when('saleType', { is: 'auction', then: Joi.required() }),
  deliveryType: Joi.string().valid('free shipping', 'charge shipping').required(),
  shippingCharge: Joi.number().when('deliveryType', { is: 'charge shipping', then: Joi.required() })
});

module.exports = {
  addProductSchema,
};