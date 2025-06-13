// middlewares/jwtVerification.js
const jwt = require('jsonwebtoken');
const { apiErrorRes } = require('../utils/globalFunction');
const HTTP_STATUS = require('../utils/statusCode');
const CONSTANTS = require('../utils/constants');



const publicRoutes = [
    '/api/v1/auth/register',
    '/api/v1/user/login',
    '/api/v1/user/requestOtp',
    '/api/v1/user/verifyOtp',
    '/api/v1/user/saveEmailPassword',
    '/api/v1/user/saveCategories',
    '/api/v1/user/completeRegistration',


];

function jwtVerification() {
    return (req, res, next) => {
        const isPublic = publicRoutes.some(route => req.path.startsWith(route));
        if (isPublic) {
            return next(); // Allow public routes without JWT check
        }

        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
                if (err) {
                    return apiErrorRes(
                        HTTP_STATUS.FORBIDDEN,
                        res,
                        'Invalid or expired token',
                        null,
                        CONSTANTS.ERROR_CODE_ONE,
                        CONSTANTS.ERROR_TRUE
                    );
                }
                req.user = decoded;
                next();
            });
        } else {
            return apiErrorRes(
                HTTP_STATUS.UNAUTHORIZED,
                res,
                'Authorization token missing',
                null,
                CONSTANTS.ERROR_CODE_ONE,
                CONSTANTS.ERROR_TRUE
            );
        }
    };
}

module.exports = jwtVerification;
