const Joi = require('joi');

const carrierValidationSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    'string.base': 'Carrier name must be a string',
    'any.required': 'Carrier name is required',
    'string.empty': 'Carrier name cannot be empty'
  }),

  contact: Joi.string().trim().optional().allow('').messages({
    'string.base': 'Contact must be a string'
  }),

  website: Joi.string().trim().uri().optional().allow('').messages({
    'string.uri': 'Website must be a valid URL'
  }),

  estimatedDays: Joi.number().integer().min(1).optional().messages({
    'number.base': 'Estimated days must be a number',
    'number.integer': 'Estimated days must be an integer',
    'number.min': 'Estimated days must be at least 1'
  }),
  id: Joi.string().trim().optional().allow(''),

  isDisable: Joi.boolean().optional()
});




module.exports = {
  carrierValidationSchema
};