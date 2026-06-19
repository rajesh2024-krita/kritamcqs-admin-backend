import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const testSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", index: true },
    title: { type: String, trim: true },
    score: { type: Number },
  },
  baseJsonOptions,
);

export const Test = models.Test || model("Test", testSchema);
