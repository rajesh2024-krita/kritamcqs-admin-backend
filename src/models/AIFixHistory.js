import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const aiFixHistorySchema = new Schema(
  {
    questionId: { type: Types.ObjectId, ref: "Question", required: true, index: true },
    findingId: { type: Types.ObjectId, ref: "AIQuestionAuditFinding", index: true },
    field: { type: String, trim: true, required: true, index: true },
    oldValue: { type: String, default: "" },
    newValue: { type: String, default: "" },
    provider: { type: String, trim: true, required: true },
    model: { type: String, trim: true, required: true },
    appliedBy: { type: Types.ObjectId, ref: "User" },
    rolledBackAt: { type: Date },
    rolledBackBy: { type: Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

aiFixHistorySchema.index({ createdAt: -1 });

export const AIFixHistory = models.AIFixHistory || model("AIFixHistory", aiFixHistorySchema);
