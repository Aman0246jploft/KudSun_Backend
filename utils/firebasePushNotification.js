const admin = require("./createFirebaseUser");

async function sendFirebaseNotification({ token, title, body, imageUrl, ...customData }) {
    try {
        if (!token || !title || !body) {
            console.warn("Missing required fields for notification.");
            return;
        }
        const message = {
            token,
            notification: {
                title,
                body,
                ...(imageUrl && { image: imageUrl }),
            },
            android: {
                priority: "high"
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                        "mutable-content": 1
                    }
                }
            },
            data: {
                // Convert everything to strings because FCM `data` must be string values
                ...Object.entries(customData).reduce((acc, [key, val]) => {
                    acc[key] = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                    return acc;
                }, {})
            }
        };

        const response = await admin.messaging().send(message);

    } catch (error) {
        console.error("Error sending Firebase notification:", error.message);
    }
}

module.exports = {
    sendFirebaseNotification
};
