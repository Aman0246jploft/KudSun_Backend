const admin = require("./createFirebaseUser");
async function sendFirebaseNotification(data) {
    let { token, title, body, imageUrl } = data
    try {
        const message = {
            token: token,
            notification: {
                title: title,
                body: body,
                image: imageUrl || undefined,
            }
        };

        await admin.messaging().send(message);
    } catch (error) {
        console.error('Error sending notification:', error.message);
        // Handle the error appropriately, such as logging or retry logic
    }
}

module.exports = {
    sendFirebaseNotification
}