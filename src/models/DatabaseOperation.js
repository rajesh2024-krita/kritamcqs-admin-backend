import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

const databaseOperationSchema = new Schema(
  {
    kind: { type: String, enum: ["backup", "restore"], required: true, index: true },
    backupType: { type: String, enum: ["automatic", "manual", "safety"], index: true },
    status: { type: String, enum: ["in_progress", "completed", "failed"], required: true, index: true },
    startedAt: { type: Date, required: true },
    completedAt: Date,
    durationMs: Number,
    sizeBytes: Number,
    fileName: String,
    filePath: String,
    sourceBackupId: { type: Types.ObjectId, ref: "DatabaseOperation" },
    safetyBackupId: { type: Types.ObjectId, ref: "DatabaseOperation" },
    createdById: { type: Types.ObjectId, ref: "User" },
    createdByName: String,
    errorDetails: String,
    eventMessage: String,
  },
  baseJsonOptions,
);

databaseOperationSchema.index({ startedAt: -1 });
databaseOperationSchema.index({ status: 1, kind: 1 });

export const DatabaseOperation = models.DatabaseOperation || model("DatabaseOperation", databaseOperationSchema);
