const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// is FOR  DELIVERY ONLY

const UserAddressSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    label: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
    postalCode: { type: String, required: true, trim: true },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    notes: {
        type: String
    },
    isActive: { type: Boolean, default: false },
    
    provinceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location"

    },
    districtId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location"
    }


}, {
    timestamps: true
});

UserAddressSchema.index({ userId: 1, isDefault: 1 });

module.exports = mongoose.model("UserAddress", UserAddressSchema, 'UserAddress');
