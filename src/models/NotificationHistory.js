import { Schema, model, models, baseJsonOptions } from "./base.js";

const notificationHistorySchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    image: { type: String, trim: true, default: "" },
    deepLink: { type: String, trim: true, default: "/notifications" },
    targetType: { type: String, default: "all", index: true },
    selectedUsers: { type: [String], default: [] },
    category: { type: String, default: "custom", index: true },
    sound: { type: String, default: "default" },
    priority: { type: String, default: "high" },
    sentCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    noTokenCount: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "scheduled", "sent", "failed", "partial"], default: "sent", index: true },
    createdBy: { type: String, default: "" },
    createdByName: { type: String, default: "" },
    sentAt: { type: Date },
    scheduledNotificationId: { type: Schema.Types.ObjectId, ref: "ScheduledNotification" },
  },
  baseJsonOptions,
);

export const NotificationHistory = models.NotificationHistory || model("NotificationHistory", notificationHistorySchema);
