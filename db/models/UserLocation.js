const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// NOT IN USEDDDDDDDD


const UserlocationSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    line1: { type: String, required: true },
    country: { type: String, required: true },
    state: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: false },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
}, {
    timestamps: true
});

UserlocationSchema.index({ userId: 1, isDefault: 1 });

// module.exports = mongoose.model("UserLocation", UserlocationSchema, 'UserLocation');
