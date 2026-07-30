import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalCompetitionAuditLogSchema = new Schema(
  {
    competitionId: { type: String, default: "", index: true },
    actorId: { type: String, default: "", index: true },
    actorRole: { type: String, enum: ["student", "admin", "system"], default: "system" },
    action: { type: String, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: "" },
  },
  { ...baseJsonOptions, collection: "NationalCompetitionAuditLogs" },
);

export const NationalCompetitionAuditLog =
  models.NationalCompetitionAuditLog || model("NationalCompetitionAuditLog", nationalCompetitionAuditLogSchema);
