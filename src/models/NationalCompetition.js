import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalCompetitionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, index: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    examType: { type: String, enum: ["NEET", "JEE", "BOTH"], default: "BOTH", index: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "registration_open", "registration_closed", "live", "completed", "archived", "cancelled"],
      default: "draft",
      index: true,
    },
    registrationOpensAt: { type: Date, required: true, index: true },
    registrationClosesAt: { type: Date, required: true, index: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 180, min: 1 },
    totalQuestions: { type: Number, default: 180, min: 1 },
    marksPerQuestion: { type: Number, default: 4 },
    negativeMarks: { type: Number, default: 1 },
    questionIds: { type: [String], default: [] },
    rules: { type: [String], default: [] },
    rewardsSummary: { type: String, default: "" },
    terms: { type: String, default: "" },
    eligibility: {
      premiumRequired: { type: Boolean, default: false },
      allowedStates: { type: [String], default: [] },
      allowedDistricts: { type: [String], default: [] },
      participantLimit: { type: Number, default: 0 },
      approvalRequired: { type: Boolean, default: false },
    },
    leaderboard: {
      enabled: { type: Boolean, default: true },
      refreshSeconds: { type: Number, default: 30, min: 5 },
      rankingPriority: {
        type: [String],
        default: ["marks", "negativeMarks", "totalTime", "averageTimePerQuestion", "accuracy", "submissionTime", "attendance"],
      },
      rankingWeights: { type: Map, of: Number, default: {} },
      publishWeekly: { type: Boolean, default: true },
      publishMonthly: { type: Boolean, default: true },
    },
    security: {
      oneAttemptOnly: { type: Boolean, default: true },
      deviceValidation: { type: Boolean, default: true },
      duplicateLoginDetection: { type: Boolean, default: true },
      autosaveIntervalSeconds: { type: Number, default: 20, min: 5 },
    },
    notificationEvents: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { ...baseJsonOptions, collection: "NationalCompetitions" },
);

nationalCompetitionSchema.index({ status: 1, startsAt: 1 });
nationalCompetitionSchema.index({ examType: 1, isActive: 1, startsAt: 1 });

export const NationalCompetition = models.NationalCompetition || model("NationalCompetition", nationalCompetitionSchema);
