import { Schema, model, models, baseJsonOptions } from "./base.js";

const websiteSettingsSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },
    websiteMode: { type: String, enum: ["single", "multiple"], default: "single" },
    navbarStyle: { type: String, enum: ["style1", "style2", "style3", "centerLogo", "leftLogo"], default: "style1" },
    stickyNavbar: { type: Boolean, default: true },
    transparentNavbar: { type: Boolean, default: false },
    logoUrl: { type: String, trim: true, default: "" },
    primaryColor: { type: String, trim: true, default: "#2563eb" },
    backgroundColor: { type: String, trim: true, default: "#ffffff" },
    menuTextColor: { type: String, trim: true, default: "#0f172a" },
    ctaEnabled: { type: Boolean, default: true },
    ctaLabel: { type: String, trim: true, default: "Download App" },
    ctaHref: { type: String, trim: true, default: "" },
    mobileMenuEnabled: { type: Boolean, default: true },
    footerLayout: { type: String, enum: ["layout1", "layout2", "layout3"], default: "layout1" },
    footerMenusEnabled: { type: Boolean, default: true },
    copyrightText: { type: String, trim: true, default: "" },
    socialLinks: { type: Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: true },
  },
  baseJsonOptions,
);

export const WebsiteSettings = models.WebsiteSettings || model("WebsiteSettings", websiteSettingsSchema);
