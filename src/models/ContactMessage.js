import { Schema, model, models, baseJsonOptions } from "./base.js";

const contactReplySchema = new Schema(
  {
    message: { type: String, required: true, trim: true },
    sentTo: { type: String, default: "" },
    sentById: { type: Schema.Types.ObjectId, ref: "User" },
    sentByName: { type: String, default: "" },
    emailStatus: { type: String, enum: ["not_sent", "sent", "failed", "skipped"], default: "not_sent" },
    emailError: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    interest: { type: String, default: "", trim: true },
    message: { type: String, required: true, trim: true },
    status: { type: String, enum: ["unread", "read"], default: "unread", index: true },
    adminEmailStatus: { type: String, enum: ["not_sent", "sent", "failed", "skipped"], default: "not_sent" },
    adminEmailError: { type: String, default: "" },
    source: { type: String, default: "website" },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    replies: { type: [contactReplySchema], default: [] },
    lastRepliedAt: Date,
    lastReadAt: Date,
  },
  baseJsonOptions,
);

contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ createdAt: -1 });

export const ContactMessage = models.ContactMessage || model("ContactMessage", contactMessageSchema);
