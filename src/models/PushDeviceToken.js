import { Schema, model, models, baseJsonOptions } from "./base.js";

const pushDeviceTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    platform: { type: String, enum: ["android", "ios", "web", "unknown"], default: "unknown", index: true },
    mode: { type: String, trim: true, default: "", index: true },
    subscriptionType: { type: String, enum: ["free", "premium", "unknown"], default: "unknown", index: true },
    deviceId: { type: String, default: "" },
    appVersion: { type: String, default: "" },
    enabled: { type: Boolean, default: true, index: true },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    lastUpdated: { type: Date, default: Date.now, index: true },
  },
  baseJsonOptions,
);

pushDeviceTokenSchema.index({ userId: 1, platform: 1 });

export const PushDeviceToken = models.PushDeviceToken || model("PushDeviceToken", pushDeviceTokenSchema);
