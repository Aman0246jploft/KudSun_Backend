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

function parseCloudinaryUrl(url) {
  try {
    // Example Cloudinary URL format:
    // https://res.cloudinary.com/<cloud_name>/image/upload/v1234567890/userId/fileName.jpg

    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/'); // ['', 'image', 'upload', 'v1234567890', 'userId', 'fileName.jpg']

    // folder (userId) is at index -2, filename at index -1
    const userId = parts[parts.length - 2];
    const fileWithExt = parts[parts.length - 1];

    // split filename and ext
    const dotIndex = fileWithExt.lastIndexOf('.');
    const fileName = dotIndex !== -1 ? fileWithExt.substring(0, dotIndex) : fileWithExt;
    const ext = dotIndex !== -1 ? fileWithExt.substring(dotIndex) : '';

    return { userId, fileName, ext };
  } catch (err) {
    console.error("Failed to parse Cloudinary URL:", url, err);
    return null;
  }
}

async function deleteImageCloudinary(url) {
  try {
    // Parse the Cloudinary URL to get public_id and folder (userId)
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/'); 
    // Example: ['', 'image', 'upload', 'v1234567890', 'userId', 'fileName.jpg']

    const userId = parts[parts.length - 2];
    const fileWithExt = parts[parts.length - 1];
    
    const dotIndex = fileWithExt.lastIndexOf('.');
    const publicId = dotIndex !== -1 ? fileWithExt.substring(0, dotIndex) : fileWithExt;

    // Construct the full public_id including folder
    const fullPublicId = `${userId}/${publicId}`;

    // Call Cloudinary delete API
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(fullPublicId, { resource_type: 'image' }, (error, result) => {
        if (error) {
          console.error("Cloudinary delete error:", error);
          return reject(error);
        }
        resolve(result);
      });
    });
  } catch (err) {
    console.error("Error parsing URL or deleting from Cloudinary:", err);
    throw err;
  }
}


module.exports = {
  uploadImageCloudinary,
  deleteImageCloudinary
}
