import { Schema, model, models, baseJsonOptions } from "./base.js";

const appUsageSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "", index: true },
    mobile: { type: String, trim: true, default: "", index: true },
    userType: { type: String, enum: ["Free", "Premium"], default: "Free", index: true },
    loginMethod: { type: String, trim: true, default: "" },
    deviceId: { type: String, trim: true, default: "", index: true },
    platform: { type: String, trim: true, lowercase: true, default: "unknown", index: true },
    appVersion: { type: String, trim: true, default: "", index: true },
    deviceBrand: { type: String, trim: true, default: "", index: true },
    deviceModel: { type: String, trim: true, default: "", index: true },
    osVersion: { type: String, trim: true, default: "" },
    androidVersion: { type: String, trim: true, default: "", index: true },
    screenResolution: { type: String, trim: true, default: "" },
    networkType: { type: String, trim: true, default: "", index: true },
    ramGb: { type: Number },
    batteryLevel: { type: Number },
    batteryCharging: { type: Boolean },
    rootedDevice: { type: Boolean, default: false },
    isVirtualDevice: { type: Boolean, default: false },
    ipAddress: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["Active", "Completed", "Force Closed", "Crashed"], default: "Active", index: true },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, index: true },
    durationSeconds: { type: Number, default: 0, min: 0 },
    foregroundSeconds: { type: Number, default: 0, min: 0 },
    backgroundSeconds: { type: Number, default: 0, min: 0 },
    entryScreen: { type: String, trim: true, default: "", index: true },
    exitScreen: { type: String, trim: true, default: "", index: true },
    screenViews: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },
    lastActiveAt: { type: Date, required: true, index: true },
  },
  baseJsonOptions,
);

appUsageSessionSchema.index({ userId: 1, startedAt: -1 });
appUsageSessionSchema.index({ email: 1, startedAt: -1 });
appUsageSessionSchema.index({ platform: 1, startedAt: -1 });

export const AppUsageSession = models.AppUsageSession || model("AppUsageSession", appUsageSessionSchema);
