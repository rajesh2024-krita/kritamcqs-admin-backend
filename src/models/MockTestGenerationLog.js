import { Schema, model, models, baseJsonOptions } from "./base.js";

const mockTestGenerationLogSchema = new Schema(
  {
    generatedAt: { type: Date, default: Date.now, index: true },
    scheduleType: { type: String, enum: ["daily", "weekly", "monthly", "manual"], default: "manual", index: true },
    testName: { type: String, default: "", trim: true },
    mockTestId: { type: String, default: "" },
    status: { type: String, enum: ["success", "failed"], required: true, index: true },
    message: { type: String, default: "" },
    configSnapshot: { type: Schema.Types.Mixed },
  },
  baseJsonOptions,
);

export const MockTestGenerationLog =
  models.MockTestGenerationLog || model("MockTestGenerationLog", mockTestGenerationLogSchema);
