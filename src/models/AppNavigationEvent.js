import { Schema, model, models, baseJsonOptions } from "./base.js";

const appNavigationEventSchema = new Schema(
  {
    userId: { type: String, index: true },
    path: { type: String, required: true, trim: true, index: true },
    title: { type: String, trim: true, default: "" },
    durationSeconds: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date },
    endedAt: { type: Date },
    platform: { type: String, trim: true, default: "" },
  },
  baseJsonOptions,
);

appNavigationEventSchema.index({ path: 1, createdAt: -1 });

export const AppNavigationEvent = models.AppNavigationEvent || model("AppNavigationEvent", appNavigationEventSchema);
