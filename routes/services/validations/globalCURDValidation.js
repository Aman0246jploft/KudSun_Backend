const Joi = require('joi');

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const moduleSchemaForId = Joi.object({
  id: Joi.string().pattern(objectIdRegex).required().messages({
    'string.pattern.base': `"id" must be a valid ObjectId.`,
    'any.required': `"id" is required.`,
    'string.empty': `"id" cannot be empty.`,
  }),
});

module.exports = {
  moduleSchemaForId
};
