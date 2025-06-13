const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required().messages({
    'string.base': `"password" should be a type of 'text'`,
    'string.min': `"password" should have a minimum length of 6`,
    'any.required': `"password" is a required field`
  }),
  fmcToken: Joi.string().optional()
});

const mobileLoginSchema = Joi.object({
  phoneNumber: Joi.string().required(),
  language: Joi.string().valid('english', 'thi').required(),
  fcmToken: Joi.string().optional()
});

const otpVerification = Joi.object({
  otp: Joi.string().required(),
  verifyToken: Joi.string().required()
});


const categorySchema = Joi.object({
  phoneNumber: Joi.string().required(),
  categories: Joi.string().required()
});


const completeRegistrationSchema = Joi.object({
  phoneNumber: Joi.string().required(),
  userName: Joi.string().min(2).required(),
  gender: Joi.string().valid('male', 'female', 'other').required(),
  dob: Joi.date().required(),
  fcmToken: Joi.string().optional()
});



const saveEmailPasswords = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required().messages({
    'string.base': `"password" should be a type of 'text'`,
    'string.min': `"password" should have a minimum length of 6`,
    'any.required': `"password" is a required field`
  }),
  phoneNumber: Joi.string().required(),
});


module.exports = {
  loginSchema,
  mobileLoginSchema,
  otpVerification,
  categorySchema,
  completeRegistrationSchema,
  saveEmailPasswords
};