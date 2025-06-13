const logger = require("../config/logger");


const requestLogger = (req, res, next) => {
    const start = Date.now();

    // Capture original res.send
    const originalSend = res.send;

    res.send = function (body) {
        res.responseBody = body; // Store body in response
        return originalSend.call(this, body);
    };

    res.on('finish', () => {
        const duration = Date.now() - start;

        // Parse body if it's JSON
        let responseBody;
        try {
            responseBody = typeof res.responseBody === 'string'
                ? JSON.parse(res.responseBody)
                : res.responseBody;
        } catch (e) {
            responseBody = res.responseBody;
        }
        const userId = req.user?.userId || null;
        logger.info({
            userId: userId,
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            responseTime: `${duration}ms`,
            timestamp: new Date().toISOString(),
            response: responseBody,
        });
    });

    next();
};

module.exports = requestLogger;
