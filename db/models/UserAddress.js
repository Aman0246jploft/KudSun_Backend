const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserAddressSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: String,
    isActive: { type: Boolean, default: false },
    country: { type: String, required: true },
    postalCode: { type: String, required: true,trim: true },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

UserAddressSchema.index({ userId: 1, isDefault: 1 });

module.exports = mongoose.model("UserAddress", UserAddressSchema, 'UserAddress');
