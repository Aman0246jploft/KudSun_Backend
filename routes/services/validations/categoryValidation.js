const Joi = require('joi');

const parameterValueSchema = Joi.object({
  value: Joi.string().required(),
  isAddedByAdmin: Joi.boolean().optional(),
  addedByUserId: Joi.string().allow(null).optional()
});

const parameterSchema = Joi.object({
  key: Joi.string().required(),
  values: Joi.array().items(parameterValueSchema)
});

const subCategorySchema = Joi.object({
  name: Joi.string().required(),
  slug: Joi.number().optional(),
  image: Joi.string().allow(null).optional(),
  parameters: Joi.array().items(parameterSchema).optional()
});

const createCategorySchema = Joi.object({
  name: Joi.string().required(),
  slug: Joi.number().optional(),
  image: Joi.string().allow(null).optional(),
  subCategories: Joi.array().items(subCategorySchema).optional()
});


module.exports = {
  createCategorySchema,

};