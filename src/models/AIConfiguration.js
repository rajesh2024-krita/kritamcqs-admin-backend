import { Schema, model, models, baseJsonOptions } from "./base.js";

const aiConfigurationSchema = new Schema(
  {
    provider: { type: String, enum: ["openrouter", "gemini", "openai", "groq"], required: true, unique: true, index: true },
    model: { type: String, trim: true, default: "" },
    apiKeyEncrypted: { type: String, trim: true, default: "" },
    baseUrl: { type: String, trim: true, default: "" },
    organizationId: { type: String, trim: true, default: "" },
    availableModels: { type: [String], default: [] },
    isActive: { type: Boolean, default: false, index: true },
    lastTestedAt: { type: Date },
    lastTestStatus: { type: String, enum: ["untested", "success", "failed"], default: "untested" },
    lastTestMessage: { type: String, trim: true, default: "" },
  },
  baseJsonOptions,
);

export const AIConfiguration = models.AIConfiguration || model("AIConfiguration", aiConfigurationSchema);
