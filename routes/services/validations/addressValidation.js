const Joi = require('joi');

const addressSchema = Joi.object({
  label: Joi.string().valid('home', 'work', 'other').default('home'),
  fullName: Joi.string().required(),
  phone: Joi.string().required(),
  line1: Joi.string().required(),
  line2: Joi.string().allow(''),
  city: Joi.string().required(),
  state: Joi.string().allow(''),
  country: Joi.string().required(),
  postalCode: Joi.string().required(),
  isActive: Joi.boolean()
});





module.exports = {
  addressSchema
};