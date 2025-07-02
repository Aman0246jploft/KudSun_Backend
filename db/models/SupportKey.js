const moment = require('moment');
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

let SupportKeySchema = new Schema({
    name: {
        type: String,
        unique: true,
    },
    order: {
        type: Number
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    isDisable: {
        type: Boolean,
        default: false
    },
}, {
    timestamps: true
});


SupportKeySchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};
module.exports = mongoose.model("SupportKey", SupportKeySchema, "SupportKey");
