import { Schema, model, models, baseJsonOptions } from "./base.js";

const subscriptionPlanSchema = new Schema(
  {
    planId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    durationMonths: { type: Number, required: true, min: 1 },
    savings: { type: String, trim: true },
    features: [{ type: String, trim: true }],
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 1 },
  },
  baseJsonOptions,
);

export const SubscriptionPlan = models.SubscriptionPlan || model("SubscriptionPlan", subscriptionPlanSchema);
