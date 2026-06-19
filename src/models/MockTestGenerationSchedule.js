import { Schema, model, models, baseJsonOptions } from "./base.js";

const mockTestGenerationScheduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: false, index: true },
    recurrenceType: { type: String, enum: ["daily", "weekly", "monthly"], default: "weekly" },
    weeklyDays: { type: [String], default: ["FRI"] },
    monthlyDay: { type: Number, default: 1, min: 1, max: 31 },
    generationTime: { type: String, default: "09:00" },
    timezone: { type: String, default: "local" },
    examType: { type: String, enum: ["NEET", "JEE"], default: "NEET" },
    subjectIds: { type: [String], default: [] },
    chapterIds: { type: [String], default: [] },
    difficulty: { type: String, default: "mixed" },
    questionCount: { type: Number, default: 0, min: 0, max: 300 },
    unusedQuestionPercentage: { type: Number, default: 100, min: 0, max: 100 },
    incorrectQuestionPercentage: { type: Number, default: 0, min: 0, max: 100 },
    usedQuestionPercentage: { type: Number, default: 0, min: 0, max: 100 },
    includedQuestionIds: { type: [String], default: [] },
    titlePrefix: { type: String, default: "Premium Auto Mock", trim: true },
    lastRunKey: { type: String, default: "" },
    lastRunAt: { type: Date },
  },
  baseJsonOptions,
);

export const MockTestGenerationSchedule =
  models.MockTestGenerationSchedule || model("MockTestGenerationSchedule", mockTestGenerationScheduleSchema);
