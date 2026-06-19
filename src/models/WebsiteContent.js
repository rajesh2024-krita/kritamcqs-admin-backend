import { Schema, model, models, baseJsonOptions } from "./base.js";

const websiteContentSchema = new Schema(
  {
    key: { type: String, default: "landing", unique: true, index: true },
    content: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["draft", "published"], default: "published", index: true },
    updatedById: { type: Schema.Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

export const WebsiteContent = models.WebsiteContent || model("WebsiteContent", websiteContentSchema);
