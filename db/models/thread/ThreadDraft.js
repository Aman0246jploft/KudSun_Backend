
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const threadDraftSchema = new Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
    },
    subCategoryId: {
        type: mongoose.Schema.Types.ObjectId,
    },
    title: {
        type: String,
        trim: true,
    },
    description: {
        type: String,
        default: '',
        trim: true,
    },
    budgetFlexible: {
        type: Boolean,
        default: false
    },
    budgetRange: {
        min: { type: Number },
        max: { type: Number }
    },
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    photos: [{
        type: String
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    isTrending: {
        type: Boolean,
        default: false
    },
    isDisable: {
        type: Boolean,
        default: false
    },

}, {
    timestamps: true
});

threadDraftSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model("ThreadDraft", threadDraftSchema, "ThreadDraft");
