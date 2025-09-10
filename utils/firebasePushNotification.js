const admin = require("./createFirebaseUser");

async function sendFirebaseNotification({ token, title, body, imageUrl, language, ...customData }) {
    try {
        if (!token || !title || !body) {
            console.warn("Missing required fields for notification.");
            return;
        }
        
        console.log("📱 Firebase Message Details:");
        console.log("   Token:", token.substring(0, 20) + "...");
        console.log("   Title:", title);
        console.log("   Body:", body);
        console.log("   Language:", language);
        
        const message = {
            token,
            notification: {
                title,
                body,
                ...(imageUrl && { image: imageUrl }),
            },
            android: {
                priority: "high",
                notification: {
                    sound: "default",
                    ...(imageUrl && { imageUrl })
                }
            },
            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": "alert"
                },
                payload: {
                    aps: {
                        alert: {
                            title,
                            body
                        },
                        sound: "default",
                        "mutable-content": 1
                    }
                }
            },
            data: {
                // Add language information to data payload
                language: language || 'english',
                // Convert everything to strings because FCM `data` must be string values
                ...Object.entries(customData).reduce((acc, [key, val]) => {
                    acc[key] = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                    return acc;
                }, {})
            }
        };

        const response = await admin.messaging().send(message);
        console.log("✅ Firebase notification sent successfully:", response);
        console.log("   Message ID:", response);

    } catch (error) {
        console.error("❌ Error sending Firebase notification:", error.message);
        console.error("   Full error:", error);
    }
}


// async function sendFirebaseNotification({ token, title, body, imageUrl, ...customData }) {
//     try {
//         if (!token || !title || !body) {
//             console.warn("⚠️ Missing required fields: token, title, or body.");
//             return;
//         }

//         const message = {
//             token,
//             notification: {
//                 title,
//                 body,
//                 ...(imageUrl && { image: imageUrl }) // used by Android only
//             },
//             android: {
//                 priority: "high",
//                 notification: {
//                     sound: "default",
//                     ...(imageUrl && { imageUrl })
//                 }
//             },
//             apns: {
//                 headers: {
//                     "apns-priority": "10",             // Must be '10' for alert push
//                     "apns-push-type": "alert"          // Required by iOS 13+
//                 },
//                 payload: {
//                     aps: {
//                         alert: {
//                             title,
//                             body
//                         },
//                         sound: "default",
//                         "mutable-content": 1            // Required for rich notifications with images
//                     }
//                 }
//             },
//             data: {
//                 ...Object.entries(customData).reduce((acc, [key, val]) => {
//                     acc[key] = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
//                     return acc;
//                 }, {})
//             }
//         };

//         const response = await admin.messaging().send(message);
//         console.log("✅ Firebase notification sent:", response);

//     } catch (error) {
//         console.error("❌ Firebase notification error:", error.message, error);
//     }
// }


module.exports = {
    sendFirebaseNotification
};
