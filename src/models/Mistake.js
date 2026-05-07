import { Schema, model, models, baseJsonOptions } from "./base.js";

const mistakeSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    questionId: { type: String, required: true, index: true },
    status: { type: String, enum: ["new", "improving", "weak"], default: "new" },
    attempts: { type: Number, default: 1 },
    lastAttemptDate: { type: Date, default: Date.now },
  },
  baseJsonOptions,
);

mistakeSchema.index({ userId: 1, questionId: 1 }, { unique: true });

export const Mistake = models.Mistake || model("Mistake", mistakeSchema);
