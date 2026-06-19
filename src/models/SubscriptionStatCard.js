import { Schema, model, models, baseJsonOptions } from "./base.js";

const subscriptionStatCardSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    label: { type: String, required: true, trim: true },
    valueType: { type: String, enum: ["number", "text"], default: "number", index: true },
    valueMode: { type: String, enum: ["manual", "live"], default: "manual", index: true },
    manualValue: { type: Number, min: 0, default: 0 },
    manualText: { type: String, trim: true, default: "" },
    liveSource: { type: String, enum: ["users", "premiumUsers", "subscriptions"], default: "users" },
    suffix: { type: String, trim: true, default: "" },
    iconKey: { type: String, enum: ["users", "shield", "zap"], default: "users" },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 1 },
  },
  baseJsonOptions,
);

export const SubscriptionStatCard =
  models.SubscriptionStatCard || model("SubscriptionStatCard", subscriptionStatCardSchema);
