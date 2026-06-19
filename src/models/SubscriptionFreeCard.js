import { Schema, model, models, baseJsonOptions } from "./base.js";

const subscriptionFreeCardSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, trim: true, default: "" },
    items: [{ type: String, trim: true }],
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 1 },
  },
  baseJsonOptions,
);

export const SubscriptionFreeCard =
  models.SubscriptionFreeCard || model("SubscriptionFreeCard", subscriptionFreeCardSchema);
