import { Schema, model, models, baseJsonOptions } from "./base.js";

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const listStyleLevelSchema = new Schema(
  {
    level: { type: Number, min: 1, max: 9, default: 1 },
    listStyleType: { type: String, trim: true, default: "decimal" },
    markerTemplate: { type: String, trim: true, default: "{value}." },
    markerSuffix: { type: String, trim: true, default: "." },
    indentation: { type: Number, min: 0, max: 120, default: 24 },
  },
  { _id: false },
);

const listStyleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    key: { type: String, trim: true, unique: true, index: true },
    category: {
      type: String,
      enum: ["unordered", "ordered", "alphabetical", "roman", "parenthesis", "multilevel", "custom"],
      default: "ordered",
      index: true,
    },
    listStyleType: { type: String, trim: true, default: "decimal" },
    markerTemplate: { type: String, trim: true, default: "{value}." },
    markerSuffix: { type: String, trim: true, default: "." },
    startAt: { type: Number, min: 1, default: 1 },
    levels: { type: [listStyleLevelSchema], default: [] },
    description: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  baseJsonOptions,
);

listStyleSchema.pre("validate", function syncListStyleFields(next) {
  const name = String(this.name ?? "").trim();
  if (name) {
    this.name = name;
    if (!this.key) this.key = slugify(name);
  }

  if (!Array.isArray(this.levels) || this.levels.length === 0) {
    this.levels = [
      {
        level: 1,
        listStyleType: this.listStyleType || "decimal",
        markerTemplate: this.markerTemplate || "{value}.",
        markerSuffix: this.markerSuffix || ".",
        indentation: 24,
      },
    ];
  }

  next();
});

listStyleSchema.set("toJSON", {
  ...baseJsonOptions.toJSON,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    ret.name = ret.name || "";
    ret.key = ret.key || slugify(ret.name);
    ret.category = ret.category || "ordered";
    ret.listStyleType = ret.listStyleType || "decimal";
    ret.markerTemplate = ret.markerTemplate || "{value}.";
    ret.markerSuffix = ret.markerSuffix || ".";
    ret.levels = Array.isArray(ret.levels) ? ret.levels : [];
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const ListStyle = models.ListStyle || model("ListStyle", listStyleSchema);
