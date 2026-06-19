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

async function disableInvalidTokens(tokens = []) {
  const invalidTokens = [...new Set(tokens.map((token) => String(token || "").trim()).filter(Boolean))];
  if (!invalidTokens.length) return;

  await PushDeviceToken.updateMany(
    { token: { $in: invalidTokens } },
    { $set: { enabled: false, active: false, lastUpdated: new Date() } },
  );
}

function isDuplicateKeyBulkError(error) {
  const writeErrors = error?.writeErrors || error?.result?.result?.writeErrors || [];
  if (error?.code === 11000) return true;
  return Array.isArray(writeErrors) && writeErrors.length > 0 && writeErrors.every((item) => item?.code === 11000);
}

async function insertedDocsFromBulkError(error) {
  const insertedDocs = Array.isArray(error?.insertedDocs) ? error.insertedDocs.filter(Boolean) : [];
  if (insertedDocs.length) return insertedDocs;

  const insertedIds = Object.values(error?.result?.insertedIds || error?.insertedIds || {}).filter(Boolean);
  if (!insertedIds.length) return [];
  return UserNotification.find({ _id: { $in: insertedIds } });
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
    console.info("[NOTIFICATION SAVED]", {
      notificationId: String(notification._id || notification.id || ""),
      userId: String(notification.userId || ""),
      type: notification.type,
      title: notification.title,
    });
    const tokens = tokensByUser.get(String(notification.userId || "")) || [];
    console.info("[FCM TOKEN FOUND]", {
      notificationId: String(notification._id || notification.id || ""),
      userId: String(notification.userId || ""),
      tokenCount: tokens.length,
    });
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
      await disableInvalidTokens(delivery.invalidTokens || []);
      result.sentCount += delivery.attempted || 0;
      result.successCount += delivery.successCount || 0;
      result.failedCount += delivery.failedCount || 0;
      result.errors.push(...(delivery.errors || []));

      const status = delivery.successCount > 0 ? "sent" : "failed";
      console.info(status === "sent" ? "[FCM SENT SUCCESS]" : "[FCM SENT FAILED]", {
        notificationId: String(notification._id || notification.id || ""),
        userId: String(notification.userId || ""),
        successCount: delivery.successCount || 0,
        failedCount: delivery.failedCount || 0,
        errors: delivery.errors || [],
      });
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
      console.error("[FCM SENT FAILED]", {
        notificationId: String(notification._id || notification.id || ""),
        userId: String(notification.userId || ""),
        error: message,
      });
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
  console.info("[NOTIFICATION CREATED]", { userId: doc.userId, type: doc.type, title: doc.title });
  const notification = await UserNotification.create(doc);
  if (options.autoPush !== false) {
    await sendPushForNotifications([notification]);
  }
  return notification;
}

export async function insertUserNotifications(docs = [], options = {}) {
  console.info("[NOTIFICATION CREATED]", { count: docs.length, type: docs[0]?.type || "" });
  let notifications = [];
  if (docs.length) {
    try {
      notifications = await UserNotification.insertMany(docs, { ordered: false, ...(options.insertOptions || {}) });
    } catch (error) {
      if (!isDuplicateKeyBulkError(error)) throw error;
      notifications = await insertedDocsFromBulkError(error);
      console.warn("[NOTIFICATION SAVED]", {
        count: notifications.length,
        skippedDuplicates: docs.length - notifications.length,
        warning: "Duplicate notification dedupeKey skipped",
      });
    }
  }

  let pushDelivery = null;
  if (options.autoPush !== false && notifications.length) {
    pushDelivery = await sendPushForNotifications(notifications);
  }
  return { notifications, pushDelivery };
}

export async function upsertUserNotificationOnInsert(filter, insertDoc, options = {}) {
  console.info("[NOTIFICATION CREATED]", { userId: insertDoc.userId, type: insertDoc.type, title: insertDoc.title });
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

export async function createAndSend(input = {}) {
  const userIds = [...new Set((input.userIds || input.targetUsers || []).map((id) => String(id || "")).filter(Boolean))];
  const docs = userIds.map((userId) => ({
    userId,
    type: input.type || input.category || "custom",
    title: input.title,
    body: input.body || input.message,
    dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : `notification:${Date.now()}:${userId}`,
    visibleInApp: input.visibleInApp !== false,
    linkUrl: input.linkUrl || input.deepLink || "/notifications",
    imageUrl: input.image || input.imageUrl || "",
    targetGroup: input.targetGroup || "",
    deliveryMode: input.deliveryMode || "notification",
    notificationStatus: input.visibleInApp === false ? "not_requested" : "created",
    pushStatus: input.visibleInApp === false ? "not_requested" : "pending",
    senderId: input.senderId || "",
    senderName: input.senderName || "System",
    sentAt: new Date(),
    metadata: input.metadata || undefined,
  }));
  return insertUserNotifications(docs, { autoPush: true });
}
