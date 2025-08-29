const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { roleId } = require("../../utils/Role");

const Schema = mongoose.Schema;

const UserSchema = new Schema(
  {
    userId: {
      type: String,
    },
    step: {
      type: Number,
      default: 1,
      index: true,
    },
    tempOtp: {
      type: String,
      default: null,
    },
    loginOtp: {
      type: String,
      select: false,
    },
    loginOtpExpiresAt: {
      type: Date,
      select: false,
    },
    loginStepStartedAt: {
      type: Date,
      select: false,
    },
    userName: {
      type: String,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    profileImage: {
      type: String,
      default: null,
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
      index: true,
    },
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    fcmToken: {
      type: String,
      default: null,
    },
    phoneNumber: {
      type: String,
      trim: true,
      // unique: true,
    },
    dob: {
      type: Date,
    },
    gender: {
      type: String,
    },
    language: {
      type: String,
      default: "english",
    },
    isDisable: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
    // when Payment credintial is done
    is_Verified_Seller: {
      type: Boolean,
      default: false,
    },
    is_Id_verified: {
      type: Boolean,
      default: false,
    },
    //admin will manage it
    is_Preferred_seller: {
      type: Boolean,
      default: false,
    },
    isLive: {
      type: Boolean,
      default: false,
    },
    isFlagedReported: {
      type: Boolean,
      default: false,
    },
    provinceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
    },
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
    },
    dealChatnotification: {
      type: Boolean,
      default: true,
    },
    activityNotification: {
      type: Boolean,
      default: true,
    },
    alertNotification: {
      type: Boolean,
      default: true,
    },

    verifyEmail: {
      type: Boolean,
      default: false,
    },

    verifyPhone: {
      type: Boolean,
      default: false,
    },

    //seller
    totalRatingSum: { type: Number, default: 0 },
    totalRatingCount: { type: Number, default: 0 },
    averageRatting: { type: Number, default: 0 },

    //Buyer
    totalBuyerRatingSum: { type: Number, default: 0 },
    totalBuyerRatingCount: { type: Number, default: 0 }, //seller rate to buyer
    averageBuyerRatting: { type: Number, default: 0 },

    walletBalance: {
      type: Number,
      default: 0,
    },
    FreezWalletBalance: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ _id: 1, walletBalance: 1 });

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const hashNumber = Number(process.env.SALT_WORK_FACTOR);
    const salt = await bcrypt.genSalt(hashNumber);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }

  if (!this.userId) {
    try {
      this.userId = await generateUniqueUserId();
    } catch (err) {
      return next(err);
    }
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
  },
};

async function generateUniqueUserId() {
  let unique = false;
  let userId = "";

  while (!unique) {
    userId = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit number
    const existingUser = await User.findOne({ userId });
    if (!existingUser) unique = true;
  }

  return userId;
}

module.exports = mongoose.model("User", UserSchema, "User");
