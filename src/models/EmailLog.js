import mongoose from "mongoose";

const EmailLogSchema = new mongoose.Schema(
  {
    templateKey: { type: String, default: "" },
    templateName: { type: String, default: "" },
    module: { type: String, default: "" },
    to: { type: String, required: true, index: true },
    subject: { type: String, default: "" },
    status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending" },
    error: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
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

export const EmailLog = mongoose.models["EmailLog"] ?? mongoose.model("EmailLog", EmailLogSchema);
