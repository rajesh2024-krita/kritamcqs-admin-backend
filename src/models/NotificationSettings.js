import { Schema, model, models } from "./base.js";

const reminderSchema = new Schema(
  {
    daysBefore: { type: Number, required: true },
    enabled: { type: Boolean, default: true },
    title: { type: String, default: "" },
    body: { type: String, default: "" },
    emailSubject: { type: String, default: "" },
    emailBody: { type: String, default: "" },
  },
  { _id: false },
);

const notificationSettingsSchema = new Schema(
  {
    key: { type: String, default: "subscription-expiry", unique: true, index: true },
    enabled: { type: Boolean, default: true },
    emailEnabled: { type: Boolean, default: true },
    inAppEnabled: { type: Boolean, default: true },
    reminders: { type: [reminderSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const NotificationSettings = models.NotificationSettings || model("NotificationSettings", notificationSettingsSchema);
