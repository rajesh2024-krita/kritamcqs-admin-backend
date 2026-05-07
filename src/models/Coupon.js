import { Schema, model, models, baseJsonOptions } from "./base.js";

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    type: { type: String, enum: ["amount", "percent"], required: true },
    value: { type: Number, required: true },
    active: { type: Boolean, default: true, index: true },
    validFrom: Date,
    validUntil: Date,
    usageLimit: Number,
    usedCount: { type: Number, default: 0 },
    description: { type: String, trim: true },
  },
  baseJsonOptions,
);

export const Coupon = models.Coupon || model("Coupon", couponSchema);
