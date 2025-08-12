const Joi = require('joi');

const createReviewValidation = Joi.object({
  productId: Joi.string().required(),
  rating: Joi.number().min(1).max(5).required(),
  ratingText: Joi.string().optional(),
  reviewText: Joi.string().required()
});

const updateReviewValidation = Joi.object({
  rating: Joi.number().min(1).max(5).optional(),
  ratingText: Joi.string().optional(),
  reviewText: Joi.string().optional()
});

module.exports = {
  createReviewValidation,
  updateReviewValidation
};