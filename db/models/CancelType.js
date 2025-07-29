const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const CancelTypeSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,

        unique: true,
        minlength: 2
    },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

// Optional index
// CancelTypeSchema.index({ name: 1 });

module.exports = mongoose.model('CancelType', CancelTypeSchema, 'CancelType'); // or omit 3rd arg for auto pluralization
