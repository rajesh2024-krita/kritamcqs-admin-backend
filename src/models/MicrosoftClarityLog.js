import { Schema, model, models, baseJsonOptions } from "./base.js";

export const clarityStatuses = [
  "Initializing",
  "Connected",
  "Waiting for Data",
  "Uploading",
  "Recording",
  "Disabled",
  "Initialization Failed",
  "Plugin Missing",
  "Project ID Invalid",
  "Internet Unavailable",
  "Native Error",
];

const microsoftClarityLogSchema = new Schema(
  {
    deviceId: { type: String, trim: true, default: "", index: true },
    platform: { type: String, trim: true, default: "", index: true },
    appVersion: { type: String, trim: true, default: "", index: true },
    projectId: { type: String, trim: true, default: "", index: true },
    status: { type: String, enum: clarityStatuses, default: "Initializing", index: true },
    level: { type: String, enum: ["success", "warning", "error", "info"], default: "info", index: true },
    message: { type: String, trim: true, default: "" },
    sessionId: { type: String, trim: true, default: "", index: true },
    sdkVersion: { type: String, trim: true, default: "" },
    pluginVersion: { type: String, trim: true, default: "" },
    capacitorVersion: { type: String, trim: true, default: "" },
    sdkStatus: { type: String, trim: true, default: "" },
    errorMessage: { type: String, trim: true, default: "" },
    stack: { type: String, trim: true, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
    lastHeartbeatAt: { type: Date, index: true },
    lastUploadAt: { type: Date, index: true },
  },
  baseJsonOptions,
);

microsoftClarityLogSchema.index({ status: 1, timestamp: -1 });
microsoftClarityLogSchema.index({ deviceId: 1, timestamp: -1 });

export const MicrosoftClarityLog =
  models.MicrosoftClarityLog || model("MicrosoftClarityLog", microsoftClarityLogSchema);
