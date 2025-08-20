const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const app = express();
const https = require('https');
const CLIENT_ID = '78lesummvqj4go';
const CLIENT_SECRET = 'WPL_AP1.gsPtp78Zk85Ncnsr.O/WYrg==';
const REDIRECT_URI = 'http://localhost:5000/auth/linkedin/callback';

// Step 1: Redirect user to LinkedIn OAuth
app.get('/auth/linkedin', (req, res) => {
    const params = querystring.stringify({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'openid profile email ',
        state: 'test123'
    });

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params}`;
    res.redirect(authUrl);
});

// Step 2: Handle LinkedIn callback
app.get('/auth/linkedin/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) return res.send(`OAuth Error: ${error}`);
    if (!code) return res.send('No code received');

    try {
        // Exchange code for access token
        const tokenRes = await axios.post(
            'https://www.linkedin.com/oauth/v2/accessToken',
            querystring.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const accessToken = tokenRes.data.access_token;


        const agent = new https.Agent({
            family: 4  // force IPv4
        });


        // Fetch user info
        const userinfoRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
            httpsAgent: agent
        });
        // const meRes = await axios.get('https://api.linkedin.com/v2/me', {
        //     headers: {
        //         Authorization: `Bearer ${accessToken}`,
        //         httpsAgent: agent,
        //     },
        // });
        res.json({
            userinfo: userinfoRes.data
        });

        const linkedinUserId = userinfoRes.data.id;

        const verifyRes = await axios.post(
            'https://api.linkedin.com/rest/detailedUserVerificationReports?action=retrieve',
            {
                userId: `urn:li:member:${linkedinUserId}`,
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'LinkedIn-Version': '202503',
                    'Content-Type': 'application/json',
                },
                httpsAgent: agent,
            }
        );
        if (
            verifyRes.data.verifications &&
            Array.isArray(verifyRes.data.verifications) &&
            verifyRes.data.verifications.length > 0
        ) {
            // User is verified
            res.json({
                userinfo: userinfoRes.data,
                verified: true,
                verifications: verifyRes.data.verifications,
            });
        } else if (verifyRes.data.verificationUrl) {
            
            res.json({
                userinfo: userinfoRes.data,
                verified: false,
                verificationUrl: verifyRes.data.verificationUrl,
                message:
                    'User not verified. Please visit the verification URL to complete verification.',
            });
        } else {

            res.json({
                userinfo: userinfoRes.data,
                verified: false,
                message: 'No verification data found.',
            });
        }

    } catch (err) {
        // Log full error response if available
        console.error('Error response from LinkedIn:', err, err.response?.data || err.message);
        res.status(500).send(`Failed to authenticate with LinkedIn: ${err.response?.data?.message || err.message}`);
    }
});


app.listen(5000, () => console.log('🚀 Server running at http://localhost:5000'));
