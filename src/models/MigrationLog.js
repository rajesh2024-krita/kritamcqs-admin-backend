import { Schema, model, models, baseJsonOptions } from "./base.js";

const migrationLogSchema = new Schema(
  {
    totalUsers: { type: Number, required: true, default: 0 },
    importedUsers: { type: Number, required: true, default: 0 },
    duplicateUsers: { type: Number, required: true, default: 0 },
    invalidUsers: { type: Number, required: true, default: 0 },
    failedRows: {
      type: [
        {
          row: Number,
          name: String,
          mobile: String,
          email: String,
          reason: String,
        },
      ],
      default: [],
    },
    migrationDate: { type: Date, required: true, default: Date.now, index: true },
  },
  baseJsonOptions,
);

export const MigrationLog = models.MigrationLog || model("MigrationLog", migrationLogSchema);
