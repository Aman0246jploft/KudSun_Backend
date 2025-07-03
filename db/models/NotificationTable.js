const mongoose = require("mongoose");


const NotifiactionTableSchema = new mongoose.Schema({
    dealChatnotification: {
        type: Boolean,
        defaut: true
    },
    activityNotification: {
        type: Boolean,
        defaut: true
    },
    alertNotification: {
        type: Boolean,
        defaut: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    }

}, { timestamps: true });

NotifiactionTableSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});


module.exports = mongoose.model("NotifiactionTable", NotifiactionTableSchema, "NotifiactionTable"); 
