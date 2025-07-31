const mongoose = require("mongoose");

const Schema = mongoose.Schema;



const BankSchema = new Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        // lowercase: true
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


module.exports = mongoose.model("Bank", BankSchema, "Bank"); 
