import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const aiSuggestedFixSchema = new Schema(
  {
    field: { type: String, trim: true, required: true },
    oldValue: { type: String, default: "" },
    newValue: { type: String, default: "" },
  },
  { _id: false },
);

const aiQuestionAuditFindingSchema = new Schema(
  {
    questionId: { type: Types.ObjectId, ref: "Question", required: true, index: true },
    jobId: { type: Types.ObjectId, ref: "AIQuestionAuditJob", index: true },
    provider: { type: String, trim: true, required: true, index: true },
    model: { type: String, trim: true, required: true, index: true },
    auditStatus: { type: String, enum: ["PASS", "KATEX_ISSUE", "MINOR_ISSUE", "ANSWER_MISMATCH", "EXPLANATION_MISMATCH", "QUESTION_ERROR", "CRITICAL"], default: "KATEX_ISSUE", index: true },
    confidence: { type: Number, default: 0, min: 0, max: 100, index: true },
    issueType: { type: String, enum: ["formula", "answer", "explanation", "ocr", "katex", "grammar", "option", "science"], required: true, index: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium", index: true },
    description: { type: String, trim: true, required: true },
    field: { type: String, trim: true, default: "question" },
    oldValue: { type: String, default: "" },
    suggestedValue: { type: String, default: "" },
    suggestedFixes: { type: [aiSuggestedFixSchema], default: [] },
    status: { type: String, enum: ["pending", "approved", "rejected", "applied", "rolled_back"], default: "pending", index: true },
    rawResponse: { type: Schema.Types.Mixed, default: {} },
    fixedAt: { type: Date },
    fixedBy: { type: Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

aiQuestionAuditFindingSchema.index({ issueType: 1, severity: 1, status: 1 });

export const AIQuestionAuditFinding =
  models.AIQuestionAuditFinding || model("AIQuestionAuditFinding", aiQuestionAuditFindingSchema);
