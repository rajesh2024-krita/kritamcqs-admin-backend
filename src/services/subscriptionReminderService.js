import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import {
  AdminActivityLog,
  ReminderConfiguration,
  ReminderLog,
  SubscriptionReminder,
} from "../models/index.js";

function unitToMs(unit) {
  if (unit === "Days") return 24 * 60 * 60 * 1000;
  if (unit === "Hours") return 60 * 60 * 1000;
  return 60 * 1000;
}

function nextDateFromConfig(config, useRepeat = false) {
  const amount = useRepeat ? config.repeatInterval : config.initialDelay;
  return new Date(Date.now() + Math.max(0, Number(amount || 0)) * unitToMs(config.delayUnit));
}

async function audit(action, previousValue, updatedValue, admin) {
  await AdminActivityLog.create({
    employeeId: admin?._id,
    employeeName: admin?.name || "Administrator",
    employeeEmail: admin?.email || "",
    action: action === "Deleted" ? "delete" : action === "Created" ? "create" : "edit",
    previousValue,
    updatedValue: { ...(updatedValue || {}), featureAction: action },
  }).catch((error) => console.error("[AUDIT] Failed to write reminder activity", error));
}

function configPayload(body = {}, existing = {}) {
  const payload = {
    reminderName: body.reminderName !== undefined ? String(body.reminderName || "").trim() : existing.reminderName,
    status: body.status !== undefined ? String(body.status || "enabled") : existing.status || "enabled",
    channels: body.channels !== undefined ? String(body.channels || "Both") : existing.channels || "Both",
    immediateReminderEnabled: body.immediateReminderEnabled !== undefined ? Boolean(body.immediateReminderEnabled) : existing.immediateReminderEnabled !== false,
    initialDelay: body.initialDelay !== undefined ? Number(body.initialDelay || 0) : Number(existing.initialDelay || 30),
    repeatInterval: body.repeatInterval !== undefined ? Number(body.repeatInterval || 1) : Number(existing.repeatInterval || 24),
    delayUnit: body.delayUnit !== undefined ? String(body.delayUnit || "Hours") : existing.delayUnit || "Hours",
    maximumReminderCount: body.maximumReminderCount !== undefined ? Number(body.maximumReminderCount || 1) : Number(existing.maximumReminderCount || 3),
    notificationTitle: body.notificationTitle !== undefined ? String(body.notificationTitle || "").trim() : existing.notificationTitle,
    notificationMessage: body.notificationMessage !== undefined ? String(body.notificationMessage || "").trim() : existing.notificationMessage,
    emailSubject: body.emailSubject !== undefined ? String(body.emailSubject || "").trim() : existing.emailSubject,
    emailTemplate: body.emailTemplate !== undefined ? String(body.emailTemplate || "").replace(/\u0000/g, "").trim() : existing.emailTemplate,
    platform: body.platform !== undefined ? String(body.platform || "Both") : existing.platform || "Both",
    applicablePlan: body.applicablePlan !== undefined ? String(body.applicablePlan || "").trim() : existing.applicablePlan,
    targetUsers: body.targetUsers !== undefined ? String(body.targetUsers || "all") : existing.targetUsers || "all",
    priority: body.priority !== undefined ? Number(body.priority || 0) : Number(existing.priority || 100),
  };
  if (!payload.reminderName) throw new AppError("Reminder Name is required", 400);
  if (payload.channels !== "Email" && (!payload.notificationTitle || !payload.notificationMessage)) {
    throw new AppError("Notification title and message are required for notification reminders", 400);
  }
  if (payload.channels !== "Notification" && (!payload.emailSubject || !payload.emailTemplate)) {
    throw new AppError("Email subject and template are required for email reminders", 400);
  }
  return payload;
}

function assertObjectId(id, label = "Invalid id") {
  if (!mongoose.isValidObjectId(id)) throw new AppError(label, 400);
}

export const subscriptionReminderService = {
  async listConfigurations(query = {}) {
    return paged(ReminderConfiguration, query, ["reminderName", "channels", "platform"], { updatedAt: -1 });
  },

  async createConfiguration(body, admin) {
    const payload = { ...configPayload(body), createdBy: admin?._id, updatedBy: admin?._id };
    try {
      const item = await ReminderConfiguration.create(payload);
      await audit("Created", null, item.toObject(), admin);
      return item;
    } catch (error) {
      if (error?.code === 11000) throw new AppError("A reminder configuration with this name already exists", 409);
      throw error;
    }
  },

  async updateConfiguration(id, body, admin) {
    assertObjectId(id, "Invalid configuration id");
    const item = await ReminderConfiguration.findById(id);
    if (!item) throw new AppError("Reminder configuration not found", 404);
    const previous = item.toObject();
    Object.assign(item, configPayload(body, item), { updatedBy: admin?._id });
    try {
      await item.save();
      await audit("Updated", previous, item.toObject(), admin);
      return item;
    } catch (error) {
      if (error?.code === 11000) throw new AppError("A reminder configuration with this name already exists", 409);
      throw error;
    }
  },

  async deleteConfiguration(id, admin) {
    assertObjectId(id, "Invalid configuration id");
    const item = await ReminderConfiguration.findById(id);
    if (!item) throw new AppError("Reminder configuration not found", 404);
    const previous = item.toObject();
    await item.deleteOne();
    await audit("Deleted", previous, null, admin);
  },

  async setConfigurationStatus(id, status, admin) {
    if (!["enabled", "disabled"].includes(status)) throw new AppError("Status must be enabled or disabled", 400);
    assertObjectId(id, "Invalid configuration id");
    const item = await ReminderConfiguration.findById(id);
    if (!item) throw new AppError("Reminder configuration not found", 404);
    const previous = item.toObject();
    item.status = status;
    item.updatedBy = admin?._id;
    await item.save();
    if (status === "disabled") {
      await SubscriptionReminder.updateMany({ status: "pending" }, { $set: { status: "stopped", stoppedReason: "Reminder disabled" } });
    }
    await audit(status === "enabled" ? "Enabled" : "Disabled", previous, item.toObject(), admin);
    return item;
  },

  async stopReminder(id, reason = "Stopped by admin") {
    assertObjectId(id, "Invalid reminder id");
    const item = await SubscriptionReminder.findByIdAndUpdate(id, { status: "stopped", stoppedReason: reason }, { new: true });
    if (!item) throw new AppError("Subscription reminder not found", 404);
    return item;
  },

  async restartReminder(id) {
    assertObjectId(id, "Invalid reminder id");
    const config = await ReminderConfiguration.findOne({ status: "enabled" }).sort({ priority: 1, updatedAt: -1 });
    if (!config) throw new AppError("Enable a reminder configuration before restarting", 400);
    const item = await SubscriptionReminder.findByIdAndUpdate(
      id,
      { status: "pending", purchaseCompleted: false, nextReminderDate: nextDateFromConfig(config), stoppedReason: "" },
      { new: true },
    );
    if (!item) throw new AppError("Subscription reminder not found", 404);
    return item;
  },

  async listCancelledUsers(query = {}) {
    const result = await paged(SubscriptionReminder, query, ["subscriptionPlan", "eventType"], { createdAt: -1 }, [
      { path: "userId", select: "name email mobile isPremium" },
    ]);
    return result;
  },

  async getCancelledUser(id) {
    assertObjectId(id, "Invalid reminder id");
    const item = await SubscriptionReminder.findById(id).populate("userId", "name email mobile isPremium");
    if (!item) throw new AppError("Subscription reminder not found", 404);
    return item;
  },

  async listLogs(query = {}) {
    return paged(ReminderLog, query, ["status", "errorMessage"], { createdAt: -1 }, [
      { path: "userId", select: "name email mobile" },
      { path: "configurationId", select: "reminderName" },
    ]);
  },

  async getLogsByUser(userId, query = {}) {
    assertObjectId(userId, "Invalid user id");
    return paged(ReminderLog, { ...query, userId }, ["status", "errorMessage"], { createdAt: -1 });
  },

  async statistics() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [cancelledToday, pendingReminders, sentToday, emailSentToday, convertedUsers, totalReminders] = await Promise.all([
      SubscriptionReminder.countDocuments({ createdAt: { $gte: start } }),
      SubscriptionReminder.countDocuments({ status: "pending" }),
      ReminderLog.countDocuments({ createdAt: { $gte: start }, notificationStatus: "sent" }),
      ReminderLog.countDocuments({ createdAt: { $gte: start }, emailStatus: "sent" }),
      SubscriptionReminder.countDocuments({ purchaseCompleted: true }),
      SubscriptionReminder.countDocuments({}),
    ]);
    const conversionRate = totalReminders ? Math.round((convertedUsers / totalReminders) * 10000) / 100 : 0;
    return { cancelledToday, pendingReminders, notificationSentToday: sentToday, emailSentToday, convertedUsers, conversionRate };
  },
};

async function paged(model, query = {}, searchFields = [], defaultSort = { updatedAt: -1 }, populate = []) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(query.limit || 10)));
  const search = String(query.search || "").trim();
  const filter = {};
  if (query.status && query.status !== "all") filter.status = String(query.status);
  if (query.userId) filter.userId = query.userId;
  if (search && searchFields.length) filter.$or = searchFields.map((field) => ({ [field]: new RegExp(search, "i") }));
  const [items, total] = await Promise.all([
    model.find(filter).populate(populate).sort(defaultSort).skip((page - 1) * limit).limit(limit),
    model.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}
