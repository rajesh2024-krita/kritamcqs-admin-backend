import { PushDeviceToken, UserNotification } from "../models/index.js";
import { isPushConfigured, sendPushToTokens } from "../utils/pushNotificationSender.js";

function notificationToPayload(notification) {
  return {
    title: notification.title,
    body: notification.body,
    image: notification.imageUrl,
    deepLink: notification.linkUrl || "/notifications",
    category: notification.type || "custom",
    priority: "high",
    data: {
      notificationId: String(notification._id || notification.id || ""),
      notificationType: notification.type || "",
    },
  };
}

async function activeTokensForUsers(userIds = []) {
  const uniqueUserIds = [...new Set(userIds.map((id) => String(id || "")).filter(Boolean))];
  if (!uniqueUserIds.length) return { tokenRows: [], tokensByUser: new Map() };

  const tokenRows = await PushDeviceToken.find({
    userId: { $in: uniqueUserIds },
    enabled: true,
    active: { $ne: false },
  }).lean();

  const tokensByUser = new Map();
  tokenRows.forEach((row) => {
    const userId = String(row.userId || "");
    if (!tokensByUser.has(userId)) tokensByUser.set(userId, []);
    tokensByUser.get(userId).push(row.token);
  });

  return { tokenRows, tokensByUser };
}

export async function sendPushForNotifications(notifications = []) {
  const visibleNotifications = notifications.filter((item) => item && item.visibleInApp !== false);
  const result = {
    sentCount: 0,
    successCount: 0,
    failedCount: 0,
    noTokenCount: 0,
    skippedCount: notifications.length - visibleNotifications.length,
    errors: [],
  };
  if (!visibleNotifications.length) return result;

  const { tokensByUser } = await activeTokensForUsers(visibleNotifications.map((item) => item.userId));

  for (const notification of visibleNotifications) {
    const tokens = tokensByUser.get(String(notification.userId || "")) || [];
    if (!tokens.length) {
      result.noTokenCount += 1;
      await UserNotification.updateOne(
        { _id: notification._id },
        { $set: { pushStatus: "no_token", pushError: "", sentAt: notification.sentAt || new Date() } },
      );
      continue;
    }

    if (!isPushConfigured()) {
      result.failedCount += 1;
      const error = "Firebase service account is not configured";
      result.errors.push(error);
      await UserNotification.updateOne(
        { _id: notification._id },
        { $set: { pushStatus: "failed", pushError: error, sentAt: notification.sentAt || new Date() } },
      );
      continue;
    }

    try {
      const delivery = await sendPushToTokens(tokens, notificationToPayload(notification));
      result.sentCount += delivery.attempted || 0;
      result.successCount += delivery.successCount || 0;
      result.failedCount += delivery.failedCount || 0;
      result.errors.push(...(delivery.errors || []));

      const status = delivery.successCount > 0 ? "sent" : "failed";
      await UserNotification.updateOne(
        { _id: notification._id },
        {
          $set: {
            pushStatus: status,
            pushError: status === "failed" ? (delivery.errors?.[0] || "Push delivery failed") : "",
            sentAt: notification.sentAt || new Date(),
          },
        },
      );
    } catch (error) {
      const message = error.message || "Push delivery failed";
      result.failedCount += 1;
      result.errors.push(message);
      await UserNotification.updateOne(
        { _id: notification._id },
        { $set: { pushStatus: "failed", pushError: message, sentAt: notification.sentAt || new Date() } },
      );
    }
  }

  return { ...result, errors: [...new Set(result.errors)] };
}

export async function createUserNotification(doc, options = {}) {
  const notification = await UserNotification.create(doc);
  if (options.autoPush !== false) {
    await sendPushForNotifications([notification]);
  }
  return notification;
}

export async function insertUserNotifications(docs = [], options = {}) {
  const notifications = docs.length ? await UserNotification.insertMany(docs, { ordered: false, ...(options.insertOptions || {}) }) : [];
  let pushDelivery = null;
  if (options.autoPush !== false && notifications.length) {
    pushDelivery = await sendPushForNotifications(notifications);
  }
  return { notifications, pushDelivery };
}

export async function upsertUserNotificationOnInsert(filter, insertDoc, options = {}) {
  const result = await UserNotification.updateOne(
    filter,
    { $setOnInsert: insertDoc },
    { upsert: true, ...(options.updateOptions || {}) },
  );

  if (!result.upsertedCount) return { created: false, notification: null, result, pushDelivery: null };

  const notification = await UserNotification.findOne(filter);
  const pushDelivery = options.autoPush === false || !notification ? null : await sendPushForNotifications([notification]);
  return { created: true, notification, result, pushDelivery };
}
