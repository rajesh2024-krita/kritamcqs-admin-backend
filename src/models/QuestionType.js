import { Schema, model, models, baseJsonOptions } from "./base.js";

function normalizeExamType(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  const canonical = normalized.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "NEET") return "NEET";
  if (normalized === "JEE" || normalized === "JEE_MAIN" || normalized === "JEE_ADVANCED") return "JEE";
  return canonical;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const questionTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    examType: { type: String, required: true, index: true },
    key: { type: String, trim: true, unique: true, index: true },
    label: { type: String, trim: true },
    examCategory: { type: String, index: true },
    responseType: { type: String, enum: ["single", "multiple", "numeric"], default: "single" },
    displayVariant: { type: String, trim: true, default: "single_choice" },
    exampleQuestion: { type: String, trim: true },
    exampleOptions: { type: String, trim: true },
    exampleAnswer: { type: String, trim: true },
    exampleExplanation: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  baseJsonOptions,
);

questionTypeSchema.pre("validate", function syncQuestionTypeFields(next) {
  const name = String(this.name ?? this.label ?? this.key ?? "").trim();
  if (name) {
    this.name = name;
    if (!this.label) this.label = name;
    if (!this.key) this.key = slugify(name);
  }

  const examType = normalizeExamType(this.examType ?? this.examCategory);
  if (examType) {
    this.examType = examType;
    this.examCategory = examType;
  }

  next();
});

questionTypeSchema.virtual("mode").get(function getMode() {
  return this.examType === "JEE" ? "JEE" : "NEET";
});

questionTypeSchema.set("toJSON", {
  ...baseJsonOptions.toJSON,
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    ret.name = ret.name ?? ret.label ?? ret.key ?? "";
    ret.examType = normalizeExamType(ret.examType ?? ret.examCategory) || "NEET";
    ret.key = ret.key ?? slugify(ret.name);
    ret.label = ret.label ?? ret.name;
    ret.examCategory = ret.examCategory ?? ret.examType;
    ret.mode = ret.mode ?? (ret.examType === "JEE" ? "JEE" : "NEET");
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const QuestionType = models.QuestionType || model("QuestionType", questionTypeSchema);
