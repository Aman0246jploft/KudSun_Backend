const mongoose = require("mongoose");
// Each parameter value object
const parameterValueSchema = new mongoose.Schema({
    value: { type: String, required: true },
    isAddedByAdmin: { type: Boolean, default: true },
    addedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { _id: false });

// Parameter Schema
const parameterSchema = new mongoose.Schema({
    key: { type: String, required: true },
    values: [parameterValueSchema]
}, { _id: false });

// Subcategory Schema
const subCategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: Number, default: 0 },
    image: { type: String, default: null },
    parameters: [parameterSchema]
}, { _id: false });

// Category Schema
const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    slug: { type: Number, default: 0 },
    image: { type: String, default: null },
    subCategories: [subCategorySchema]
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
