const Joi = require('joi');

const addCommentSchema = Joi.object({
  content: Joi.string().allow('', null),
  thread: Joi.string().required(),
  parent: Joi.string().allow(null, ''),
  associatedProducts: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  )
});

module.exports = {
  addCommentSchema,
};