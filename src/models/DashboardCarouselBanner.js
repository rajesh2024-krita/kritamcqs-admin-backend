import { Schema, model, models, baseJsonOptions } from "./base.js";

const dashboardCarouselBannerSchema = new Schema(
  {
    title: { type: String, trim: true, default: "" },
    subtitle: { type: String, trim: true, default: "" },
    imageUrl: { type: String, required: true, trim: true },
    redirectLink: { type: String, trim: true, default: "" },
    imagePositionX: { type: Number, default: 50, min: 0, max: 100 },
    imagePositionY: { type: Number, default: 50, min: 0, max: 100 },
    displayOrder: { type: Number, default: 0, index: true },
    enabled: { type: Boolean, default: true, index: true },
  },
  baseJsonOptions,
);

export const DashboardCarouselBanner =
  models.DashboardCarouselBanner || model("DashboardCarouselBanner", dashboardCarouselBannerSchema);
