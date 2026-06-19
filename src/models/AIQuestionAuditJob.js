import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const aiQuestionAuditJobSchema = new Schema(
  {
    provider: { type: String, trim: true, required: true },
    model: { type: String, trim: true, required: true },
    status: { type: String, enum: ["queued", "processing", "completed", "failed"], default: "queued", index: true },
    total: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    issuesFound: { type: Number, default: 0 },
    questionIds: { type: [Types.ObjectId], default: [] },
    errorMessage: { type: String, trim: true, default: "" },
    startedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

export const AIQuestionAuditJob = models.AIQuestionAuditJob || model("AIQuestionAuditJob", aiQuestionAuditJobSchema);
