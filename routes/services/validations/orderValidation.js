const Joi = require('joi');



const orderItemSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required()
});

const createOrderSchema = Joi.object({
  addressId: Joi.string().required(),
  items: Joi.array().items(orderItemSchema).min(1).required()
});




module.exports = { createOrderSchema };
