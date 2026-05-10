import { Schema, model, models } from "./base.js";

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    subscriptionId: { type: String, required: true, index: true },
    planId: { type: String, required: true },
    userName: String,
    userEmail: String,
    userMobile: String,
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["draft", "sent", "paid", "pending", "cancelled", "void", "failed"], default: "draft", index: true },
    transactionId: String,
    invoiceDate: Date,
    dueDate: Date,
    billingCompany: { type: Schema.Types.Mixed, default: {} },
    customerCompany: { type: Schema.Types.Mixed, default: {} },
    taxDetails: { type: Schema.Types.Mixed, default: {} },
    items: { type: [Schema.Types.Mixed], default: [] },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    notes: String,
    terms: String,
    signatureUrl: String,
    logoUrl: String,
    qrCode: String,
    templateId: String,
    shareToken: { type: String, index: true },
    activityLogs: { type: [Schema.Types.Mixed], default: [] },
    pdfPath: String,
    emailStatus: { type: String, enum: ["pending", "sent", "skipped", "failed"], default: "pending" },
    emailError: String,
    sentAt: Date,
    issuedAt: { type: Date, default: Date.now },
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

export const Invoice = models.Invoice || model("Invoice", invoiceSchema);
