import { Schema, model, models, baseJsonOptions } from "./base.js";

const cmsPageSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    metaTitle: { type: String, trim: true, default: "" },
    metaDescription: { type: String, trim: true, default: "" },
    seoKeywords: { type: String, trim: true, default: "" },
    ogTitle: { type: String, trim: true, default: "" },
    ogDescription: { type: String, trim: true, default: "" },
    ogImage: { type: String, trim: true, default: "" },
    canonicalUrl: { type: String, trim: true, default: "" },
    noIndex: { type: Boolean, default: false },
    featuredImage: { type: String, trim: true, default: "" },
    menuName: { type: String, trim: true, default: "" },
    parentMenu: { type: String, trim: true, default: "" },
    html: { type: String, default: "" },
    css: { type: String, default: "" },
    scripts: { type: String, default: "" },
    status: { type: String, enum: ["draft", "published"], default: "draft", index: true },
    active: { type: Boolean, default: true, index: true },
    showInMenu: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 1 },
    scheduledPublishAt: { type: Date },
    publishedAt: { type: Date },
    deletedAt: { type: Date },
  },
  baseJsonOptions,
);

export const CmsPage = models.CmsPage || model("CmsPage", cmsPageSchema);
