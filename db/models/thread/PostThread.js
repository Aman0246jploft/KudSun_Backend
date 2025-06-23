const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const threadSchema = new Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    subCategoryId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
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
    isClosed: {
        type: Boolean,
        default: false
    },
    budgetRange: {
        min: { type: Number, required: function () { return !this.budgetFlexible; } },
        max: { type: Number, required: function () { return !this.budgetFlexible; } }
    },
    tags: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    photos: [{
        type: String
    }],
    isClosed: {
        type: Boolean,
        default: false
    },
    isDeleted: {
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

threadSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});


// Hook to validate min/max if not flexible
threadSchema.pre('save', function (next) {
    if (!this.budgetFlexible) {
        if (this.budgetRange?.min == null || this.budgetRange?.max == null) {
            return next(new Error("Min and Max budget must be provided if budget is not flexible."));
        }
        if (this.budgetRange.min > this.budgetRange.max) {
            return next(new Error("Min budget cannot be greater than max budget."));
        }
    }
    next();
});

module.exports = mongoose.model("Thread", threadSchema, "Thread");







