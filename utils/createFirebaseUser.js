const admin = require("firebase-admin");
const serviceAccount = require('./firebase_cred.json')

let createFirebaseUser = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

module.exports = createFirebaseUser;