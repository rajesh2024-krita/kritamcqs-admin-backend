import { Schema, model, models, baseJsonOptions } from "./base.js";

const paymentGatewaySettingsSchema = new Schema(
  {
    provider: { type: String, enum: ["razorpay"], default: "razorpay", index: true },
    razorpayKeyId: { type: String, trim: true },
    razorpayKeySecret: { type: String, trim: true },
    enabled: { type: Boolean, default: false },
    connectionStatus: { type: String, enum: ["not_configured", "connected", "failed"], default: "not_configured" },
    connectionMessage: { type: String, trim: true },
    connectedAt: Date,
  },
  baseJsonOptions,
);

export const PaymentGatewaySettings =
  models.PaymentGatewaySettings || model("PaymentGatewaySettings", paymentGatewaySettingsSchema);
