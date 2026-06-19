import { Schema, model, models, baseJsonOptions } from "./base.js";

const appUsageSettingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    enabled: { type: Boolean, default: false, index: true },
  },
  baseJsonOptions,
);

export const AppUsageSettings = models.AppUsageSettings || model("AppUsageSettings", appUsageSettingsSchema);
