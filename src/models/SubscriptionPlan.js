import { Schema, model, models, baseJsonOptions } from "./base.js";

const subscriptionPlanSchema = new Schema(
  {
    planId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    strikeOutAmount: { type: Number, min: 0, default: 0 },
    durationMonths: { type: Number, required: true, min: 1 },
    description: { type: String, trim: true, default: "" },
    savings: { type: String, trim: true },
    features: [{ type: String, trim: true }],
    active: { type: Boolean, default: true, index: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    sortOrder: { type: Number, default: 1 },
  },
  baseJsonOptions,
);

subscriptionPlanSchema.pre("validate", function syncStatus(next) {
  if (this.status) this.active = this.status === "active";
  else this.status = this.active === false ? "inactive" : "active";
  next();
});

export const SubscriptionPlan = models.SubscriptionPlan || model("SubscriptionPlan", subscriptionPlanSchema);
