const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const { roleId } = require("../../utils/Role");

const Schema = mongoose.Schema;

const UserSchema = new Schema({
    userName: {
        type: String,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        index: true
    },
    profileImage: {
        type: String,
    },
    password: {
        type: String,
        required: true
    },
    // role: {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: "Role",
    //     validate: {
    //         validator: function (value) {
    //             if (this.roleId === roleId.SUPER_ADMIN) {
    //                 return true;
    //             }
    //             return !!value;
    //         },
    //         message: "Role is required unless roleId is SUPER_ADMIN"
    //     }
    // },
    roleId: {
        type: Number,
        enum: Object.values(roleId),
        default: roleId.USER,
        index: true
    },
    categories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category"
    }],
    fmcToken: {
        type: String,
    },
    phoneNumber: {
        type: String,
        trim: true
    },
    dob: {
        type: Date
    },
    gender: {
        type: String,
    },
    language: {
        type: String
    },
    isDisable: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    lastLogin: {
        type: Date
    },

}, {
    timestamps: true
});








UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {

        const hashNumber = Number(process.env.SALT_WORK_FACTOR)
        const salt = await bcrypt.genSalt(hashNumber);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});






UserSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        delete ret.password; // Don't send password in JSON responses
        return ret;
    }
};

module.exports = mongoose.model("User", UserSchema, "User"); 