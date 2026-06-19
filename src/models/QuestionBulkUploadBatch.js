import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const questionBulkUploadBatchSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true },
    uploadedBy: { type: Types.ObjectId, ref: "User", index: true },
    uploadMode: { type: String, enum: ["upload", "update"], default: "upload", index: true },
    createMissingQuestions: { type: Boolean, default: false },
    updatedCount: { type: Number, default: 0 },
    status: { type: String, enum: ["pending", "validating", "validated", "categories_created", "processing", "approved", "failed"], default: "pending", index: true },
    totalRows: { type: Number, default: 0 },
    validCount: { type: Number, default: 0 },
    invalidCount: { type: Number, default: 0 },
    warningCount: { type: Number, default: 0 },
    missingCategoriesCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    imageCount: { type: Number, default: 0 },
    uploadedImageCount: { type: Number, default: 0 },
    insertedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    batchSize: { type: Number, default: 200 },
    currentBatch: { type: Number, default: 0 },
    totalBatches: { type: Number, default: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    createdSummary: { type: Schema.Types.Mixed, default: {} },
    imageSummary: { type: Schema.Types.Mixed, default: {} },
    newColumnUpdateSummary: { type: Schema.Types.Mixed, default: {} },
  },
  baseJsonOptions,
);

questionBulkUploadBatchSchema.index({ createdAt: -1 });

export const QuestionBulkUploadBatch =
  models.QuestionBulkUploadBatch || model("QuestionBulkUploadBatch", questionBulkUploadBatchSchema);
