import { Schema, model, models, baseJsonOptions } from "./base.js";

const revisionAnalyticsSchema = new Schema(
  {
    totalAttempts: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
    topTopics: { type: [String], default: [] },
  },
  baseJsonOptions,
);

export const RevisionAnalytics = models.RevisionAnalytics || model("RevisionAnalytics", revisionAnalyticsSchema);

