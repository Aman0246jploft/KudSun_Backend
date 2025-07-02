const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const BlockUserSchema = new Schema({
    blockBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
}, {
    timestamps: true
});

BlockUserSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});



module.exports = mongoose.model("BlockUser", BlockUserSchema, "BlockUser"); 
