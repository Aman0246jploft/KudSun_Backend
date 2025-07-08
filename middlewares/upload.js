const multer = require('multer');
const path = require('path');

// File size limits
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_CHAT_FILE_SIZE = 2 * 1024 * 1024; // 2MB for chat files

// Allowed file types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg'];
const ALLOWED_DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

// Storage configuration for regular uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Different destinations based on file type
    let uploadPath = 'public/uploads/';
    
    if (file.fieldname === 'profileImage') {
      uploadPath += 'user-profiles/';
    } else if (file.fieldname === 'productImage') {
      uploadPath += 'products/';
    } else if (file.fieldname === 'chatFile') {
      uploadPath += 'chat/';
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Create a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-');
    cb(null, uniqueSuffix + '-' + sanitizedName);
  },
});

// File filter function
const fileFilter = (req, file, cb) => {
  const mimetype = file.mimetype;
  
  // Check file type based on upload field
  if (file.fieldname === 'profileImage') {
    if (ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }
  } else if (file.fieldname === 'productImage') {
    if (ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }
  } else if (file.fieldname === 'chatFile') {
    if ([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES, ...ALLOWED_DOC_TYPES].includes(mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type for chat upload.'), false);
    }
  } else {
    cb(new Error('Unknown file upload field.'), false);
  }
};

// Create multer instance with configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  }
});

// Special configuration for chat file uploads (handles base64)
const handleChatFileUpload = (req, res, next) => {
  if (!req.body.file || !req.body.fileName) {
    return next();
  }

  try {
    // Extract file data and type from base64
    const matches = req.body.file.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 file data');
    }

    const fileType = matches[1];
    const fileData = Buffer.from(matches[2], 'base64');

    // Check file size
    if (fileData.length > MAX_CHAT_FILE_SIZE) {
      throw new Error('File size exceeds 2MB limit');
    }

    // Check file type
    if (![...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES, ...ALLOWED_DOC_TYPES].includes(fileType)) {
      throw new Error('Invalid file type for chat upload');
    }

    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedName = req.body.fileName.replace(/[^a-zA-Z0-9.]/g, '-');
    const filename = uniqueSuffix + '-' + sanitizedName;
    const filepath = path.join('public/uploads/chat/', filename);

    // Save file
    require('fs').writeFileSync(filepath, fileData);

    // Add file info to request
    req.chatFile = {
      filename: filename,
      originalname: req.body.fileName,
      mimetype: fileType,
      path: filepath,
      size: fileData.length
    };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  upload,
  handleChatFileUpload,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_AUDIO_TYPES,
  ALLOWED_DOC_TYPES,
  MAX_FILE_SIZE,
  MAX_CHAT_FILE_SIZE
};
