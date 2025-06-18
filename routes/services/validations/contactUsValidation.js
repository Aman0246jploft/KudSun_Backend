const Joi = require('joi');

const createContactUs = Joi.object({
  userId: Joi.string().optional().allow(null,""),
  name: Joi.string().required(),
  contact: Joi.string().required(),
  type: Joi.string().required(),
  desc: Joi.string().max(1200).optional().allow(null,""),
});



module.exports = {
  createContactUs
};