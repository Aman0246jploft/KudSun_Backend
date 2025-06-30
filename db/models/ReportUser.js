const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ReportUserSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId, ref: 'User', index: true, trim: true
    },
    title:{
        type:String
    },
    description:{
        type:String
    },
    image:[{type:String}],
    isDisable: { type: Boolean, default: false },
})



ReportUserSchema.options.toJSON = {
    transform: function (doc, ret, options) {
        delete ret.__v;
        delete ret.password; // Don't send password in JSON responses
        return ret;
    }
};

module.exports = mongoose.model('ReportUser', ReportUserSchema, 'ReportUser');
