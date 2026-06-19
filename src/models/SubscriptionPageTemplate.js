import { Schema, model, models, baseJsonOptions } from "./base.js";

const builderBlockSchema = new Schema(
  {
    id: { type: String, trim: true },
    type: { type: String, required: true, trim: true },
    props: { type: Schema.Types.Mixed, default: {} },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const subscriptionPageTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true, index: true },
    description: { type: String, trim: true, default: "" },
    blocks: { type: [builderBlockSchema], default: [] },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    isDefault: { type: Boolean, default: false },
    publishedAt: { type: Date },
  },
  baseJsonOptions,
);

subscriptionPageTemplateSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: "published" } },
);

export const SubscriptionPageTemplate =
  models.SubscriptionPageTemplate || model("SubscriptionPageTemplate", subscriptionPageTemplateSchema);
