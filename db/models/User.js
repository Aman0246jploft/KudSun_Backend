const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');
const { roleId } = require("../../utils/Role");

const Schema = mongoose.Schema;

const UserSchema = new Schema({
    step: {
        type: Number,
        default: 1,
        index: true
    },
    tempOtp: {
        type: String,
        default: null
    },
    loginOtp: {
        type: String,
        select: false
    },
    loginOtpExpiresAt: {
        type: Date,
        select: false
    },
    loginStepStartedAt: {
        type: Date,
        select: false
    },
    userName: {
        type: String,
        trim: true,
        lowercase: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        index: true
    },
    profileImage: {
        type: String,
        default: null
    },
    password: {
        type: String,
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
    fcmToken: {
        type: String,
        default: null,
    },
    phoneNumber: {
        type: String,
        trim: true,
        unique: true,
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
    // when Payment credintial is done  
    is_Verified_Seller: {
        type: Boolean,
        default: false
    },
    is_Id_verified: {
        type: Boolean,
        default: false
    },
    //admin will manage it
    is_Preferred_seller: {
        type: Boolean,
        default: false
    },
    isLive: {
        type: Boolean,
        default: false
    },
    isFlagedReported: {
        type: Boolean,
        default: false
    },
    provinceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location",
        

    },
    districtId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Location"
    },
    dealChatnotification: {
        type: Boolean,
        defaut: true
    },
    activityNotification: {
        type: Boolean,
        defaut: true
    },
    alertNotification: {
        type: Boolean,
        defaut: true
    },
    averageRatting:{
        type:Number,
        default:0
    }

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
        delete ret.password;

        // Manually ensure default values are included if undefined
        ret.step ??= 1;
        ret.tempOtp ??= null;
        ret.profileImage ??= null;
        ret.roleId ??= roleId.USER;
        ret.fcmToken ??= null;
        ret.isDisable ??= false;
        ret.isDeleted ??= false;
        ret.is_Verified_Seller ??= false;
        ret.is_Id_verified ??= false;
        ret.is_Preferred_seller ??= false;
        ret.isLive ??= false;
        ret.isFlagedReported ??= false;
        ret.dealChatnotification ??= true;
        ret.activityNotification ??= true;
        ret.alertNotification ??= true;
        ret.averageRatting ??= 0;

        return ret;
    }
};


module.exports = mongoose.model("User", UserSchema, "User"); 