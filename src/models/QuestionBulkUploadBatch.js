import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const questionBulkUploadBatchSchema = new Schema(
  {
    fileName: { type: String, required: true, trim: true },
    uploadedBy: { type: Types.ObjectId, ref: "User", index: true },
    status: { type: String, enum: ["pending", "categories_created", "approved", "failed"], default: "pending", index: true },
    totalRows: { type: Number, default: 0 },
    validCount: { type: Number, default: 0 },
    invalidCount: { type: Number, default: 0 },
    missingCategoriesCount: { type: Number, default: 0 },
    insertedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
  },
  baseJsonOptions,
);

questionBulkUploadBatchSchema.index({ createdAt: -1 });

export const QuestionBulkUploadBatch =
  models.QuestionBulkUploadBatch || model("QuestionBulkUploadBatch", questionBulkUploadBatchSchema);
