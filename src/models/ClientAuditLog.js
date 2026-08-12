import { Schema, model, models, baseJsonOptions } from "./base.js";

const clientAuditLogSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  followUpId: { type: Schema.Types.ObjectId, ref: "FollowUpTask", default: null, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actorName: { type: String, default: "Administrator" },
  action: { type: String, required: true, index: true },
  previousValue: { type: Schema.Types.Mixed, default: null },
  newValue: { type: Schema.Types.Mixed, default: null },
}, baseJsonOptions);

export const ClientAuditLog = models.ClientAuditLog || model("ClientAuditLog", clientAuditLogSchema);
