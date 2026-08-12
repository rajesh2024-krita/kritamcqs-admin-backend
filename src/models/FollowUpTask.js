import { Schema, model, models, baseJsonOptions } from "./base.js";

export const FOLLOW_UP_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "PENDING", "WAITING_FOR_CLIENT", "RESCHEDULED"];
export const COMMUNICATION_TYPES = ["EMAIL", "CHAT", "CALL", "WHATSAPP", "MEETING", "OTHER"];

const followUpTaskSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  assignedEmployeeId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  communicationType: { type: String, enum: COMMUNICATION_TYPES, required: true, index: true },
  notes: { type: String, required: true, trim: true, maxlength: 10000 },
  result: { type: String, trim: true, maxlength: 2000, default: "" },
  followUpAt: { type: Date, required: true, index: true },
  nextFollowUpAt: { type: Date, default: null, index: true },
  status: { type: String, enum: FOLLOW_UP_STATUSES, default: "NOT_STARTED", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, baseJsonOptions);

followUpTaskSchema.index({ clientId: 1, followUpAt: -1 });
export const FollowUpTask = models.FollowUpTask || model("FollowUpTask", followUpTaskSchema);
