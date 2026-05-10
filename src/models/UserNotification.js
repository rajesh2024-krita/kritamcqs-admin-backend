import { Schema, model, models } from "./base.js";

const userNotificationSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
    visibleInApp: { type: Boolean, default: true, index: true },
    emailStatus: { type: String, default: "" },
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
