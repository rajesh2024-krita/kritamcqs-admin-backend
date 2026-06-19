import { Schema, model, models, baseJsonOptions } from "./base.js";

const cmsMenuItemSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    pageSlug: { type: String, trim: true, default: "" },
    href: { type: String, trim: true, default: "" },
    linkType: { type: String, enum: ["page", "section", "external"], default: "page", index: true },
    parentId: { type: Schema.Types.ObjectId, ref: "CmsMenuItem" },
    area: { type: String, enum: ["navbar", "footer", "both"], default: "navbar", index: true },
    visible: { type: Boolean, default: true, index: true },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 1 },
  },
  baseJsonOptions,
);

export const CmsMenuItem = models.CmsMenuItem || model("CmsMenuItem", cmsMenuItemSchema);
