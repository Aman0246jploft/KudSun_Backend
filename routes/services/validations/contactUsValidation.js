const Joi = require('joi');

const createContactUs = Joi.object({
    name: Joi.string().required(),
    contact: Joi.string().required(),
    type: Joi.string().required(),
    desc: Joi.string().optional(),
    userId: Joi.string().optional().allow('', null)
});

const sendReplyValidation = Joi.object({
    contactUsId: Joi.string().required().messages({
        'string.base': 'Contact Us ID should be a string',
        'any.required': 'Contact Us ID is required'
    }),
    subject: Joi.string().required().min(1).max(200).messages({
        'string.base': 'Subject should be a string',
        'string.min': 'Subject cannot be empty',
        'string.max': 'Subject cannot exceed 200 characters',
        'any.required': 'Subject is required'
    }),
    body: Joi.string().required().min(1).max(5000).messages({
        'string.base': 'Body should be a string',
        'string.min': 'Body cannot be empty',
        'string.max': 'Body cannot exceed 5000 characters',
        'any.required': 'Body is required'
    })
});

module.exports = {
    createContactUs,
    sendReplyValidation
};