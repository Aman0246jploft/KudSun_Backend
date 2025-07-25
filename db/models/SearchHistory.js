const mongoose = require('mongoose');

const SearchHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  searchQuery: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  // Type of search/interaction
  type: {
    type: String,
    enum: ['search', 'product_view', 'product_click', 'thread_view', 'thread_click'],
    default: 'search',
    index: true
  },
  // Reference to the clicked/viewed item
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SellProduct',
    sparse: true
  },
  threadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread',
    sparse: true
  },
  // Search context
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    sparse: true
  },
  // Count how many times this search was performed
  searchCount: {
    type: Number,
    default: 1
  },
  // Last time this search was performed
  lastSearched: {
    type: Date,
    default: Date.now
  },
  // Search filters used (for analytics)
  filters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isDisable: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
},{timestamps:true});

// Index for better performance
SearchHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });
SearchHistorySchema.index({ userId: 1, searchQuery: 1, type: 1 });

module.exports = mongoose.model('SearchHistory', SearchHistorySchema,'SearchHistory');
