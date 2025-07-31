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
                priority: "high",
            },
            apns: {
                headers: {
                    "apns-priority": "10",
                },
                payload: {
                    aps: {
                        sound: "default",
                        alert: {
                            title,
                            body
                        },
                        "content-available": 1
                    }
                }
            },
            data: {
                ...Object.entries(customData).reduce((acc, [key, val]) => {
                    acc[key] = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                    return acc;
                }, {})
            }
        };


        const response = await admin.messaging().send(message);
        console.log("Notification sent:", response);
    } catch (error) {
        console.error("Error sending Firebase notification:", error.message);
    }
}

module.exports = {
    sendFirebaseNotification
};
