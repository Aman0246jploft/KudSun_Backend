const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// Multer setup for storing files temporarily
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const path = require('path');
const stream = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImageCloudinary(file, userId) {
  return new Promise((resolve, reject) => {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = path.parse(file.originalname).name;
      const publicId = `${fileName}`;
      const resourceType = ['.pdf', '.doc', '.docx', '.txt'].includes(ext) ? 'raw' : 'image';

      const readableStream = new stream.PassThrough();
      readableStream.end(file.buffer);

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          folder: userId,
          resource_type: resourceType,
          overwrite: true,
        },
        (error, result) => {
          if (error) {
            console.log("Upload Error:", error);
            return reject(null);
          }
          resolve(result.secure_url);
        }
      );

      readableStream.pipe(uploadStream); // Properly pipe stream

    } catch (error) {
      console.log("Error in uploadImageCloudinary:", error);
      reject(null);
    }
  });
}


async function deleteImageCloudinary(url) {
  try {
    console.log("🔍 Starting Cloudinary image deletion process...");
    console.log("📸 Input URL:", url);

    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/');
    console.log("🧩 URL path segments:", parts);

    if (parts.length < 5) {
      throw new Error("Invalid Cloudinary URL format.");
    }

    const fileWithExt = decodeURIComponent(parts[parts.length - 1]);
    const dotIndex = fileWithExt.lastIndexOf('.');
    const publicId = dotIndex !== -1 ? fileWithExt.substring(0, dotIndex) : fileWithExt;
    const folder = parts[parts.length - 2];
    const fullPublicId = `${folder}/${publicId}`;


    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(fullPublicId, { resource_type: 'image' }, (error, result) => {
        if (error) {
          console.error("❌ Cloudinary delete error:", error);
          return reject(error);
        }
        console.log("✅ Cloudinary delete result:", result);
        resolve(result);
      });
    });

  } catch (err) {
    console.error("🚨 Error during Cloudinary deletion process:", err);
    throw err;
  }
}


module.exports = {
  uploadImageCloudinary,
  deleteImageCloudinary
}
