import { Schema, model, models, baseJsonOptions } from "./base.js";
import { EXAM_TYPES } from "../types/constants.js";

const subjectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    examType: { type: String, enum: EXAM_TYPES, required: true, index: true },
    icon: { type: String, trim: true },
    iconUrl: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
    color: { type: String, trim: true },
  },
  baseJsonOptions,
);

subjectSchema.index({ name: 1, examType: 1 }, { unique: true });

export const Subject = models.Subject || model("Subject", subjectSchema);
