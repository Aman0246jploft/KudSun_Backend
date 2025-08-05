const twilio = require('twilio');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER; // or use TWILIO_MESSAGING_SERVICE_SID

const client = twilio(accountSid, authToken);


const sendOtpSMS = async (phoneNumber='+919005267072', otp="123456") => {
    try {
        const message = await client.messages.create({
            body: `Your OTP code is: ${otp}`,
            to: phoneNumber,
            from: fromNumber, // Or messagingServiceSid: 'MGxxxx'
        });

        return { success: true, sid: message.sid };
    } catch (error) {
        console.error('Twilio SMS error:', error.message);
        return { success: false, error: error.message };
    }
};


module.exports = {
    sendOtpSMS,
};
