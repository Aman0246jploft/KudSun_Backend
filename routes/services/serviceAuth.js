const { OAuth2Client } = require('google-auth-library');
const { generateJWT } = require('../utils/jwt');
const appleSigninAuth = require('apple-signin-auth');
const axios = require('axios');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function handleGoogleLogin(req, res) {
    try {
        const { idToken } = req.body;
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        const token = generateJWT(payload.sub); // sub is Google user ID
        res.json({ token, email: payload.email });
    } catch (err) {
        res.status(401).json({ error: 'Invalid Google token' });
    }
}





async function handleFacebookLogin(req, res) {
    try {
        const { accessToken } = req.body;
        const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;

        const debugRes = await axios.get(`https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appToken}`);
        const data = debugRes.data.data;

        if (!data.is_valid) throw new Error('Invalid token');

        const userInfoRes = await axios.get(`https://graph.facebook.com/me?fields=id,email&access_token=${accessToken}`);
        const user = userInfoRes.data;

        const token = generateJWT(user.id);
        res.json({ token, email: user.email });
    } catch (err) {
        res.status(401).json({ error: 'Invalid Facebook token' });
    }
}






async function handleAppleLogin(req, res) {
    try {
        const { idToken } = req.body;

        const payload = await appleSigninAuth.verifyIdToken(idToken, {
            audience: process.env.APPLE_CLIENT_ID,
            ignoreExpiration: false,
        });

        const token = generateJWT(payload.sub); // Apple user ID
        res.json({ token, email: payload.email });
    } catch (err) {
        res.status(401).json({ error: 'Invalid Apple token' });
    }
}

module.exports = {
    handleGoogleLogin,
    handleFacebookLogin,
    handleAppleLogin
};
