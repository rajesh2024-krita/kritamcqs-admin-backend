import { Schema, model, models, baseJsonOptions } from "./base.js";

const userSchema = new Schema(
  {
    mobile: { type: String, unique: true, sparse: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
    passwordHash: { type: String },
    googleId: { type: String, trim: true, sparse: true, unique: true, index: true },
    firebaseUid: { type: String, trim: true, sparse: true, unique: true, index: true },
    appleId: { type: String, trim: true, sparse: true, unique: true, index: true },
    loginProvider: { type: String, enum: ["EMAIL", "GOOGLE", "APPLE"], default: "EMAIL", index: true },
    appleUserId: { type: String, trim: true, sparse: true, unique: true, index: true },
    appleEmail: { type: String, trim: true, lowercase: true },
    appleAppAccountToken: { type: String, sparse: true, unique: true, index: true },
    isAppleLogin: { type: Boolean, default: false, index: true },
    authTypes: { type: [String], default: [] },
    name: { type: String, trim: true },
    address: { type: String, default: "" },
    examMode: { type: String, trim: true, index: true },
    level: { type: String, trim: true },
    onboardingComplete: { type: Boolean, default: false, index: true },
    mobileVerified: { type: Boolean, default: false, index: true },
    emailVerified: { type: Boolean, default: false, index: true },
    requiresProfileCompletion: { type: Boolean, default: false },
    country: { type: String, default: "" },
    state: { type: String, default: "" },
    city: { type: String, default: "" },
    userType: { type: String, default: "" },
    profileImage: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    isBlocked: { type: Boolean, default: false, index: true },
    lastLoginAt: { type: Date },
    isPremium: { type: Boolean, default: false, index: true },
    premiumExpiresAt: { type: Date },
    premiumPlan: { type: String },
    premiumExpiry: { type: Date },
    paymentPlatform: { type: String, enum: ["ios", "android", "web"] },
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
    adminRole: { type: String, enum: ["main", "employee"], default: "main", index: true },
    employeePermissions: {
      createQuestions: { type: Boolean, default: false },
      editQuestions: { type: Boolean, default: false },
      deleteQuestions: { type: Boolean, default: false },
      viewQuestions: { type: Boolean, default: false },
      bulkUploadQuestions: { type: Boolean, default: false },
      createManualQuestions: { type: Boolean, default: false },
    },
    modulePermissions: { type: Schema.Types.Mixed, default: {} },
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
