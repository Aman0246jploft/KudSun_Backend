// models/Role.js
const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // e.g. admin, editor, viewer
    description: { type: String }
});

roleSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        return ret;
    }
};

module.exports = mongoose.model("Role", roleSchema, "Role");


