import { Schema, model, models, baseJsonOptions } from "./base.js";
const examTypeSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true, trim: true },
    key: { type: String, unique: true, sparse: true, index: true, trim: true },
    label: { type: String, trim: true },
    description: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  {
    ...baseJsonOptions,
    toJSON: {
      ...baseJsonOptions.toJSON,
      transform: (_doc, ret) => {
        ret.name = ret.name || ret.key || ret.label;
        ret.id = ret._id?.toString();
        ret.sortOrder = Number(ret.sortOrder || 0);
        delete ret._id;
        delete ret.__v;
        delete ret.key;
        delete ret.label;
        return ret;
      },
    },
  },
);

examTypeSchema.pre("validate", function syncLegacyExamTypeFields(next) {
  const normalizedName = String(this.name || this.key || this.label || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalizedName) {
    this.name = normalizedName;
    this.key = normalizedName;
    this.label = normalizedName;
  }
  next();
});

export const ExamType = models.ExamType || model("ExamType", examTypeSchema);
