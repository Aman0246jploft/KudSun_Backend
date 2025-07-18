const mongoose = require('mongoose');

const SearchHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    trim: true,
    lowercase: true,
  },
  searchQuery: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true,
  },
  isDisable: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
});

module.exports = mongoose.model('SearchHistory', SearchHistorySchema,'SearchHistory');
