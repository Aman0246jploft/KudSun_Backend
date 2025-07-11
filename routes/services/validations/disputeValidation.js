const Joi = require('joi');
const { DISPUTE_RESPONSE_TYPE, DISPUTE_DECISION, DISPUTE_STATUS } = require('../../../utils/Role');

exports.createDisputeSchema = Joi.object({
  orderId     : Joi.string().hex().length(24).required(),
  disputeType : Joi.string().valid(
      'ITEM_NOT_RECEIVED',
      'ITEM_NOT_AS_DESCRIBED',
      'FAKE_ITEM',
      'SIGNIFICANT_DAMAGE'
  ).required(),
  description : Joi.string().max(1200).required()
});

exports.sellerRespondSchema = Joi.object({
  disputeId   : Joi.string().hex().length(24).required(),
  responseType: Joi.string().valid(...Object.values(DISPUTE_RESPONSE_TYPE)).required(),
  description : Joi.string().max(1200).required()
});

exports.adminDecisionSchema = Joi.object({
  disputeId   : Joi.string().hex().length(24).required(),
  decision    : Joi.string().valid(...Object.values(DISPUTE_DECISION)).required(),
  decisionNote: Joi.string().max(1200).optional()
});

exports.updateStatusSchema = Joi.object({
  disputeId : Joi.string().hex().length(24).required(),
  status    : Joi.string().valid(...Object.values(DISPUTE_STATUS)).required()
});
