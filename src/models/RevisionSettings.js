import { Schema, model, models, baseJsonOptions } from "./base.js";

const revisionSettingsSchema = new Schema(
  {
    wrongQuestionLimit: { type: Number, default: 10, min: 1, max: 100 },
    oldQuestionLimit: { type: Number, default: 5, min: 1, max: 100 },
    revisionEnabled: { type: Boolean, default: true },
    spacedDays: {
      type: [Number],
      default: [1, 2, 5, 10],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0 && value.every((day) => Number.isFinite(day) && day > 0),
        message: "spacedDays must contain one or more positive numbers",
      },
    },
  },
  baseJsonOptions,
);

export const RevisionSettings = models.RevisionSettings || model("RevisionSettings", revisionSettingsSchema);

