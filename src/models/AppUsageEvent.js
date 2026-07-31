import { Schema, model, models, baseJsonOptions } from "./base.js";

const appUsageEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "", index: true },
    userType: { type: String, enum: ["Free", "Premium"], default: "Free", index: true },
    loginMethod: { type: String, trim: true, default: "" },
    deviceId: { type: String, trim: true, default: "", index: true },
    platform: { type: String, trim: true, lowercase: true, default: "unknown", index: true },
    appVersion: { type: String, trim: true, default: "", index: true },
    deviceModel: { type: String, trim: true, default: "", index: true },
    osVersion: { type: String, trim: true, default: "" },
    ipAddress: { type: String, trim: true, default: "" },
    eventType: { type: String, required: true, trim: true, index: true },
    screen: { type: String, trim: true, default: "", index: true },
    previousScreen: { type: String, trim: true, default: "" },
    nextScreen: { type: String, trim: true, default: "" },
    componentName: { type: String, trim: true, default: "", index: true },
    componentType: { type: String, trim: true, default: "", index: true },
    action: { type: String, trim: true, default: "" },
    timestamp: { type: Date, required: true, index: true },
    enterTime: { type: Date },
    exitTime: { type: Date },
    durationSeconds: { type: Number, default: 0, min: 0 },
    coordinates: {
      x: { type: Number },
      y: { type: Number },
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  baseJsonOptions,
);

appUsageEventSchema.index({ userId: 1, timestamp: -1 });
appUsageEventSchema.index({ email: 1, timestamp: -1 });
appUsageEventSchema.index({ sessionId: 1, timestamp: 1 });
appUsageEventSchema.index({ platform: 1, timestamp: -1 });
appUsageEventSchema.index({ screen: 1, eventType: 1, timestamp: -1 });

export const AppUsageEvent = models.AppUsageEvent || model("AppUsageEvent", appUsageEventSchema);
