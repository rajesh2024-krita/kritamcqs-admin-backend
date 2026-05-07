import { Schema, model, models, baseJsonOptions } from "./base.js";
import { EXAM_TYPES } from "../types/constants.js";

const yearSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    examType: { type: String, enum: EXAM_TYPES, index: true },
  },
  baseJsonOptions,
);

yearSchema.index({ name: 1, examType: 1 }, { unique: true });

export const Year = models.Year || model("Year", yearSchema);
