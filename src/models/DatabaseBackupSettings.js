import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

const databaseBackupSettingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, immutable: true },
    automaticEnabled: { type: Boolean, required: true },
    backupHourUtc: { type: Number, min: 0, max: 23, required: true },
    updatedById: { type: Types.ObjectId, ref: "User" },
    updatedByName: String,
  },
  baseJsonOptions,
);

export const DatabaseBackupSettings = models.DatabaseBackupSettings || model("DatabaseBackupSettings", databaseBackupSettingsSchema);
