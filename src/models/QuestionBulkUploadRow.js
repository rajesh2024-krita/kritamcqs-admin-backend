import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const questionBulkUploadRowSchema = new Schema(
  {
    batchId: { type: Types.ObjectId, ref: "QuestionBulkUploadBatch", required: true, index: true },
    rowNumber: { type: Number, required: true },
    raw: { type: Schema.Types.Mixed, default: {} },
    payload: { type: Schema.Types.Mixed, default: {} },
    question: { type: String, trim: true },
    status: { type: String, enum: ["valid", "warning", "invalid", "processing", "approved", "failed", "duplicate", "skipped"], required: true, index: true },
    errorMessage: { type: String, trim: true, default: "" },
    duplicateKey: { type: String, trim: true, default: "" },
    imageCount: { type: Number, default: 0 },
    uploadedImageCount: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    uploadedQuestionId: { type: Types.ObjectId, ref: "Question" },
  },
  baseJsonOptions,
);

questionBulkUploadRowSchema.index({ batchId: 1, rowNumber: 1 }, { unique: true });
questionBulkUploadRowSchema.index({ batchId: 1, status: 1 });

export const QuestionBulkUploadRow =
  models.QuestionBulkUploadRow || model("QuestionBulkUploadRow", questionBulkUploadRowSchema);
