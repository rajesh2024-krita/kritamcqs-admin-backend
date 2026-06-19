import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const chapterSchema = new Schema(
  {
    subjectId: { type: Types.ObjectId, ref: "Subject", required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    isLockedForFreeUsers: { type: Boolean, default: false, index: true },
    iconUrl: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
  },
  baseJsonOptions,
);

chapterSchema.index({ subjectId: 1, name: 1 }, { unique: true });

export const Chapter = models.Chapter || model("Chapter", chapterSchema);
