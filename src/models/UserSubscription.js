import { Schema, model, models, baseJsonOptions } from "./base.js";

const userSubscriptionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true, index: true },
    originalTransactionId: { type: String, required: true, unique: true, index: true },
    receiptData: { type: String, select: false },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true, index: true },
    subscriptionStatus: {
      type: String,
      enum: ["active", "expired", "cancelled", "failed", "refunded"],
      index: true,
    },
    autoRenewStatus: { type: Boolean, default: true },
    platform: { type: String, enum: ["ios"], default: "ios", index: true },
    latestWebhookEvent: { type: Schema.Types.Mixed },
    environment: { type: String, enum: ["Production", "Sandbox"] },
  },
  baseJsonOptions,
);

export const UserSubscription =
  models.UserSubscription || model("UserSubscription", userSubscriptionSchema);
