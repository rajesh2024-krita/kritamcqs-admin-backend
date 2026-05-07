import { Schema, Types, model, models, baseJsonOptions } from "./base.js";

const topicSchema = new Schema(
  {
    subjectId: { type: Types.ObjectId, ref: "Subject", required: true, index: true },
    chapterId: { type: Types.ObjectId, ref: "Chapter", required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    normalizedName: { type: String, required: true, trim: true, index: true },
  },
  baseJsonOptions,
);

topicSchema.pre("validate", function normalizeTopicName(next) {
  const nextName = String(this.name || "").trim();
  this.name = nextName;
  this.normalizedName = nextName.toLowerCase();
  next();
});

topicSchema.index({ chapterId: 1, normalizedName: 1 }, { unique: true });
topicSchema.index({ subjectId: 1, chapterId: 1, normalizedName: 1 });

export const Topic = models.Topic || model("Topic", topicSchema);
