import mongoose from "mongoose";

const freeQuestionConfigSchema = new mongoose.Schema(
  {
    subjectId: { type: String, required: true, unique: true, index: true },
    selectionMode: { type: String, enum: ["manual", "automatic"], default: "automatic" },
    questionCount: { type: Number, default: 20, min: 1, max: 200 },
    manualQuestionIds: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const FreeQuestionConfig =
  mongoose.models.FreeQuestionConfig ?? mongoose.model("FreeQuestionConfig", freeQuestionConfigSchema);
