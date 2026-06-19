import { Schema, model, models } from "./base.js";

const userNotificationSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
    visibleInApp: { type: Boolean, default: true, index: true },
    linkUrl: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    attachmentUrl: { type: String, default: "" },
    attachmentName: { type: String, default: "" },
    targetGroup: { type: String, default: "", index: true },
    deliveryMode: { type: String, default: "notification" },
    notificationStatus: { type: String, default: "pending", index: true },
    senderId: { type: String, default: "" },
    senderName: { type: String, default: "" },
    emailStatus: { type: String, default: "" },
    emailError: { type: String, default: "" },
    pushStatus: { type: String, default: "" },
    pushError: { type: String, default: "" },
    templateKey: { type: String, default: "" },
    sentAt: Date,
    readAt: Date,
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

export const UserNotification = models.UserNotification || model("UserNotification", userNotificationSchema);
