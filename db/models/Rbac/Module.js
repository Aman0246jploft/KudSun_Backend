const mongoose = require('mongoose');

const moduleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Module name is required.'],
    unique: true,
    trim: true,          // removes whitespace from both ends
    lowercase: true      // converts to lowercase automatically
  },
  description: {
    type: String,
    trim: true           // optional: trim description too
  }
});

// Remove __v from JSON responses
moduleSchema.options.toJSON = {
  transform: function (doc, ret, options) {
    delete ret.__v;
    return ret;
  }
};

module.exports = mongoose.model('Module', moduleSchema, 'Module');
