import { Schema, model, models, baseJsonOptions } from "./base.js";

export const clarityLogLevels = ["None", "Error", "Warning", "Info", "Verbose"];

const microsoftClaritySettingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    enabled: { type: Boolean, default: false },
    projectId: { type: String, trim: true, default: "" },
    logLevel: { type: String, enum: clarityLogLevels, default: "None" },
  },
  baseJsonOptions,
);

export const MicrosoftClaritySettings =
  models.MicrosoftClaritySettings || model("MicrosoftClaritySettings", microsoftClaritySettingsSchema);
