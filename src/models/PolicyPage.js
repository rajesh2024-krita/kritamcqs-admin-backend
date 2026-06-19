import { Schema, model, models, baseJsonOptions } from "./base.js";

export const POLICY_TYPES = ["privacy", "terms", "refund", "cancellation", "shipping", "custom"];

const policyPageSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    type: { type: String, enum: POLICY_TYPES, default: "custom", index: true },
    seoTitle: { type: String, trim: true, default: "" },
    seoDescription: { type: String, trim: true, default: "" },
    seoKeywords: { type: String, trim: true, default: "" },
    ogTitle: { type: String, trim: true, default: "" },
    ogDescription: { type: String, trim: true, default: "" },
    ogImage: { type: String, trim: true, default: "" },
    canonicalUrl: { type: String, trim: true, default: "" },
    noIndex: { type: Boolean, default: false },
    html: { type: String, default: "" },
    css: { type: String, default: "" },
    status: { type: String, enum: ["draft", "published"], default: "draft", index: true },
    active: { type: Boolean, default: true, index: true },
    publishedAt: { type: Date },
    sortOrder: { type: Number, default: 1 },
  },
  baseJsonOptions,
);

export const PolicyPage = models.PolicyPage || model("PolicyPage", policyPageSchema);
