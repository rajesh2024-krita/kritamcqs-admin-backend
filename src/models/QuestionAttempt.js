import { Schema, model, models, baseJsonOptions } from "./base.js";

const questionAttemptSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    sessionAttemptId: { type: String, required: true, index: true },
    questionId: { type: String, required: true, index: true },
    modeId: String,
    subjectId: { type: String, required: true },
    chapterId: { type: String, required: true },
    yearId: String,
    questionTypeId: String,
    isCorrect: { type: Boolean, required: true },
    selectedOption: String,
    selectedOptions: { type: [String], default: [] },
    numericAnswer: String,
    skipped: { type: Boolean, default: false },
    timeSpent: { type: Number, default: 0 },
  },
  baseJsonOptions,
);

questionAttemptSchema.index({ userId: 1, createdAt: -1 });
questionAttemptSchema.index({ userId: 1, questionId: 1, createdAt: -1 });

export const QuestionAttempt = models.QuestionAttempt || model("QuestionAttempt", questionAttemptSchema);
