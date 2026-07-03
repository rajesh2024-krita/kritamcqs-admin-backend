import { Schema, model, models, baseJsonOptions } from "./base.js";

const subscriptionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    platform: { type: String, enum: ["android", "ios"], default: "android", index: true },
    paymentProvider: { type: String, enum: ["razorpay", "apple"], default: "razorpay", index: true },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    razorpayPaidAmount: Number,
    razorpayFeeAmount: Number,
    razorpayTaxAmount: Number,
    appleProductId: { type: String, trim: true, index: true },
    appleTransactionId: { type: String, trim: true, index: true },
    appleOriginalTransactionId: { type: String, trim: true, index: true },
    appleEnvironment: { type: String, enum: ["Production", "Sandbox"] },
    couponCode: { type: String, trim: true, uppercase: true },
    couponType: { type: String, enum: ["amount", "percent"] },
    couponValue: Number,
    baseAmount: Number,
    discountAmount: Number,
    taxPercent: Number,
    taxAmount: Number,
    amountBeforeCharges: Number,
    convenienceChargePercent: Number,
    convenienceCharge: Number,
    convenienceChargeGstPercent: Number,
    convenienceChargeGst: Number,
    finalAmount: Number,
    currency: { type: String, default: "INR" },
    paymentStatus: { type: String, enum: ["PENDING", "PAID", "FAILED"], default: "PENDING", index: true },
    transactionDate: Date,
    amount: { type: Number, required: true },
    status: { type: String, required: true },
    startDate: Date,
    endDate: Date,
  },
  baseJsonOptions,
);

subscriptionSchema.index({ userId: 1, createdAt: -1 });

export const Subscription = models.Subscription || model("Subscription", subscriptionSchema);
