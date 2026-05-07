import { Schema, model, models, baseJsonOptions } from "./base.js";

const schemeRuleSchema = new Schema(
  {
    correct: { type: Number, required: true, default: 4 },
    wrong: { type: Number, required: true, default: -1 },
    unanswered: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const examMarkingSchemeSchema = new Schema(
  {
    version: { type: String, required: true, default: "v1" },
    examType: { type: String, enum: ["NEET", "JEE_MAIN", "JEE_ADVANCED"], required: true },
    mcq: { type: schemeRuleSchema, required: true, default: () => ({ correct: 4, wrong: -1, unanswered: 0 }) },
    numerical: { type: schemeRuleSchema, required: true, default: () => ({ correct: 4, wrong: 0, unanswered: 0 }) },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const examMarkingSettingsSchema = new Schema(
  {
    neet: {
      type: examMarkingSchemeSchema,
      default: () => ({
        version: "v1",
        examType: "NEET",
        mcq: { correct: 4, wrong: -1, unanswered: 0 },
        numerical: { correct: 4, wrong: -1, unanswered: 0 },
        active: true,
      }),
    },
    jeeMain: {
      type: examMarkingSchemeSchema,
      default: () => ({
        version: "v1",
        examType: "JEE_MAIN",
        mcq: { correct: 4, wrong: -1, unanswered: 0 },
        numerical: { correct: 4, wrong: 0, unanswered: 0 },
        active: true,
      }),
    },
    jeeAdvanced: {
      type: examMarkingSchemeSchema,
      default: () => ({
        version: "v1",
        examType: "JEE_ADVANCED",
        mcq: { correct: 4, wrong: -1, unanswered: 0 },
        numerical: { correct: 4, wrong: 0, unanswered: 0 },
        active: true,
      }),
    },
  },
  baseJsonOptions,
);

function validateRule(rule) {
  const correct = Number(rule?.correct ?? 0);
  const wrong = Number(rule?.wrong ?? 0);
  const unanswered = Number(rule?.unanswered ?? 0);
  return Number.isFinite(correct) && Number.isFinite(wrong) && Number.isFinite(unanswered);
}

examMarkingSettingsSchema.pre("validate", function validateMarkingSettings(next) {
  const schemes = [this.neet, this.jeeMain, this.jeeAdvanced];
  for (const scheme of schemes) {
    if (!scheme?.version) return next(new Error("Marking scheme version is required"));
    if (!validateRule(scheme?.mcq)) return next(new Error("MCQ marking rule is invalid"));
    if (!validateRule(scheme?.numerical)) return next(new Error("Numerical marking rule is invalid"));
  }
  return next();
});

export const ExamMarkingSettings = models.ExamMarkingSettings || model("ExamMarkingSettings", examMarkingSettingsSchema);
