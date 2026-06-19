import { Schema, model, models, baseJsonOptions } from "./base.js";

const explanationPreviewTemplateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, default: "default" },
    name: { type: String, required: true, trim: true, default: "Default Explanation Preview" },
    layout: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["draft", "published"], default: "published", index: true },
    publishedAt: { type: Date },
  },
  baseJsonOptions,
);

export const ExplanationPreviewTemplate =
  models.ExplanationPreviewTemplate || model("ExplanationPreviewTemplate", explanationPreviewTemplateSchema);
