const CONSTANTS = require('./constants');
const moment = require("moment");
const bcrypt = require('bcryptjs');


const resultDb = (statusCode, data = null) => {
    return {
        statusCode: statusCode,
        data: data
    };
}

const apiSuccessRes = (statusCode = 200, res, message = CONSTANTS.DATA_NULL, data = CONSTANTS.DATA_NULL, code = CONSTANTS.ERROR_CODE_ZERO, error = CONSTANTS.ERROR_FALSE, token, currentDate) => {
    return res.status(statusCode).json({
        message: message,
        code: code,
        error: error,
        data: data,
        token: token,
        currentDate
    });
}

const apiErrorRes = (statusCode = 200, res, message = CONSTANTS.DATA_NULL, data = CONSTANTS.DATA_NULL, code = CONSTANTS.ERROR_CODE_ONE, error = CONSTANTS.ERROR_TRUE) => {
    return res.status(statusCode).json({
        message: message,
        code: code,
        error: error,
        data: data
    });
}

function generateKey(length = CONSTANTS.VERIFICATION_TOKEN_LENGTH) {
    var key = "";
    var possible = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (var i = 0; i < length; i++) {
        key += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return key;
}
function generateOTP(length = CONSTANTS.OTP_LENGTH) {
    var key = "";
    var possible = "0123456789";
    for (var i = 0; i < length; i++) {
        key += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return key;
}




async function verifyPassword(hash, password) {
    try {
        const isMatch = await bcrypt.compare(password, hash);
        return isMatch;
    } catch (err) {
        console.error('Error verifying password:', err);
        return false
    }
}

const toObjectId = (id) => {
    try {
        return new mongoose.Types.ObjectId(id);
    } catch (err) {
        return null; // or throw, depending on how you want to handle invalid IDs
    }
};



module.exports = {
    resultDb,
    generateOTP,
    apiSuccessRes,
    apiErrorRes,
    generateKey,
    verifyPassword,
    toObjectId
};