// const cloudinary = require('cloudinary').v2;
// const multer = require('multer');

// // Multer setup for storing files temporarily
// const storage = multer.memoryStorage();
// const upload = multer({ storage: storage });
// const path = require('path');
// const stream = require('stream');

// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// async function uploadImageCloudinary(file, userId) {
//   return new Promise((resolve, reject) => {
//     try {
//       const ext = path.extname(file.originalname).toLowerCase();
//       const fileName = path.parse(file.originalname).name;

//       const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
//       const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
//       const audioExts = ['.mp3', '.wav', '.aac', '.ogg', '.m4a'];
//       const rawExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.zip', '.rar', '.7z', '.csv'];


//       let resourceType = 'auto'; // Default fallback

//       if (imageExts.includes(ext)) {
//         resourceType = 'image';
//       } else if (videoExts.includes(ext)) {
//         resourceType = 'video';
//       } else if (audioExts.includes(ext) || rawExts.includes(ext)) {
//         resourceType = 'raw';
//       }

//       const publicId = `${fileName}`;
//       const readableStream = new stream.PassThrough();
//       readableStream.end(file.buffer);

//       const uploadStream = cloudinary.uploader.upload_stream(
//         {
//           public_id: publicId,
//           folder: userId,
//           resource_type: resourceType,
//           overwrite: true,
//         },
//         (error, result) => {
//           if (error) {
//             console.log("Upload Error:", error);
//             return reject(null);
//           }
//           resolve(result.secure_url);
//         }
//       );

//       readableStream.pipe(uploadStream); // Properly pipe stream

//     } catch (error) {
//       console.log("Error in uploadImageCloudinary:", error);
//       reject(null);
//     }
//   });
// }


// async function deleteImageCloudinary(url) {
//   try {

//     const urlObj = new URL(url);
//     const parts = urlObj.pathname.split('/');

//     if (parts.length < 5) {
//       // ("Invalid Cloudinary URL format.");
//     }

//     const fileWithExt = decodeURIComponent(parts[parts.length - 1]);
//     const dotIndex = fileWithExt.lastIndexOf('.');
//     const publicId = dotIndex !== -1 ? fileWithExt.substring(0, dotIndex) : fileWithExt;
//     const folder = parts[parts.length - 2];
//     const fullPublicId = `${folder}/${publicId}`;


//     return new Promise((resolve, reject) => {
//       cloudinary.uploader.destroy(fullPublicId, { resource_type: 'image' }, (error, result) => {
//         if (error) {
//           console.error("❌ Cloudinary delete error:", error);
//           return reject(error);
//         }
//         console.log("✅ Cloudinary delete result:", result);
//         resolve(result);
//       });
//     });

//   } catch (err) {
//     console.error("🚨 Error during Cloudinary deletion process:", err);
//     throw err;
//   }
// }


// module.exports = {
//   uploadImageCloudinary,
//   deleteImageCloudinary
// }


const multer = require('multer');
const path = require('path');
const fs = require('fs');
const stream = require('stream');
const dayjs = require('dayjs');

// Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Base URL from env or fallback
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Base path to store files
const UPLOAD_BASE_PATH = path.join(process.cwd(), 'public/uploads');

// Upload file locally and return full URL
async function uploadImageCloudinary(file, userId) {
  return new Promise((resolve, reject) => {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = path.parse(file.originalname).name;
      const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
      const finalFileName = `${safeFileName}-${Date.now()}${ext}`;

      const userFolder = path.join(UPLOAD_BASE_PATH, userId);
      const filePath = path.join(userFolder, finalFileName);

      const ts = dayjs().format('YYYYMMDD-HHmmss-SSS');
      const finalName = `${safeFileName}-${ts}${ext}`;
      // Create user-specific folder if it doesn't exist
      fs.mkdirSync(userFolder, { recursive: true });

      // Save file to disk
      fs.writeFileSync(filePath, file.buffer);

      // Return accessible public URL
      const fileUrl = `${BASE_URL}/uploads/${userId}/${finalName}`;
      resolve(fileUrl);

    } catch (error) {
      console.error("❌ Error saving file locally:", error);
      reject(null);
    }
  });
}

// Delete local file by its URL
async function deleteImageCloudinary(url) {
  try {
    console.log("🧹 Starting local file deletion...");
    const urlPath = new URL(url).pathname;
    const filePath = path.join(process.cwd(), 'public', urlPath);

    if (!fs.existsSync(filePath)) {
      console.warn("⚠️ File not found:", filePath);
      return { result: 'not found' };
    }

    fs.unlinkSync(filePath);
    console.log("✅ File deleted:", filePath);
    return { result: 'ok' };

  } catch (error) {
    console.error("❌ Error deleting local file:", error);
    throw error;
  }
}

module.exports = {
  uploadImageCloudinary,
  deleteImageCloudinary,
  upload, // export multer middleware if needed
};
