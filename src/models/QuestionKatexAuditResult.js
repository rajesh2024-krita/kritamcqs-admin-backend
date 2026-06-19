import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const katexIssueSchema = new Schema(
  {
    field: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true, index: true },
    severity: { type: String, enum: ["warning", "error"], default: "warning", index: true },
    message: { type: String, required: true, trim: true },
    snippet: { type: String, trim: true, default: "" },
    suggestion: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const questionKatexAuditResultSchema = new Schema(
  {
    questionId: { type: Types.ObjectId, ref: "Question", required: true, unique: true, index: true },
    subjectId: { type: Types.ObjectId, ref: "Subject", index: true },
    chapterId: { type: Types.ObjectId, ref: "Chapter", index: true },
    topicId: { type: Types.ObjectId, ref: "Topic", index: true },
    questionTypeId: { type: Types.ObjectId, ref: "QuestionType", index: true },
    status: { type: String, enum: ["PASS", "KATEX_ISSUE", "WARNING", "FAILED"], default: "PASS", index: true },
    confidence: { type: Number, default: 100, min: 0, max: 100, index: true },
    errorCount: { type: Number, default: 0 },
    warningCount: { type: Number, default: 0 },
    issueCount: { type: Number, default: 0, index: true },
    reviewed: { type: Boolean, default: false, index: true },
    reviewedBy: { type: Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    lastScannedAt: { type: Date, default: Date.now, index: true },
    autoFixAvailable: { type: Boolean, default: false, index: true },
    autoFixAppliedAt: { type: Date },
    preview: { type: String, trim: true, default: "" },
    issues: { type: [katexIssueSchema], default: [] },
    fixedFields: { type: Schema.Types.Mixed, default: {} },
    scanVersion: { type: String, default: "katex-audit-v1" },
  },
  baseJsonOptions,
);

questionKatexAuditResultSchema.index({ status: 1, reviewed: 1, confidence: 1 });
questionKatexAuditResultSchema.index({ subjectId: 1, chapterId: 1, topicId: 1, questionTypeId: 1 });

export const QuestionKatexAuditResult =
  models.QuestionKatexAuditResult || model("QuestionKatexAuditResult", questionKatexAuditResultSchema);
