import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const learningSessionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", index: true },
    origin: { type: String, trim: true },
    type: { type: String, trim: true },
    title: { type: String, trim: true },
  },
  baseJsonOptions,
);

export const LearningSession = models.LearningSession || model("LearningSession", learningSessionSchema);
