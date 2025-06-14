const mongoose = require("mongoose");


const commentSchema = new mongoose.Schema({
    content: {
        type: String,
        trim: true,
        default: '',
    },
    photos: [{
        type: String
    }],
    associatedProducts: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SellProduct',
        },
    ],
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    thread: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Thread',
        required: true,
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ThreadComment',
        default: null,
    },
}, { timestamps: true });

commentSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});


module.exports = mongoose.model("ThreadComment", commentSchema, "ThreadComment"); 
