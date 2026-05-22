import { Schema, model, models, baseJsonOptions } from "./base.js";

const dailyTestSettingsSchema = new Schema(
  {
    totalQuestions: { type: Number, default: 20, min: 1, max: 200 },
    newQuestions: { type: Number, default: 10, min: 0, max: 200 },
    weakQuestions: { type: Number, default: 5, min: 0, max: 200 },
    revisionQuestions: { type: Number, default: 5, min: 0, max: 200 },
    easyPercentage: { type: Number, default: 30, min: 0, max: 100 },
    moderatePercentage: { type: Number, default: 40, min: 0, max: 100 },
    hardPercentage: { type: Number, default: 30, min: 0, max: 100 },
    enabled: { type: Boolean, default: true },
    examType: { type: String, enum: ["NEET", "JEE", "BOTH"], default: "BOTH", index: true },
    adaptiveModeEnabled: { type: Boolean, default: true },
    repeatLookbackSessions: { type: Number, default: 5, min: 1, max: 30 },
    maxRepeatedQuestions: { type: Number, default: 2, min: 0, max: 200 },
    lowPerformanceRatio: {
      easy: { type: Number, default: 70, min: 0, max: 100 },
      moderate: { type: Number, default: 20, min: 0, max: 100 },
      hard: { type: Number, default: 10, min: 0, max: 100 },
    },
    mediumPerformanceRatio: {
      easy: { type: Number, default: 40, min: 0, max: 100 },
      moderate: { type: Number, default: 40, min: 0, max: 100 },
      hard: { type: Number, default: 20, min: 0, max: 100 },
    },
    highPerformanceRatio: {
      easy: { type: Number, default: 15, min: 0, max: 100 },
      moderate: { type: Number, default: 45, min: 0, max: 100 },
      hard: { type: Number, default: 40, min: 0, max: 100 },
    },
    mixedModeRatio: {
      easy: { type: Number, default: 34, min: 0, max: 100 },
      moderate: { type: Number, default: 33, min: 0, max: 100 },
      hard: { type: Number, default: 33, min: 0, max: 100 },
    },
  },
  baseJsonOptions,
);

dailyTestSettingsSchema.pre("validate", function validateDistribution(next) {
  const totalMix = Number(this.easyPercentage || 0) + Number(this.moderatePercentage || 0) + Number(this.hardPercentage || 0);
  const questionMix = Number(this.newQuestions || 0) + Number(this.weakQuestions || 0) + Number(this.revisionQuestions || 0);
  const adaptiveRatios = [this.lowPerformanceRatio, this.mediumPerformanceRatio, this.highPerformanceRatio, this.mixedModeRatio];

  if (totalMix !== 100) {
    return next(new Error("Difficulty percentage must total 100"));
  }

  if (questionMix !== Number(this.totalQuestions || 0)) {
    return next(new Error("New, weak, and revision counts must equal total questions"));
  }
  for (const ratio of adaptiveRatios) {
    const total = Number(ratio?.easy || 0) + Number(ratio?.moderate || 0) + Number(ratio?.hard || 0);
    if (total !== 100) {
      return next(new Error("Adaptive difficulty ratio groups must each total 100"));
    }
  }

  return next();
});

export const DailyTestSettings = models.DailyTestSettings || model("DailyTestSettings", dailyTestSettingsSchema);
