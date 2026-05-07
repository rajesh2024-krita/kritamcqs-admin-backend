import { Schema, model, models, baseJsonOptions } from "./base.js";

const migrationLogSchema = new Schema(
  {
    totalUsers: { type: Number, required: true, default: 0 },
    importedUsers: { type: Number, required: true, default: 0 },
    duplicateUsers: { type: Number, required: true, default: 0 },
    invalidUsers: { type: Number, required: true, default: 0 },
    migrationDate: { type: Date, required: true, default: Date.now, index: true },
  },
  baseJsonOptions,
);

export const MigrationLog = models.MigrationLog || model("MigrationLog", migrationLogSchema);
