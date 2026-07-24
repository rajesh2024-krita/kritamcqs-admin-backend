import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

const reminderLogSchema = new Schema(
  {
    reminderId: { type: Types.ObjectId, ref: "SubscriptionReminder", required: true, index: true },
    configurationId: { type: Types.ObjectId, ref: "ReminderConfiguration", index: true },
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    notificationStatus: { type: String, enum: ["not_applicable", "pending", "sent", "failed", "skipped"], default: "not_applicable" },
    emailStatus: { type: String, enum: ["not_applicable", "pending", "sent", "failed", "skipped"], default: "not_applicable" },
    status: { type: String, enum: ["Notification Sent", "Email Sent", "Failed", "Retry", "Success"], default: "Success", index: true },
    errorMessage: { type: String, trim: true, default: "" },
    retryCount: { type: Number, default: 0 },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  baseJsonOptions,
);

reminderLogSchema.index({ createdAt: -1 });
reminderLogSchema.index({ userId: 1, createdAt: -1 });
reminderLogSchema.set("collection", "reminder_logs");

export const ReminderLog = models.ReminderLog || model("ReminderLog", reminderLogSchema);
