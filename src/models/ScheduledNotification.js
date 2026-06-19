import { Schema, model, models, baseJsonOptions } from "./base.js";

const scheduledNotificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    image: { type: String, trim: true, default: "" },
    deepLink: { type: String, trim: true, default: "/notifications" },
    targetType: { type: String, enum: ["all", "free", "premium", "neet", "jee", "selected"], default: "all", index: true },
    selectedUsers: { type: [String], default: [] },
    category: { type: String, enum: ["exam", "offer", "subscription", "revision", "mock_test", "system", "custom"], default: "custom" },
    sound: { type: String, enum: ["default", "custom", "silent"], default: "default" },
    priority: { type: String, enum: ["high", "normal", "low"], default: "high" },
    scheduleDate: { type: Date, required: true, index: true },
    status: { type: String, enum: ["pending", "sent", "failed", "cancelled", "draft"], default: "pending", index: true },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    sentAt: { type: Date },
    lastError: { type: String, default: "" },
  },
  baseJsonOptions,
);

export const ScheduledNotification = models.ScheduledNotification || model("ScheduledNotification", scheduledNotificationSchema);
