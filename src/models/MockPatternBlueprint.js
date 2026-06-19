import { Schema, model, models, baseJsonOptions } from "./base.js";

const mockPatternBlueprintSchema = new Schema(
  {
    key: { type: String, enum: ["NEET", "JEE"], required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    summary: { type: [Schema.Types.Mixed], default: [] },
    subjectWise: { type: [Schema.Types.Mixed], default: [] },
    chapterWise: { type: [Schema.Types.Mixed], default: [] },
    topicWise: { type: [Schema.Types.Mixed], default: [] },
    rules: { type: [Schema.Types.Mixed], default: [] },
  },
  baseJsonOptions,
);

export const MockPatternBlueprint = models.MockPatternBlueprint || model("MockPatternBlueprint", mockPatternBlueprintSchema);
