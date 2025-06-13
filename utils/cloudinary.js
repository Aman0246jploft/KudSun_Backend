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


module.exports = {
  uploadImageCloudinary,

}
