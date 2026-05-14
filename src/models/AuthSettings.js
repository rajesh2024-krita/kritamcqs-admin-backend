import { Schema, model, models, baseJsonOptions } from "./base.js";

const authSettingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    emailPasswordEnabled: { type: Boolean, default: true },
    googleEnabled: { type: Boolean, default: false },
    googleClientId: { type: String, default: "" },
    googleClientSecret: { type: String, default: "" },
    googleRedirectUrls: { type: [String], default: [] },
    googleCallbackUrl: { type: String, default: "" },
    profileMobileRequired: { type: Boolean, default: false },
    sessionTimeoutMinutes: { type: Number, default: 43200, min: 15 },
    resetOtpExpiryMinutes: { type: Number, default: 10, min: 1, max: 60 },
    resetOtpMaxAttempts: { type: Number, default: 5, min: 1, max: 10 },
    resetOtpMaxResends: { type: Number, default: 3, min: 1, max: 10 },
    resetOtpEmailSubject: { type: String, default: "Krita password reset OTP" },
    resetOtpEmailTemplate: { type: String, default: "Your Krita password reset OTP is {{otp}}. It expires in {{expiryMinutes}} minutes." },
  },
  baseJsonOptions,
);

authSettingsSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    if (ret.googleClientSecret) ret.googleClientSecretConfigured = true;
    delete ret.googleClientSecret;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const AuthSettings = models.AuthSettings || model("AuthSettings", authSettingsSchema);
