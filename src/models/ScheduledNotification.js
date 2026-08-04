import { Schema, model, models, baseJsonOptions } from "./base.js";

const scheduledNotificationSchema = new Schema(
  {
    campaignName: { type: String, trim: true, default: "" },
    deliveryType: { type: String, enum: ["notification", "email", "both"], default: "notification", index: true },
    title: { type: String, trim: true, default: "" },
    message: { type: String, default: "" },
    image: { type: String, trim: true, default: "" },
    deepLink: { type: String, trim: true, default: "/notifications" },
    ctaText: { type: String, trim: true, default: "" },
    targetScreen: { type: String, trim: true, default: "" },
    emailTemplateId: { type: String, trim: true, default: "" },
    emailTemplateKey: { type: String, trim: true, default: "" },
    emailSubject: { type: String, trim: true, default: "" },
    emailBody: { type: String, default: "" },
    targetType: { type: String, enum: ["all", "free", "premium", "neet", "jee", "active", "inactive", "selected"], default: "all", index: true },
    selectedUsers: { type: [String], default: [] },
    category: { type: String, enum: ["exam", "offer", "subscription", "revision", "mock_test", "system", "custom"], default: "custom" },
    sound: { type: String, enum: ["default", "custom", "silent"], default: "default" },
    priority: { type: String, enum: ["high", "normal", "low"], default: "high" },
    scheduleDate: { type: Date, index: true },
    status: { type: String, enum: ["pending", "sent", "failed", "cancelled", "draft"], default: "pending", index: true },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    sentAt: { type: Date },
    lastError: { type: String, default: "" },
    logs: { type: [Schema.Types.Mixed], default: [] },
  },
  baseJsonOptions,
);

export const ScheduledNotification = models.ScheduledNotification || model("ScheduledNotification", scheduledNotificationSchema);
