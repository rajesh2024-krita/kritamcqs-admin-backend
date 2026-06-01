import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

const adminLoginHistorySchema = new Schema(
  {
    adminId: { type: Types.ObjectId, ref: "User", index: true },
    employeeName: { type: String, trim: true },
    employeeEmail: { type: String, trim: true, lowercase: true, index: true },
    role: { type: String, enum: ["main", "employee"], default: "main", index: true },
    loginTime: { type: Date, default: Date.now, index: true },
    logoutTime: { type: Date },
    ipAddress: { type: String, trim: true },
    loginStatus: { type: String, enum: ["success", "failed"], required: true, index: true },
    failureReason: { type: String, trim: true },
  },
  baseJsonOptions,
);

adminLoginHistorySchema.index({ createdAt: -1 });
adminLoginHistorySchema.index({ adminId: 1, loginTime: -1 });

export const AdminLoginHistory = models.AdminLoginHistory || model("AdminLoginHistory", adminLoginHistorySchema);
