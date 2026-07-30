import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalCompetitionNotificationSchema = new Schema(
  {
    competitionId: { type: String, required: true, index: true },
    channel: { type: String, enum: ["push", "email", "in_app"], default: "in_app", index: true },
    audience: { type: String, enum: ["registered", "eligible", "all", "winners"], default: "registered" },
    eventKey: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    status: { type: String, enum: ["draft", "scheduled", "sent", "failed"], default: "draft", index: true },
  },
  { ...baseJsonOptions, collection: "NationalCompetitionNotifications" },
);

export const NationalCompetitionNotification =
  models.NationalCompetitionNotification || model("NationalCompetitionNotification", nationalCompetitionNotificationSchema);
