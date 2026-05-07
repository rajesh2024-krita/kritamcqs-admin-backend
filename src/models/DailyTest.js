import { Schema, model, models, baseJsonOptions } from "./base.js";

const dailyTestSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    testDate: { type: Date, required: true, index: true },
    questionIds: { type: [String], default: [] },
    totalQuestions: { type: Number, default: 20 },
    completed: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
  },
  {
    ...baseJsonOptions,
    collection: "DailyTests",
  },
);

dailyTestSchema.index({ userId: 1, testDate: 1 }, { unique: true });

export const DailyTest = models.DailyTest || model("DailyTest", dailyTestSchema);

