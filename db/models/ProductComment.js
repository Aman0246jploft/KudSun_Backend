const mongoose = require("mongoose");


const ProductCommentSchema = new mongoose.Schema({
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
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellProduct',
        required: true,
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProductComment',
        default: null,
    },
        isDisable: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },

}, { timestamps: true });

ProductCommentSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});


module.exports = mongoose.model("ProductComment", ProductCommentSchema, "ProductComment"); 
