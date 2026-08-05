import mongoose from "mongoose";

const CtaConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, trim: true, default: "" },
    channel: { type: String, enum: ["email", "push", "both"], default: "both", index: true },
    ctaText: { type: String, trim: true, default: "" },
    ctaType: { type: String, trim: true, default: "none", index: true },
    ctaUrl: { type: String, trim: true, default: "" },
    openIn: { type: String, enum: ["app", "website", "auto"], default: "auto" },
    buttonColor: { type: String, default: "#2563eb" },
    buttonTextColor: { type: String, default: "#ffffff" },
    buttonAlignment: { type: String, enum: ["left", "center", "right"], default: "center" },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const CtaConfig =
  mongoose.models["CtaConfig"] ?? mongoose.model("CtaConfig", CtaConfigSchema);
