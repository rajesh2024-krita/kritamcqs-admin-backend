import { Schema, model, models, Types, baseJsonOptions } from "./base.js";

export const scriptTypeValues = [
  "Microsoft Clarity",
  "Google Analytics",
  "Google Tag Manager",
  "Facebook Pixel",
  "Meta Pixel",
  "LinkedIn Insight",
  "Custom",
];

export const scriptPlatformValues = ["Android", "iOS", "Web", "All"];
export const scriptLoadPositionValues = ["Head", "Body Start", "Body End"];
export const scriptStatusValues = ["enabled", "disabled"];

const thirdPartyScriptSchema = new Schema(
  {
    scriptName: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    scriptType: { type: String, enum: scriptTypeValues, default: "Custom", index: true },
    scriptCode: { type: String, required: true, maxlength: 250000 },
    platform: { type: String, enum: scriptPlatformValues, default: "All", index: true },
    loadPosition: { type: String, enum: scriptLoadPositionValues, default: "Body End" },
    priority: { type: Number, default: 100, index: true },
    status: { type: String, enum: scriptStatusValues, default: "disabled", index: true },
    createdBy: { type: Types.ObjectId, ref: "User" },
    updatedBy: { type: Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

thirdPartyScriptSchema.index({ scriptName: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
thirdPartyScriptSchema.index({ status: 1, platform: 1, priority: 1 });
thirdPartyScriptSchema.set("collection", "third_party_scripts");

export const ThirdPartyScript = models.ThirdPartyScript || model("ThirdPartyScript", thirdPartyScriptSchema);
