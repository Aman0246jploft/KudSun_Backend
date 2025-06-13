// tokenUtils.js
const jwt = require("jsonwebtoken");
const { JWT_SECRET_KEY, REFRESH_JWT_SECRET_KEY, JWT_EXPIRE, REFRESH_JWT_EXPIRE } = process.env;

const signToken = (payload, expiresIn = JWT_EXPIRE) => {
    return jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: expiresIn });
};

const generateRefreshToken = (payload, expiresIn = REFRESH_JWT_EXPIRE) => {
    return jwt.sign(payload, REFRESH_JWT_SECRET_KEY, { expiresIn: expiresIn });
}

module.exports = { signToken, generateRefreshToken };