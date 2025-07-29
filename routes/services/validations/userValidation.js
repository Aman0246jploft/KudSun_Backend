const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required().messages({
    'string.base': `"password" should be a type of 'text'`,
    'string.min': `"password" should have a minimum length of 6`,
    'any.required': `"password" is a required field`
  }),
  fcmToken: Joi.string().optional()
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
const resendOtpSchema = Joi.object({
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


const followSchema = Joi.object({
  userId: Joi.string().required(),
});



const threadLikeSchema = Joi.object({
  threadId: Joi.string().required(),
});


const productLikeSchema = Joi.object({
  productId: Joi.string().required(),
});





const requestResetOtpSchema = Joi.object({
  phoneNumber: Joi.string().required(),
});




const verifyResetOtpSchema = Joi.object({
  otp: Joi.string().required(),
  resetToken: Joi.string().required(),

});

const resetPasswordSchema = Joi.object({
  phoneNumber: Joi.string().required(),
  newPassword: Joi.string().required(),
  confirmPassword: Joi.string().required()

});


const resendResetOtpSchema = Joi.object({
  resetToken: Joi.string().required()
});

const loginStepOneSchema = Joi.object({
  identifier: Joi.string().required()
})
const loginStepTwoSchema = Joi.object({
  loginToken: Joi.string().required(),
  password: Joi.string().optional().allow(null, ""),
  loginWithCode: Joi.string().required(),
  fcmToken: Joi.string().optional(),
})

const loginStepThreeSchema = Joi.object({
  otpToken: Joi.string().required(),
  otp: Joi.string().required(),
  fcmToken: Joi.string().optional(),
})



const otpTokenSchema = Joi.object({
  otpToken: Joi.string().required(),
})

const googleSignInSchema = Joi.object({
  idToken: Joi.string().required().messages({
    'string.base': `"idToken" should be a type of 'string'`,
    'any.required': `"idToken" is a required field`
  }),
  fcmToken: Joi.string().optional()
});

module.exports = {
  loginSchema,
  mobileLoginSchema,
  otpVerification,
  categorySchema,
  completeRegistrationSchema,
  saveEmailPasswords,
  followSchema,
  threadLikeSchema,
  productLikeSchema,
  requestResetOtpSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  loginStepOneSchema,
  loginStepTwoSchema,
  loginStepThreeSchema,
  otpTokenSchema,
  resendOtpSchema,
  resendResetOtpSchema,
  googleSignInSchema
};