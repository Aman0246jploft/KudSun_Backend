const nodemailer = require("nodemailer");

// Create transporter using the same configuration as mailtest.js
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // ❌ You wrote "smtp.gmail.email" — which is invalid
  port: 465,
  secure: true, // ✅ true for port 465
  auth: {
    user: "kadsun4@gmail.com",
    pass: "scsv cwyt uvsb aawy", // ✅ This looks like a valid App Password (16-char)
  },
});

/**
 * Send email using nodemailer
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text content
 * @param {string} options.html - HTML content
 * @param {string} options.from - Sender name (optional)
 * @returns {Promise<Object>} - Email result
 */
const sendEmail = async ({ to, subject, text, html, from = 'Kadsun Team' }) => {
  try {
    if (!to || !subject || (!text && !html)) {
      throw new Error('Missing required email parameters: to, subject, and content (text or html)');
    }

    const mailOptions = {
      from: from,
      to: to,
      subject: subject,
    };

    // Add text content if provided
    if (text) {
      mailOptions.text = text;
    }

    // Add HTML content if provided
    if (html) {
      mailOptions.html = html;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
      message: "Email sent successfully"
    };
  } catch (error) {
    console.error("Error sending email:", error.message);
    return {
      success: false,
      error: error.message,
      message: "Failed to send email"
    };
  }
};

/**
 * Send reply email for contact us submissions
 * @param {Object} options - Reply options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body content
 * @param {Object} options.originalSubmission - Original contact submission data
 * @returns {Promise<Object>} - Email result
 */
const sendContactUsReply = async ({ to, subject, body, originalSubmission }) => {
  try {
    // Create HTML template for contact us reply
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
          <h2 style="color: #333; margin-bottom: 20px;">Reply from Kadsun Team</h2>
          
          <div style="background-color: white; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
            ${body}
          </div>
          
          <div style="background-color: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px;">
            <h4 style="color: #495057; margin-bottom: 10px;">Your Original Message:</h4>
            <p><strong>Name:</strong> ${originalSubmission?.name || 'N/A'}</p>
            <p><strong>Type:</strong> ${originalSubmission?.type || 'N/A'}</p>
            <p><strong>Description:</strong> ${originalSubmission?.desc || 'N/A'}</p>
            <p><strong>Date:</strong> ${originalSubmission?.createdAt ? new Date(originalSubmission.createdAt).toLocaleString() : 'N/A'}</p>
          </div>
          
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #dee2e6;">
            <p style="color: #6c757d; font-size: 14px;">
              Thank you for contacting Kadsun. If you have any further questions, please don't hesitate to reach out to us.
            </p>
            <p style="color: #6c757d; font-size: 14px;">
              Best regards,<br>
              The Kadsun Team
            </p>
          </div>
        </div>
      </div>
    `;

    return await sendEmail({
      to: to,
      subject: subject,
      html: htmlContent,
      text: body, // Plain text fallback
    });
  } catch (error) {
    console.error("Error sending contact us reply:", error.message);
    return {
      success: false,
      error: error.message,
      message: "Failed to send contact us reply"
    };
  }
};

/**
 * Test email connection
 * @returns {Promise<Object>} - Connection test result
 */
const testEmailConnection = async () => {
  try {
    await transporter.verify();
    return {
      success: true,
      message: "Email service is ready"
    };
  } catch (error) {
    console.error("Email connection test failed:", error.message);
    return {
      success: false,
      error: error.message,
      message: "Email service connection failed"
    };
  }
};

module.exports = {
  sendEmail,
  sendContactUsReply,
  testEmailConnection
}; 