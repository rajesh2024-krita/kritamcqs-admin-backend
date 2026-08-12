import { Schema, model, models, baseJsonOptions } from "./base.js";

const adminNotificationSchema = new Schema({
  recipientUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  followUpId: { type: Schema.Types.ObjectId, ref: "FollowUpTask", default: null },
  type: { type: String, required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  sourceKey: { type: String, unique: true, sparse: true },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
}, baseJsonOptions);

adminNotificationSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });
export const AdminNotification = models.AdminNotification || model("AdminNotification", adminNotificationSchema);
