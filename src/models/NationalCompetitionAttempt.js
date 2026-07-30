import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalCompetitionAttemptSchema = new Schema(
  {
    competitionId: { type: String, required: true, index: true },
    registrationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ["not_started", "in_progress", "submitted", "auto_submitted", "disqualified"], default: "not_started", index: true },
    answers: { type: [Schema.Types.Mixed], default: [] },
    score: { type: Number, default: 0, index: true },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    negativeMarksApplied: { type: Number, default: 0 },
    totalTimeSeconds: { type: Number, default: 0 },
    averageTimePerQuestion: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    startedAt: { type: Date },
    submittedAt: { type: Date, index: true },
    autoSubmittedAt: { type: Date },
    lastAutosavedAt: { type: Date },
    deviceId: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    suspiciousFlags: { type: [String], default: [] },
  },
  { ...baseJsonOptions, collection: "NationalCompetitionAttempts" },
);

nationalCompetitionAttemptSchema.index({ competitionId: 1, userId: 1 }, { unique: true });

export const NationalCompetitionAttempt = models.NationalCompetitionAttempt || model("NationalCompetitionAttempt", nationalCompetitionAttemptSchema);
