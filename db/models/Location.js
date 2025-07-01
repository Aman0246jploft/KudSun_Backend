const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// user Address

const location = new Schema({
    parentId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
    value: { type: String, required: true },
    isDisable: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
}, {
    timestamps: true
});


module.exports = mongoose.model("Location", location, 'Location');
