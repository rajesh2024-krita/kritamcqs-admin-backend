import { Schema, model, models, baseJsonOptions } from "./base.js";

const notificationTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    image: { type: String, trim: true, default: "" },
    deepLink: { type: String, trim: true, default: "/notifications" },
    targetType: { type: String, enum: ["all", "free", "premium", "neet", "jee", "selected"], default: "all", index: true },
    category: { type: String, enum: ["exam", "offer", "subscription", "revision", "mock_test", "system", "custom"], default: "custom" },
    sound: { type: String, enum: ["default", "custom", "silent"], default: "default" },
    priority: { type: String, enum: ["high", "normal", "low"], default: "high" },
    status: { type: Boolean, default: true, index: true },
  },
  baseJsonOptions,
);

export const NotificationTemplate = models.NotificationTemplate || model("NotificationTemplate", notificationTemplateSchema);
