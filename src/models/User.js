import { Schema, model, models, baseJsonOptions } from "./base.js";
import { EXAM_MODES, USER_LEVELS } from "../types/constants.js";

const userSchema = new Schema(
  {
    mobile: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
    passwordHash: { type: String },
    name: { type: String, trim: true },
    examMode: { type: String, enum: EXAM_MODES, index: true },
    level: { type: String, enum: USER_LEVELS },
    onboardingComplete: { type: Boolean, default: false, index: true },
    mobileVerified: { type: Boolean, default: false, index: true },
    isPremium: { type: Boolean, default: false, index: true },
    premiumExpiresAt: { type: Date },
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
