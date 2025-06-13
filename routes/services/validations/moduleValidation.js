const Joi = require('joi');

const moduleSchema = Joi.object({
  name: Joi.string().required().messages({
    'string.base': `"name" should be a type of 'text'`,
    'string.empty': `"name" cannot be an empty field`,
    'any.required': `"name" is a required field`
  }),
  description: Joi.string().optional().messages({
    'string.base': `"description" should be a type of 'text'`
  })
});







module.exports = {
  moduleSchema
};