import { Schema, model, models, baseJsonOptions } from "./base.js";

const learningLevelSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  baseJsonOptions,
);

export const LearningLevel = models.LearningLevel || model("LearningLevel", learningLevelSchema);
