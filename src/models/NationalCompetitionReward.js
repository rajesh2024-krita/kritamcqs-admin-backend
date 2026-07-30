import { Schema, model, models, baseJsonOptions } from "./base.js";

const nationalCompetitionRewardSchema = new Schema(
  {
    competitionId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    rewardType: { type: String, enum: ["cash", "voucher", "badge", "certificate", "other"], default: "voucher" },
    rankFrom: { type: Number, default: 1, index: true },
    rankTo: { type: Number, default: 1, index: true },
    value: { type: Number, default: 0 },
    voucherCode: { type: String, default: "" },
    approvalStatus: { type: String, enum: ["draft", "pending", "approved", "distributed", "rejected"], default: "draft", index: true },
    approvedBy: { type: String, default: "" },
    distributedAt: { type: Date },
  },
  { ...baseJsonOptions, collection: "NationalCompetitionRewards" },
);

export const NationalCompetitionReward = models.NationalCompetitionReward || model("NationalCompetitionReward", nationalCompetitionRewardSchema);
