import { Schema, model, models, baseJsonOptions } from "./base.js";

const mistakeSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    questionId: { type: String, required: true, index: true },
    status: { type: String, enum: ["new", "improving", "weak"], default: "new" },
    attempts: { type: Number, default: 1 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 1 },
    accuracy: { type: Number, default: 0 },
    previousAccuracy: { type: Number, default: 0 },
    improvementPercentage: { type: Number, default: 0 },
    completionStatus: { type: String, enum: ["in_progress", "completed"], default: "in_progress", index: true },
    mode: { type: String, trim: true, index: true },
    subjectId: String,
    chapterId: String,
    topicId: String,
    category: { type: String, trim: true, index: true },
    difficulty: { type: String, trim: true, index: true },
    selectedOption: String,
    selectedOptions: { type: [String], default: [] },
    numericAnswer: String,
    lastAttemptDate: { type: Date, default: Date.now },
  },
  baseJsonOptions,
);

mistakeSchema.index({ userId: 1, questionId: 1 }, { unique: true });

export const Mistake = models.Mistake || model("Mistake", mistakeSchema);
