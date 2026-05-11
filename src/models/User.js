import { Schema, model, models, baseJsonOptions } from "./base.js";

const userSchema = new Schema(
  {
    mobile: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
    passwordHash: { type: String },
    name: { type: String, trim: true },
    address: { type: String, default: "" },
    examMode: { type: String, trim: true, index: true },
    level: { type: String, trim: true },
    onboardingComplete: { type: Boolean, default: false, index: true },
    mobileVerified: { type: Boolean, default: false, index: true },
    isPremium: { type: Boolean, default: false, index: true },
    premiumExpiresAt: { type: Date },
    lastPurchase: {
      subscriptionId: { type: String },
      planId: { type: String },
      planAmount: { type: Number },
      discountAmount: { type: Number },
      taxAmount: { type: Number },
      convenienceCharge: { type: Number },
      convenienceChargeGst: { type: Number },
      finalAmount: { type: Number },
      currency: { type: String },
      razorpayOrderId: { type: String },
      razorpayPaymentId: { type: String },
      paymentStatus: { type: String },
      transactionDate: { type: Date },
    },
    isAdmin: { type: Boolean, default: false, index: true },
    migratedFromOldApp: { type: Boolean, default: false, index: true },
  },
  baseJsonOptions,
);

userSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

export const User = models.User || model("User", userSchema);
