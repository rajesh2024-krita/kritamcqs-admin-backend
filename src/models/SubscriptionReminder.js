import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

export const subscriptionReminderStatusValues = ["pending", "stopped", "completed", "max_reached"];

const subscriptionReminderSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    subscriptionId: { type: String, trim: true, default: "", index: true },
    subscriptionPlan: { type: String, trim: true, default: "" },
    eventType: { type: String, trim: true, required: true, index: true },
    eventTime: { type: Date, default: Date.now, index: true },
    activeKey: { type: String, trim: true, index: true },
    platform: { type: String, enum: ["Android", "iOS", "Web"], default: "Android", index: true },
    status: { type: String, enum: subscriptionReminderStatusValues, default: "pending", index: true },
    reminderCount: { type: Number, default: 0 },
    lastReminderDate: { type: Date },
    nextReminderDate: { type: Date, index: true },
    purchaseCompleted: { type: Boolean, default: false, index: true },
    completedDate: { type: Date },
    stoppedReason: { type: String, trim: true, default: "" },
    immediateReminderSentAt: { type: Date },
    immediateReminderSending: { type: Boolean, default: false },
    scheduledReminderSending: { type: Boolean, default: false },
  },
  baseJsonOptions,
);

subscriptionReminderSchema.index({ status: 1, nextReminderDate: 1 });
subscriptionReminderSchema.index({ userId: 1, status: 1, createdAt: -1 });
subscriptionReminderSchema.set("collection", "subscription_reminders");

export const SubscriptionReminder = models.SubscriptionReminder || model("SubscriptionReminder", subscriptionReminderSchema);
