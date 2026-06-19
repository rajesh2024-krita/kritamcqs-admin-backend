import { Schema, model, models, baseJsonOptions } from "./base.js";

const dailyTestAnalyticsSchema = new Schema(
  {
    totalAttempts: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    topPerformingUsers: {
      type: [
        {
          userId: { type: String, required: true },
          name: { type: String, default: "" },
          email: { type: String, default: "" },
          avgScore: { type: Number, default: 0 },
          avgAccuracy: { type: Number, default: 0 },
          attempts: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
  },
  baseJsonOptions,
);

dailyTestAnalyticsSchema.index({ updatedAt: -1 });

export const DailyTestAnalytics = models.DailyTestAnalytics || model("DailyTestAnalytics", dailyTestAnalyticsSchema);

