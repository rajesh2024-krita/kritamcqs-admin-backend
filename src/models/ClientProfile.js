import { Schema, model, models, baseJsonOptions } from "./base.js";

const clientProfileSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  assignedEmployeeId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  followUpEnabled: { type: Boolean, default: true, index: true },
  clientStatus: { type: String, enum: ["ACTIVE", "INACTIVE", "CONVERTED", "DO_NOT_CONTACT"], default: "ACTIVE", index: true },
}, baseJsonOptions);

export const ClientProfile = models.ClientProfile || model("ClientProfile", clientProfileSchema);
