import { Schema, model, models, baseJsonOptions } from "./base.js";

const audienceValues = [
  "all",
  "premium",
  "nonPremium",
  "newRegistered",
  "newRegisteredNonPremium",
];

const offerTimerSettingsSchema = new Schema(
  {
    key: { type: String, default: "app-offer-timer", unique: true, index: true },
    enabled: { type: Boolean, default: false, index: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    ctaText: { type: String, default: "" },
    ctaLink: { type: String, default: "" },
    startAt: { type: Date },
    endAt: { type: Date },
    audience: { type: String, enum: audienceValues, default: "all", index: true },
    widgetStyle: { type: Schema.Types.Mixed, default: {} },
    popupStyle: { type: Schema.Types.Mixed, default: {} },
    updatedById: { type: Schema.Types.ObjectId, ref: "User" },
  },
  baseJsonOptions,
);

export const OfferTimerSettings = models.OfferTimerSettings || model("OfferTimerSettings", offerTimerSettingsSchema);
export { audienceValues as offerTimerAudienceValues };
