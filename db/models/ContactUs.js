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
        type: Schema.Types.ObjectId,
        ref: 'SupportKey',
        defalut: null
    },
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

module.exports = mongoose.model('ContactUs', contactUsSchema, 'ContactUs');
