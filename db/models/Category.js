const mongoose = require("mongoose");

// Each parameter value object
const parameterValueSchema = new mongoose.Schema({
    value: { type: String, required: true, trim: true, lowercase: true },
    isAddedByAdmin: { type: Boolean, default: true },
    addedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

// Parameter Schema
const parameterSchema = new mongoose.Schema({
    key: { type: String, required: true, trim: true, lowercase: true },
    values: [parameterValueSchema],
    isAddedByAdmin: { type: Boolean, default: true },
    addedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

// Subcategory Schema
const subCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, lowercase: true },
    slug: { type: Number, default: 0 },
    image: { type: String, default: null },
    parameters: [parameterSchema]
});

// Category Schema
const categorySchema = new mongoose.Schema({
    name: {
        type: String, required: true, unique: true, trim: true,
        lowercase: true,
    },
    slug: { type: Number, default: 0 },
    image: { type: String, default: null },
    subCategories: [subCategorySchema],
    isDisable: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },


}, {
    timestamps: true
});

// toJSON cleanup
categorySchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

// Auto-increment slugs
categorySchema.pre('save', async function (next) {
    if (this.isNew && (!this.slug || this.slug === 0)) {
        const count = await mongoose.model('Category').countDocuments({
            addedByUserId: this.addedByUserId,
            isAddedByAdmin: this.isAddedByAdmin
        });
        this.slug = count + 1;
    }

    if (this.isModified('subCategories')) {
        const usedSlugs = new Set();
        this.subCategories.forEach((subCat, index) => {
            if (!subCat.slug || usedSlugs.has(subCat.slug)) {
                subCat.slug = index + 1;
            }
            usedSlugs.add(subCat.slug);
        });
    }

    next();
});

module.exports = mongoose.model('Category', categorySchema, "Category");
