const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // ❌ You wrote "smtp.gmail.email" — which is invalid
  port: 465,
  secure: true, // ✅ true for port 465
  auth: {
    user: "kadsun4@gmail.com",
    pass: "scsv cwyt uvsb aawx", // ✅ This y looks like a valid App Password (16-char)
  },
});

(async () => {
  try {
    const info = await transporter.sendMail({
      from: 'Kadsun Team', // Optional name
      to: "amankashyap0246jploft@gmail.com",
      subject: "Hello ✔",
      text: "Hello world?",
      html: "<b>Hello world?</b>",
    });

    console.log("Message sent:", info.messageId);
  } catch (err) {
    console.error("Error sending email:", err);
  }
})();
