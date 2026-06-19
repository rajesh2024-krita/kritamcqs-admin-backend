import { Schema, model, models, baseJsonOptions } from "./base.js";

const chapterPerformanceSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    chapterId: { type: String, required: true },
    subjectId: { type: String, required: true },
    topicId: { type: String, default: "" },
    totalAttempts: { type: Number, default: 0 },
    attemptCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    previousAccuracy: { type: Number, default: 0 },
    improvementPercentage: { type: Number, default: 0 },
    completionPercentage: { type: Number, default: 0 },
    masteryPercentage: { type: Number, default: 0 },
    isWeak: { type: Boolean, default: false },
    isMastered: { type: Boolean, default: false, index: true },
    examMode: { type: String, trim: true, index: true },
    topicIds: { type: [String], default: [] },
    incorrectQuestionIds: { type: [String], default: [] },
    weakQuestionIds: { type: [String], default: [] },
    lastTestStatus: { type: String, default: "" },
    sourceType: { type: String, default: "" },
    sourceName: { type: String, default: "" },
    sourceSessionId: { type: String, default: "" },
    completedAt: Date,
    averageTimeSpent: { type: Number, default: 0 },
    strength: { type: String, enum: ["strong", "medium", "weak", "untested"], default: "untested" },
    lastPracticed: Date,
  },
  baseJsonOptions,
);

chapterPerformanceSchema.index({ userId: 1, chapterId: 1 });
chapterPerformanceSchema.index({ userId: 1, chapterId: 1, topicId: 1 }, { unique: true });

export const ChapterPerformance = models.ChapterPerformance || model("ChapterPerformance", chapterPerformanceSchema);
