const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const DisputeTypeSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true,
        minlength: 2
    },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

// Optional index
// DisputeTypeSchema.index({ name: 1 });

module.exports = mongoose.model('DisputeType', DisputeTypeSchema, 'DisputeType'); // or omit 3rd arg for auto pluralization
