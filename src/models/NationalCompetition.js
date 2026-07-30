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
    questionSelection: {
      mode: { type: String, enum: ["manual", "automatic"], default: "manual" },
      filters: { type: Schema.Types.Mixed, default: {} },
      targetCount: { type: Number, default: 0 },
      lastGeneratedAt: { type: Date },
    },
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
    isPublished: { type: Boolean, default: false, index: true },
    isEnabled: { type: Boolean, default: false, index: true },
    banner: {
      enabled: { type: Boolean, default: true },
      testName: { type: String, default: "" },
      backgroundImageUrl: { type: String, default: "" },
      backgroundColor: { type: String, default: "#4f21d8" },
      overlayColor: { type: String, default: "rgba(42,19,143,0.42)" },
      textColor: { type: String, default: "#ffffff" },
      countdownEnabled: { type: Boolean, default: true },
      ctaText: { type: String, default: "View Details" },
      buttonColor: { type: String, default: "#ffffff" },
      buttonTextColor: { type: String, default: "#3b159f" },
      buttonAction: { type: String, enum: ["register", "view_details", "join_test"], default: "view_details" },
    },
    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { ...baseJsonOptions, collection: "NationalCompetitions" },
);

nationalCompetitionSchema.index({ status: 1, startsAt: 1 });
nationalCompetitionSchema.index({ examType: 1, isActive: 1, isPublished: 1, isEnabled: 1, startsAt: 1 });

export const NationalCompetition = models.NationalCompetition || model("NationalCompetition", nationalCompetitionSchema);
