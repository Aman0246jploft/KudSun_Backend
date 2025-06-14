const mongoose = require("mongoose");
const Schema = mongoose.Schema;



const FollowSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        
    },
    followedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
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


module.exports = mongoose.model("Follow", FollowSchema, "Follow"); 
