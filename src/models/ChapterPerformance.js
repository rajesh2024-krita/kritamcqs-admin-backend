import { Schema, model, models, baseJsonOptions } from "./base.js";

const chapterPerformanceSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    chapterId: { type: String, required: true },
    subjectId: { type: String, required: true },
    totalAttempts: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    isWeak: { type: Boolean, default: false },
    averageTimeSpent: { type: Number, default: 0 },
    strength: { type: String, enum: ["strong", "medium", "weak", "untested"], default: "untested" },
    lastPracticed: Date,
  },
  baseJsonOptions,
);

chapterPerformanceSchema.index({ userId: 1, chapterId: 1 }, { unique: true });

export const ChapterPerformance = models.ChapterPerformance || model("ChapterPerformance", chapterPerformanceSchema);
