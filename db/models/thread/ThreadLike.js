const mongoose = require("mongoose");
const Schema = mongoose.Schema;



const ThreadLikeSchema = new Schema({
    likeBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    threadId: {
        type: Schema.Types.ObjectId,
        ref: 'Thread',
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

ThreadLikeSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});



module.exports = mongoose.model("ThreadLike", ThreadLikeSchema, "ThreadLike"); 
