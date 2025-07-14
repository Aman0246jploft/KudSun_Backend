// require('dotenv').config();  // Load .env variables

// const nodemailer = require('nodemailer');

// async function sendTestEmail() {
//   try {
//     const transporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST,   // smtp.sendgrid.net
//       port: 587,   // 587
//       secure: false,                 // true for 465, false for other ports
//     //   auth: {
//     //     user: 'testing', // 'apikey'
//     //     pass: '
//     //   }
//     });

//     const info = await transporter.sendMail({
//       from: 'smtp.sendgrid.net', // sender address
//       to: 'amankashyap0246jploft@gmail.com',         // your email to receive the test
//       subject: 'Test Email from SendGrid SMTP',
//       text: 'Hello! This is a test email sent using SendGrid SMTP.',
//       html: '<b>Hello! This is a test email sent using SendGrid SMTP.</b>',
//     });

//     console.log('Message sent:', info.messageId);
//   } catch (error) {
//     console.error('Error sending email:', error);
//   }
// }

// sendTestEmail();
const nodemailer = require("nodemailer");

// Create a test account or replace with real credentials.
const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: "maddison53@ethereal.email",
    pass: "jn7jnAPss4f63QBp6D",
  },
});

// Wrap in an async IIFE so we can use await.
(async () => {
  const info = await transporter.sendMail({
    from: 'maddison53@ethereal.email',
    to: "amankashyap0246jploft@gmail.com",
    subject: "Hello ✔",
    text: "Hello world?", // plain‑text body
    html: "<b>Hello world?</b>", // HTML body
  });

  console.log("Message sent:", info.messageId);
})();