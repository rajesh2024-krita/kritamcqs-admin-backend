import { Schema, model, models, baseJsonOptions } from "./base.js";

const subscriptionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    couponCode: { type: String, trim: true, uppercase: true },
    couponType: { type: String, enum: ["amount", "percent"] },
    couponValue: Number,
    baseAmount: Number,
    discountAmount: Number,
    amount: { type: Number, required: true },
    status: { type: String, required: true },
    startDate: Date,
    endDate: Date,
  },
  baseJsonOptions,
);

subscriptionSchema.index({ userId: 1, createdAt: -1 });

export const Subscription = models.Subscription || model("Subscription", subscriptionSchema);
