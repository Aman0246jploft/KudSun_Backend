const mongoose = require("mongoose");

const Schema = mongoose.Schema;



const WithdrawlSettingSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        // lowercase: true
    },
    value: {
        type: Number,
    },
    isDisable: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {    
    timestamps: true
});


module.exports = mongoose.model("WithdrawlSetting", WithdrawlSettingSchema, "WithdrawlSetting"); 
