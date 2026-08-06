import mongoose from "mongoose";
import { AdminActivityLog, User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";

const CONFIG_COLLECTION = "subscription_reminder_notification_center_configs";
const JOB_COLLECTION = "subscription_reminder_notification_center_jobs";
const LOG_COLLECTION = "subscription_reminder_notification_center_logs";

const defaultReminders = [
  {
    id: "immediate",
    name: "Immediate Reminder",
    enabled: true,
    delayAmount: 0,
    delayUnit: "Minutes",
    push: {
      title: "Your Premium Access Is Waiting",
      message: "Complete your Rs.499 purchase and unlock premium MCQs, PYQs and mock tests.",
      ctaText: "Complete Purchase",
      ctaAction: "/subscription",
    },
    email: {
      subject: "Complete your Krita Premium purchase",
      body: "<p>Hi {{StudentName}},</p><p>Your Krita Premium access is waiting. Complete your purchase to continue your preparation.</p><p>Best wishes,<br/>Team Krita</p>",
      ctaText: "Complete Purchase",
      ctaUrl: "/subscription",
    },
  },
  {
    id: "after-24-hours",
    name: "24 Hours Reminder",
    enabled: true,
    delayAmount: 24,
    delayUnit: "Hours",
    push: {
      title: "Still Thinking About Premium?",
      message: "Your Premium practice plan is still waiting. Complete your subscription and keep learning.",
      ctaText: "Unlock Premium",
      ctaAction: "/subscription",
    },
    email: {
      subject: "Your Premium subscription is still waiting",
      body: "<p>Hi {{StudentName}},</p><p>You can still complete your Krita Premium purchase and continue practising without interruption.</p><p>Best wishes,<br/>Team Krita</p>",
      ctaText: "Complete Purchase",
      ctaUrl: "/subscription",
    },
  },
];

function dbCollection(name) {
  const db = mongoose.connection.db;
  if (!db) throw new AppError("Database is not connected", 500);
  return db.collection(name);
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).replace(/\u0000/g, "").trim();
}

function serialize(item) {
  if (!item) return item;
  return {
    ...item,
    id: String(item._id || item.id || ""),
    _id: undefined,
  };
}

function normalizePush(value = {}, fallback = {}) {
  return {
    title: cleanText(value.title, fallback.title).slice(0, 180),
    message: cleanText(value.message, fallback.message).slice(0, 4000),
    ctaText: cleanText(value.ctaText, fallback.ctaText).slice(0, 120),
    ctaAction: cleanText(value.ctaAction, fallback.ctaAction || "/subscription").slice(0, 500),
  };
}

function normalizeEmail(value = {}, fallback = {}) {
  return {
    subject: cleanText(value.subject, fallback.subject).slice(0, 180),
    body: cleanText(value.body, fallback.body).slice(0, 250000),
    ctaText: cleanText(value.ctaText, fallback.ctaText).slice(0, 120),
    ctaUrl: cleanText(value.ctaUrl, fallback.ctaUrl || "/subscription").slice(0, 500),
    templateId: cleanText(value.templateId, fallback.templateId).slice(0, 120),
    templateKey: cleanText(value.templateKey, fallback.templateKey).slice(0, 120),
  };
}

function normalizeReminders(bodyReminders, existing = {}) {
  const source = Array.isArray(bodyReminders) && bodyReminders.length
    ? bodyReminders
    : Array.isArray(existing.reminders) && existing.reminders.length
      ? existing.reminders
      : defaultReminders;

  const reminders = source.map((item, index) => {
    const fallback = defaultReminders[index] || defaultReminders[1] || defaultReminders[0];
    return {
      id: cleanText(item?.id, fallback.id || `reminder-${index + 1}`) || `reminder-${index + 1}`,
      name: cleanText(item?.name, fallback.name || `Reminder ${index + 1}`).slice(0, 160),
      enabled: item?.enabled !== false,
      delayAmount: Math.max(0, Number(item?.delayAmount ?? fallback.delayAmount ?? 0)),
      delayUnit: ["Minutes", "Hours", "Days"].includes(item?.delayUnit) ? item.delayUnit : fallback.delayUnit || "Hours",
      push: normalizePush(item?.push || {}, fallback.push || {}),
      email: normalizeEmail(item?.email || {}, fallback.email || {}),
    };
  });

  return reminders.length ? reminders : defaultReminders;
}

function configPayload(body = {}, existing = {}) {
  const reminders = normalizeReminders(body.reminders, existing);
  const enabledReminders = reminders.filter((item) => item.enabled !== false);
  if (!enabledReminders.length) throw new AppError("Enable at least one reminder", 400);

  for (const reminder of enabledReminders) {
    if (!reminder.push.title || !reminder.push.message) {
      throw new AppError(`${reminder.name}: Push title and message are required`, 400);
    }
    if (!reminder.email.subject || !reminder.email.body) {
      throw new AppError(`${reminder.name}: Email subject and body are required`, 400);
    }
  }

  return {
    reminderName: cleanText(body.reminderName, existing.reminderName || "Subscription Reminder").slice(0, 180),
    status: ["enabled", "disabled"].includes(body.status) ? body.status : existing.status || "enabled",
    channels: "Both",
    platform: ["Android", "iOS", "Web", "Both"].includes(body.platform) ? body.platform : existing.platform || "Both",
    applicablePlan: cleanText(body.applicablePlan, existing.applicablePlan || "Premium").slice(0, 180),
    targetUsers: cleanText(body.targetUsers, existing.targetUsers || "all").slice(0, 80),
    priority: Number(body.priority ?? existing.priority ?? 100),
    maximumReminderCount: enabledReminders.length,
    reminders,
    implementation: "notification_center_duplicate",
    updatedAt: new Date(),
  };
}

function assertObjectId(id, label = "Invalid id") {
  if (!mongoose.isValidObjectId(id)) throw new AppError(label, 400);
  return new mongoose.Types.ObjectId(id);
}

function searchFilter(query = {}, fields = []) {
  const filter = {};
  if (query.status && query.status !== "all") filter.status = String(query.status);
  const search = cleanText(query.search);
  if (search && fields.length) filter.$or = fields.map((field) => ({ [field]: new RegExp(search, "i") }));
  return filter;
}

async function pagedCollection(collectionName, query = {}, filter = {}, sort = { updatedAt: -1 }) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(query.limit || 10)));
  const collection = dbCollection(collectionName);
  const [items, total] = await Promise.all([
    collection.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);
  return {
    items: items.map(serialize),
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function audit(action, previousValue, updatedValue, admin) {
  await AdminActivityLog.create({
    employeeId: admin?._id,
    employeeName: admin?.name || "Administrator",
    employeeEmail: admin?.email || "",
    action: action === "Deleted" ? "delete" : action === "Created" ? "create" : "edit",
    previousValue,
    updatedValue: { ...(updatedValue || {}), featureAction: action, module: "Subscription Reminder" },
  }).catch((error) => console.error("[SUBSCRIPTION REMINDER AUDIT FAILED]", error));
}

async function hydrateUsers(items) {
  const userIds = [...new Set(items.map((item) => String(item.userId || "")).filter(mongoose.isValidObjectId))];
  const users = await User.find({ _id: { $in: userIds } }).select("name email mobile isPremium").lean();
  const byId = new Map(users.map((user) => [String(user._id), serialize(user)]));
  return items.map((item) => ({ ...item, userId: byId.get(String(item.userId)) || String(item.userId || "") }));
}

export const subscriptionReminderNotificationCenterService = {
  async listConfigurations(query = {}) {
    await dbCollection(CONFIG_COLLECTION).createIndex({ priority: 1, updatedAt: -1 });
    return pagedCollection(CONFIG_COLLECTION, query, searchFilter(query, ["reminderName", "applicablePlan"]), { priority: 1, updatedAt: -1 });
  },

  async createConfiguration(body, admin) {
    const payload = { ...configPayload(body), createdBy: String(admin?._id || ""), updatedBy: String(admin?._id || ""), createdAt: new Date() };
    const result = await dbCollection(CONFIG_COLLECTION).insertOne(payload);
    const item = await dbCollection(CONFIG_COLLECTION).findOne({ _id: result.insertedId });
    await audit("Created", null, item, admin);
    return serialize(item);
  },

  async updateConfiguration(id, body, admin) {
    const _id = assertObjectId(id, "Invalid configuration id");
    const previous = await dbCollection(CONFIG_COLLECTION).findOne({ _id });
    if (!previous) throw new AppError("Reminder configuration not found", 404);
    const payload = { ...configPayload(body, previous), updatedBy: String(admin?._id || "") };
    await dbCollection(CONFIG_COLLECTION).updateOne({ _id }, { $set: payload });
    const item = await dbCollection(CONFIG_COLLECTION).findOne({ _id });
    await audit("Updated", previous, item, admin);
    return serialize(item);
  },

  async deleteConfiguration(id, admin) {
    const _id = assertObjectId(id, "Invalid configuration id");
    const previous = await dbCollection(CONFIG_COLLECTION).findOne({ _id });
    if (!previous) throw new AppError("Reminder configuration not found", 404);
    await dbCollection(CONFIG_COLLECTION).deleteOne({ _id });
    await dbCollection(JOB_COLLECTION).updateMany(
      { configId: String(_id), status: "pending" },
      { $set: { status: "cancelled", stoppedReason: "Configuration deleted", updatedAt: new Date() } },
    );
    await audit("Deleted", previous, null, admin);
  },

  async setConfigurationStatus(id, status, admin) {
    if (!["enabled", "disabled"].includes(status)) throw new AppError("Status must be enabled or disabled", 400);
    const _id = assertObjectId(id, "Invalid configuration id");
    const previous = await dbCollection(CONFIG_COLLECTION).findOne({ _id });
    if (!previous) throw new AppError("Reminder configuration not found", 404);
    await dbCollection(CONFIG_COLLECTION).updateOne(
      { _id },
      { $set: { status, updatedBy: String(admin?._id || ""), updatedAt: new Date() } },
    );
    if (status === "disabled") {
      await dbCollection(JOB_COLLECTION).updateMany(
        { configId: String(_id), status: "pending" },
        { $set: { status: "cancelled", stoppedReason: "Configuration disabled", updatedAt: new Date() } },
      );
    }
    const item = await dbCollection(CONFIG_COLLECTION).findOne({ _id });
    await audit(status === "enabled" ? "Enabled" : "Disabled", previous, item, admin);
    return serialize(item);
  },

  async stopReminder(id, reason = "Stopped by admin") {
    const _id = assertObjectId(id, "Invalid reminder id");
    const item = await dbCollection(JOB_COLLECTION).findOneAndUpdate(
      { _id },
      { $set: { status: "cancelled", stoppedReason: reason, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!item) throw new AppError("Subscription reminder job not found", 404);
    return serialize(item);
  },

  async restartReminder(id) {
    const _id = assertObjectId(id, "Invalid reminder id");
    const item = await dbCollection(JOB_COLLECTION).findOneAndUpdate(
      { _id },
      { $set: { status: "pending", stoppedReason: "", purchaseCompleted: false, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!item) throw new AppError("Subscription reminder job not found", 404);
    return serialize(item);
  },

  async listCancelledUsers(query = {}) {
    const result = await pagedCollection(
      JOB_COLLECTION,
      query,
      searchFilter(query, ["subscriptionPlan", "eventType", "stageName"]),
      { createdAt: -1 },
    );
    return { ...result, items: await hydrateUsers(result.items) };
  },

  async getCancelledUser(id) {
    const _id = assertObjectId(id, "Invalid reminder id");
    const item = await dbCollection(JOB_COLLECTION).findOne({ _id });
    if (!item) throw new AppError("Subscription reminder job not found", 404);
    return (await hydrateUsers([serialize(item)]))[0];
  },

  async listLogs(query = {}) {
    const result = await pagedCollection(LOG_COLLECTION, query, searchFilter(query, ["status", "errorMessage", "stageName"]), { createdAt: -1 });
    return { ...result, items: await hydrateUsers(result.items) };
  },

  async getLogsByUser(userId, query = {}) {
    const filter = { userId: String(assertObjectId(userId, "Invalid user id")) };
    return pagedCollection(LOG_COLLECTION, query, filter, { createdAt: -1 });
  },

  async statistics() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [cancelledToday, pendingReminders, sentToday, emailSentToday, convertedUsers] = await Promise.all([
      dbCollection(JOB_COLLECTION).countDocuments({ createdAt: { $gte: start } }),
      dbCollection(JOB_COLLECTION).countDocuments({ status: "pending" }),
      dbCollection(LOG_COLLECTION).countDocuments({ createdAt: { $gte: start }, pushStatus: "sent" }),
      dbCollection(LOG_COLLECTION).countDocuments({ createdAt: { $gte: start }, emailStatus: "sent" }),
      dbCollection(JOB_COLLECTION).countDocuments({ purchaseCompleted: true }),
    ]);
    const totalReminders = await dbCollection(JOB_COLLECTION).countDocuments();
    const conversionRate = totalReminders ? Math.round((convertedUsers / totalReminders) * 10000) / 100 : 0;
    return { cancelledToday, pendingReminders, notificationSentToday: sentToday, emailSentToday, convertedUsers, conversionRate };
  },
};
