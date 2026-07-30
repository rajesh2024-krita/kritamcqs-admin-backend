import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalCompetitionRegistrationSchema = new Schema(
  {
    competitionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "approved", "rejected", "locked", "cancelled"], default: "approved", index: true },
    state: { type: String, default: "", index: true },
    district: { type: String, default: "", index: true },
    school: { type: String, default: "" },
    deviceId: { type: String, default: "" },
    eligibilitySnapshot: { type: Schema.Types.Mixed, default: {} },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date },
    lockedAt: { type: Date },
  },
  { ...baseJsonOptions, collection: "NationalCompetitionRegistrations" },
);

nationalCompetitionRegistrationSchema.index({ competitionId: 1, userId: 1 }, { unique: true });

export const NationalCompetitionRegistration =
  models.NationalCompetitionRegistration || model("NationalCompetitionRegistration", nationalCompetitionRegistrationSchema);
