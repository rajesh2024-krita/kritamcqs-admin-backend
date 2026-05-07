import { Schema, model, models, baseJsonOptions } from "./base.js";
import { EXAM_MODES } from "../types/constants.js";

const modeSchema = new Schema(
  {
    key: { type: String, enum: EXAM_MODES, required: true, unique: true, index: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
  },
  baseJsonOptions,
);

export const Mode = models.Mode || model("Mode", modeSchema);
