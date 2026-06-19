import { Schema, model, models, baseJsonOptions } from "./base.js";

const supportMessageSchema = new Schema(
  {
    sender: { type: String, enum: ["user", "admin"], required: true },
    message: { type: String, required: true, trim: true },
    attachmentUrl: { type: String, default: "" },
    attachmentName: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const supportTicketSchema = new Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: "" },
    userEmail: { type: String, default: "" },
    userMobile: { type: String, default: "" },
    category: { type: String, required: true, trim: true },
    status: { type: String, enum: ["open", "pending", "closed"], default: "open", index: true },
    isReadByAdmin: { type: Boolean, default: false, index: true },
    messages: { type: [supportMessageSchema], default: [] },
  },
  baseJsonOptions,
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ isReadByAdmin: 1, updatedAt: -1 });

export const SupportTicket = models.SupportTicket || model("SupportTicket", supportTicketSchema);
