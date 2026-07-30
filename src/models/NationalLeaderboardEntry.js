import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalLeaderboardEntrySchema = new Schema(
  {
    competitionId: { type: String, required: true, index: true },
    attemptId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: "Learner" },
    state: { type: String, default: "", index: true },
    district: { type: String, default: "", index: true },
    school: { type: String, default: "" },
    scope: { type: String, enum: ["national", "state", "district", "weekly", "monthly", "archived"], default: "national", index: true },
    periodKey: { type: String, default: "", index: true },
    rank: { type: Number, default: 0, index: true },
    score: { type: Number, default: 0 },
    negativeMarksApplied: { type: Number, default: 0 },
    totalTimeSeconds: { type: Number, default: 0 },
    averageTimePerQuestion: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    submittedAt: { type: Date },
    attendanceScore: { type: Number, default: 1 },
    tieBreakSnapshot: { type: Schema.Types.Mixed, default: {} },
  },
  { ...baseJsonOptions, collection: "NationalLeaderboardEntries" },
);

nationalLeaderboardEntrySchema.index({ competitionId: 1, scope: 1, periodKey: 1, rank: 1 });
nationalLeaderboardEntrySchema.index({ competitionId: 1, scope: 1, userId: 1 });

export const NationalLeaderboardEntry = models.NationalLeaderboardEntry || model("NationalLeaderboardEntry", nationalLeaderboardEntrySchema);
