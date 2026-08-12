import { Schema, model, models, baseJsonOptions } from "./base.js";

const actorSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  employeeName: { type: String, required: true, trim: true },
  employeeEmail: { type: String, trim: true, lowercase: true, default: "" },
}, { _id: false });

const conversationSchema = new Schema({
  occurredAt: { type: Date, required: true, index: true },
  type: { type: String, enum: ["Call", "Chat", "Email", "Other"], required: true },
  notes: { type: String, required: true, trim: true, maxlength: 5000 },
  nextFollowUpAt: { type: Date },
  status: { type: String, enum: ["Pending", "Progress", "Completed", "Cancelled"], required: true },
  handledBy: { type: actorSchema, required: true },
}, { timestamps: true });

const statusHistorySchema = new Schema({
  from: { type: String, enum: ["Pending", "Progress", "Completed", "Cancelled", null], default: null },
  to: { type: String, enum: ["Pending", "Progress", "Completed", "Cancelled"], required: true },
  changedAt: { type: Date, required: true, default: Date.now },
  changedBy: { type: actorSchema, required: true },
}, { _id: false });

const followUpSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  assignedEmployee: { type: actorSchema, required: true },
  assignedBy: { type: actorSchema, required: true },
  assignedAt: { type: Date, required: true, default: Date.now },
  status: { type: String, enum: ["Pending", "Progress", "Completed", "Cancelled"], default: "Pending", index: true },
  lastFollowUpAt: { type: Date },
  nextFollowUpAt: { type: Date },
  conversations: { type: [conversationSchema], default: [] },
  statusHistory: { type: [statusHistorySchema], default: [] },
}, baseJsonOptions);

followUpSchema.index({ "assignedEmployee.employeeId": 1, status: 1, updatedAt: -1 });
export const FollowUp = models.FollowUp || model("FollowUp", followUpSchema);
