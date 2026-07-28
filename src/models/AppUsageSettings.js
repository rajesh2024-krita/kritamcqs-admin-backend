import { Schema, model, models, baseJsonOptions } from "./base.js";

const appUsageSettingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    enabled: { type: Boolean, default: false, index: true },
    automaticCleanupEnabled: { type: Boolean, default: false },
    retentionDays: { type: Number, default: 90, min: 1, max: 365 },
    retentionNeverDelete: { type: Boolean, default: false },
    sessionTimeoutMinutes: { type: Number, default: 30, min: 5, max: 240 },
  },
  baseJsonOptions,
);

export const AppUsageSettings = models.AppUsageSettings || model("AppUsageSettings", appUsageSettingsSchema);
