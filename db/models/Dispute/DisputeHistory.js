const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const DisputeHistorySchema = new Schema({
  disputeId:{type:String,require:true},
  event: { type: String, required: true ,enum:['CREATED','SELLER_RESPONSE','ADMIN_DECISION'] }, 
  title: { type: String, required: true },
  note: { type: String },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});


module.exports = mongoose.model('DisputeHistory', DisputeHistorySchema, 'DisputeHistory');
