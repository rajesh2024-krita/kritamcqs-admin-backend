import { Schema, model, models, baseJsonOptions } from "./base.js";

const sessionAttemptSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    sourceSessionId: { type: String, index: true },
    attemptNumber: { type: Number, required: true },
    score: Number,
    accuracy: Number,
    timeTaken: Number,
    correctCount: Number,
    incorrectCount: Number,
    skippedCount: Number,
    totalQuestions: { type: Number, required: true },
    answersJson: Schema.Types.Mixed,
    topicBreakdownJson: Schema.Types.Mixed,
    comparisonJson: Schema.Types.Mixed,
    completedAt: Date,
  },
  baseJsonOptions,
);

sessionAttemptSchema.index({ userId: 1, sourceSessionId: 1, createdAt: -1 });

export const SessionAttempt = models.SessionAttempt || model("SessionAttempt", sessionAttemptSchema);
