import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

const adminActivityLogSchema = new Schema(
  {
    employeeId: { type: Types.ObjectId, ref: "User", index: true },
    employeeName: { type: String, trim: true },
    employeeEmail: { type: String, trim: true, lowercase: true, index: true },
    action: { type: String, enum: ["create", "edit", "delete"], required: true, index: true },
    questionId: { type: Types.ObjectId, ref: "Question", index: true },
    previousValue: { type: Schema.Types.Mixed },
    updatedValue: { type: Schema.Types.Mixed },
  },
  baseJsonOptions,
);

adminActivityLogSchema.index({ createdAt: -1 });
adminActivityLogSchema.index({ employeeId: 1, createdAt: -1 });
adminActivityLogSchema.index({ action: 1, createdAt: -1 });

export const AdminActivityLog = models.AdminActivityLog || model("AdminActivityLog", adminActivityLogSchema);
