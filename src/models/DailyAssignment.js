import { Schema, model, models, baseJsonOptions } from "./base.js";

const dailyAssignmentSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    modeId: { type: String, required: true },
    modeKey: { type: String, enum: ["NEET", "JEE", "BOTH"], required: true },
    questionIds: { type: [String], default: [] },
    assignedCount: { type: Number, default: 0 },
    completedQuestionIds: { type: [String], default: [] },
    completedCount: { type: Number, default: 0 },
    source: { type: String, enum: ["daily_set"], default: "daily_set" },
  },
  baseJsonOptions,
);

dailyAssignmentSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export const DailyAssignment = models.DailyAssignment || model("DailyAssignment", dailyAssignmentSchema);
