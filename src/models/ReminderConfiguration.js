import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

export const reminderChannelValues = ["Notification", "Email", "Both"];
export const reminderDelayUnitValues = ["Minutes", "Hours", "Days"];
export const reminderPlatformValues = ["Android", "iOS", "Both"];
export const reminderStatusValues = ["enabled", "disabled"];
export const reminderTargetValues = ["all", "free", "premium", "selected"];

const reminderConfigurationSchema = new Schema(
  {
    reminderName: { type: String, required: true, trim: true, maxlength: 160 },
    status: { type: String, enum: reminderStatusValues, default: "enabled", index: true },
    channels: { type: String, enum: reminderChannelValues, default: "Both" },
    initialDelay: { type: Number, min: 0, default: 30 },
    repeatInterval: { type: Number, min: 1, default: 24 },
    delayUnit: { type: String, enum: reminderDelayUnitValues, default: "Hours" },
    maximumReminderCount: { type: Number, min: 1, max: 20, default: 3 },
    notificationTitle: { type: String, trim: true, maxlength: 180, default: "" },
    notificationMessage: { type: String, trim: true, maxlength: 2000, default: "" },
    emailSubject: { type: String, trim: true, maxlength: 180, default: "" },
    emailTemplate: { type: String, maxlength: 250000, default: "" },
    platform: { type: String, enum: reminderPlatformValues, default: "Both", index: true },
    applicablePlan: { type: String, trim: true, maxlength: 160, default: "" },
    targetUsers: { type: String, enum: reminderTargetValues, default: "all" },
    priority: { type: Number, default: 100, index: true },
    createdBy: { type: Types.ObjectId, ref: "User" },
    updatedBy: { type: Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

reminderConfigurationSchema.index({ reminderName: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
reminderConfigurationSchema.index({ status: 1, platform: 1, priority: 1 });
reminderConfigurationSchema.set("collection", "reminder_configurations");

export const ReminderConfiguration = models.ReminderConfiguration || model("ReminderConfiguration", reminderConfigurationSchema);
