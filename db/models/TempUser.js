// tempUser.model.js
const mongoose = require('mongoose');

const tempUserSchema = new mongoose.Schema({
    phoneNumber: { type: String, unique: true, required: true },
    language: String,
    tempOtp: String,
    tempOtpExpiresAt: Date,
    step: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now, expires: 600 } // auto-delete after 10 min
});

module.exports = mongoose.model("TempUser", tempUserSchema, "TempUser");

