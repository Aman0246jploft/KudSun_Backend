const mongoose = require("mongoose");
const Schema = mongoose.Schema;



const ProductLikeSchema = new Schema({
    likeBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    productId: {
        type: Schema.Types.ObjectId,
        ref: 'SellProduct',
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

ProductLikeSchema.set('toJSON', {
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});



module.exports = mongoose.model("ProductLike", ProductLikeSchema, "ProductLike"); 
