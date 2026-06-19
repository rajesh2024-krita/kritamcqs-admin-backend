import { Schema, model, models, baseJsonOptions } from "./base.js";

export const appNotificationAudienceValues = [
  "all",
  "premium",
  "nonPremium",
  "newRegistered",
  "active",
];

export const appNotificationActionValues = [
  "dailyTest",
  "weakAreas",
  "subscription",
  "notifications",
  "custom",
];

export const appNotificationDeliveryModeValues = ["app", "email", "both", "push", "app_push", "email_push", "all"];

const scheduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    time: { type: String, default: "09:00" },
  },
  { _id: false },
);

const reminderSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    image: { type: String, default: "" },
    ctaAction: { type: String, enum: appNotificationActionValues, default: "notifications" },
    ctaLink: { type: String, default: "" },
    audience: { type: String, enum: appNotificationAudienceValues, default: "all" },
    deliveryMode: { type: String, enum: appNotificationDeliveryModeValues, default: "app" },
    schedules: { type: [scheduleSchema], default: [] },
  },
  { _id: false },
);

const appNotificationSettingsSchema = new Schema(
  {
    key: { type: String, default: "app-reminders", unique: true, index: true },
    dailyTest: { type: reminderSchema, default: {} },
    weakAreas: { type: reminderSchema, default: {} },
    updatedById: { type: Schema.Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

export const AppNotificationSettings =
  models.AppNotificationSettings || model("AppNotificationSettings", appNotificationSettingsSchema);
