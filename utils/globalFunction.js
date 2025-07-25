const CONSTANTS = require('./constants');
const bcrypt = require('bcryptjs');
const { default: mongoose } = require('mongoose');


const resultDb = (statusCode, data = null) => {
  return {
    statusCode: statusCode,
    data: data
  };
}

const apiSuccessRes = (statusCode = 200, res, message = CONSTANTS.DATA_NULL, data = CONSTANTS.DATA_NULL, code = CONSTANTS.ERROR_CODE_ZERO, error = CONSTANTS.ERROR_FALSE, token, currentDate) => {
  return res.status(200 || statusCode).json({
    message: message,
    responseCode: statusCode,
    // code: code,
    status: !error,
    data: data,
    token: token,
    currentDate
  });
}

const apiErrorRes = (statusCode = 200, res, message = CONSTANTS.DATA_NULL, data = CONSTANTS.DATA_NULL, code = CONSTANTS.ERROR_CODE_ONE, error = CONSTANTS.ERROR_TRUE) => {
  return res.status(200 || statusCode).json({
    message: message,
    responseCode: statusCode,
    // code: code,
    status: !error,
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
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};



// Helper: Fix broken JSON strings (add quotes around keys and values)
function fixInvalidJsonString(str) {
  // Add quotes around keys (e.g. productId:)
  let fixed = str.replace(/(\w+):/g, '"$1":');
  // Add quotes around unquoted hex string values (Mongo ObjectIds)
  fixed = fixed.replace(/:"?([a-f0-9]{24})"?/gi, ':"$1"');
  return fixed;
}

// Main parser function
function parseItems(rawItems) {
  if (!rawItems) return [];

  // If already array of objects, just return
  if (Array.isArray(rawItems)) {
    // Check first item type
    if (rawItems.length === 0) return [];

    if (typeof rawItems[0] === 'object' && rawItems[0] !== null) {
      return rawItems;
    }

    // Else, assume array of strings to parse
    return rawItems.map(itemStr => {
      if (typeof itemStr !== 'string') {
        throw new Error('Invalid item in array; expected string');
      }
      try {
        const fixedStr = fixInvalidJsonString(itemStr);
        return JSON.parse(fixedStr);
      } catch (err) {
        throw new Error(`Failed to parse item: ${itemStr}`);
      }
    });
  }

  // If single string, parse it as one object
  if (typeof rawItems === 'string') {
    try {
      const fixedStr = fixInvalidJsonString(rawItems);
      const obj = JSON.parse(fixedStr);
      return [obj];
    } catch (err) {
      throw new Error('Failed to parse items string');
    }
  }

  // If it's a single object, wrap in array
  if (typeof rawItems === 'object') {
    return [rawItems];
  }

  // Otherwise invalid format
  throw new Error('Unsupported items format');
}


// utils/timeUtils.js (example location)

function formatTimeRemaining(ms) {
  if (ms <= 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);

  const years = Math.floor(totalSeconds / (365 * 24 * 60 * 60));
  const months = Math.floor((totalSeconds % (365 * 24 * 60 * 60)) / (30 * 24 * 60 * 60));
  const days = Math.floor((totalSeconds % (30 * 24 * 60 * 60)) / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let timeStr = "";
  if (years > 0) timeStr += `${years}y `;
  if (months > 0) timeStr += `${months}mo `;
  if (days > 0) timeStr += `${days}d `;
  if (hours > 0) timeStr += `${hours}h `;
  if (minutes > 0) timeStr += `${minutes}m `;
  if (timeStr === "") timeStr += `${seconds}s`; // Only seconds left
  else if (years === 0 && months === 0 && days === 0 && hours === 0 && minutes === 0)
    timeStr += `${seconds}s`; // add seconds only when others are zero

  return timeStr.trim();
}


module.exports = {
  resultDb,
  generateOTP,
  apiSuccessRes,
  apiErrorRes,
  generateKey,
  verifyPassword,
  toObjectId,
  parseItems,
  formatTimeRemaining
};