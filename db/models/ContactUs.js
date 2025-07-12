const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const contactUsSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },

    name: {
        type: String
    },

    contact: {
        type: String
    },

    type: {
        type: String
    },
    // type: {
    //     type: Schema.Types.ObjectId,
    //     ref: 'SupportKey',
    //     defalut: null
    // },
    desc: {
        type: String,
        maxLength: 1200
    },

    image: [{
        type: String
    }],

    isRead: {
        type: Boolean,
        default: false
    },


    reply: {
        subject: { type: String },
        body: { type: String, maxLength: 1200 },
        repliedAt: { type: Date, default: null }
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




contactUsSchema.pre('save', function (next) {
    if (this.isModified('reply') && this.reply.body) {
        this.isRead = true;
  }
  next();
});

module.exports = mongoose.model('ContactUs', contactUsSchema, 'ContactUs');