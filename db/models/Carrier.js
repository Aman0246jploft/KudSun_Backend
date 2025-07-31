const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CarrierSchema = new Schema({
    name: {
        type: String, required: true, trim: true,
        // lowercase: true,
         unique: true, index: true
    },
    contact: String,
    website: String,
    estimatedDays: { type: Number }, // fallback estimate
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

CarrierSchema.index({ code: 1 });

module.exports = mongoose.model("Carrier", CarrierSchema, 'Carrier');
