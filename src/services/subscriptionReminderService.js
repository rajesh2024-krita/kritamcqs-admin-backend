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

const defaultReminderTemplates = [
  {
    id: "immediate",
    name: "Reminder 1 - Immediate",
    enabled: true,
    delayAmount: 0,
    delayUnit: "Minutes",
    inApp: {
      title: "You're Almost There",
      message: "Your Krita NEET JEE Premium purchase was not completed. Unlock 6 months of preparation with 7,000+ MCQs, 10 years of PYQs, weak-area tracking and weekly NEET/JEE-pattern mock tests for ₹499.",
      ctaText: "Complete My Purchase",
      ctaAction: "/subscription",
    },
    push: {
      title: "Your Premium Access Is Waiting",
      message: "Complete your ₹499 purchase and unlock 6 months of 7,000+ MCQs, PYQs and weekly NEET/JEE-pattern mock tests.",
      ctaText: "Complete Purchase",
      ctaAction: "/subscription",
    },
    email: {
      subject: "Continue Your NEET/JEE Preparation",
      body: "<p>Hi {{StudentName}},</p><p>You were close to activating Krita NEET JEE Premium, but your purchase was not completed.</p><p>Get 6 months of complete Premium access for ₹499 and continue preparing with:</p><ul><li>7,000+ NEET and JEE MCQs</li><li>Last 10 years' previous-year questions</li><li>Chapter-wise and topic-wise practice</li><li>Detailed answers and clear explanations</li><li>Weak-area identification and progress tracking</li><li>Weekly mock tests following the NEET/JEE exam pattern</li></ul><p>That works out to approximately ₹83 per month for complete exam-focused practice.</p><p>Don't stop after identifying your weak chapters. Practise them, improve your accuracy and track your progress regularly.</p><p>Your Premium access will be activated after successful payment.</p><p>Best wishes,<br/>Team Krita NEET JEE</p>",
      ctaText: "Complete My ₹499 Purchase",
      ctaUrl: "/subscription",
    },
  },
  {
    id: "after-24-hours",
    name: "Reminder 2 - After 24 Hours",
    enabled: true,
    delayAmount: 24,
    delayUnit: "Hours",
    inApp: {
      title: "Improve Your Weak NEET Topics",
      message: "Don't stop after identifying your weak chapters. Unlock complete practice, PYQs and weekly mock tests for ₹499 for 6 months.",
      ctaText: "Unlock Premium",
      ctaAction: "/subscription",
    },
    push: {
      title: "Improve Your Weak NEET Topics",
      message: "Don't stop after identifying your weak chapters. Unlock complete practice, PYQs and weekly mock tests for ₹499 for 6 months.",
      ctaText: "Unlock Premium",
      ctaAction: "/subscription",
    },
    email: {
      subject: "Continue Your NEET/JEE Preparation",
      body: "<p>Hi {{StudentName}},</p><p>Your Krita NEET JEE Premium access is still waiting. Complete your ₹499 purchase to unlock MCQs, PYQs, weak-area tracking and weekly NEET/JEE-pattern mock tests.</p><p>Keep practising your weak chapters and track your progress regularly.</p><p>Best wishes,<br/>Team Krita NEET JEE</p>",
      ctaText: "Complete My ₹499 Purchase",
      ctaUrl: "/subscription",
    },
  },
];

function cleanText(value, fallback = "") {
  return String(value ?? fallback).replace(/\u0000/g, "").trim();
}

function normalizeTemplateGroup(value = {}, fallback = {}) {
  return {
    title: cleanText(value.title, fallback.title).slice(0, 180),
    message: cleanText(value.message, fallback.message).slice(0, 4000),
    ctaText: cleanText(value.ctaText, fallback.ctaText).slice(0, 120),
    ctaAction: cleanText(value.ctaAction, fallback.ctaAction).slice(0, 500),
  };
}

function normalizeEmailTemplate(value = {}, fallback = {}) {
  return {
    subject: cleanText(value.subject, fallback.subject).slice(0, 180),
    body: cleanText(value.body, fallback.body).slice(0, 250000),
    ctaText: cleanText(value.ctaText, fallback.ctaText).slice(0, 120),
    ctaUrl: cleanText(value.ctaUrl, fallback.ctaUrl).slice(0, 500),
  };
}

function normalizeReminderTemplates(bodyReminders, existing = {}) {
  const existingReminders = Array.isArray(existing.reminders) && existing.reminders.length ? existing.reminders : [];
  const source = Array.isArray(bodyReminders) && bodyReminders.length
    ? bodyReminders
    : existingReminders.length
      ? existingReminders
      : defaultReminderTemplates;

  const normalized = source.map((item, index) => {
    const fallback = defaultReminderTemplates[index] || defaultReminderTemplates[0];
    const id = cleanText(item?.id, fallback.id || `reminder-${index + 1}`) || `reminder-${index + 1}`;
    return {
      id,
      name: cleanText(item?.name, fallback.name || `Reminder ${index + 1}`).slice(0, 160),
      enabled: item?.enabled !== false,
      delayAmount: Math.max(0, Number(item?.delayAmount ?? fallback.delayAmount ?? 0)),
      delayUnit: ["Minutes", "Hours", "Days"].includes(item?.delayUnit) ? item.delayUnit : fallback.delayUnit || "Hours",
      inApp: normalizeTemplateGroup(item?.inApp, fallback.inApp),
      push: normalizeTemplateGroup(item?.push, fallback.push),
      email: normalizeEmailTemplate(item?.email, fallback.email),
    };
  });

  return normalized.length ? normalized : defaultReminderTemplates;
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
  const reminders = normalizeReminderTemplates(body.reminders, existing);
  const firstEnabledReminder = reminders.find((item) => item.enabled !== false) || reminders[0];
  const payload = {
    reminderName: body.reminderName !== undefined ? String(body.reminderName || "").trim() : existing.reminderName,
    status: body.status !== undefined ? String(body.status || "enabled") : existing.status || "enabled",
    channels: body.channels !== undefined ? String(body.channels || "Both") : existing.channels || "Both",
    immediateReminderEnabled: firstEnabledReminder?.delayAmount === 0,
    initialDelay: Number(firstEnabledReminder?.delayAmount || 0),
    repeatInterval: Number(reminders[1]?.delayAmount || existing.repeatInterval || 24),
    delayUnit: firstEnabledReminder?.delayUnit || "Hours",
    maximumReminderCount: body.maximumReminderCount !== undefined ? Number(body.maximumReminderCount || 1) : Math.max(1, reminders.filter((item) => item.enabled !== false).length),
    notificationTitle: firstEnabledReminder?.push?.title || firstEnabledReminder?.inApp?.title || "",
    notificationMessage: firstEnabledReminder?.push?.message || firstEnabledReminder?.inApp?.message || "",
    emailSubject: firstEnabledReminder?.email?.subject || "",
    emailTemplate: firstEnabledReminder?.email?.body || "",
    reminders,
    platform: body.platform !== undefined ? String(body.platform || "Both") : existing.platform || "Both",
    applicablePlan: body.applicablePlan !== undefined ? String(body.applicablePlan || "").trim() : existing.applicablePlan,
    targetUsers: body.targetUsers !== undefined ? String(body.targetUsers || "all") : existing.targetUsers || "all",
    priority: body.priority !== undefined ? Number(body.priority || 0) : Number(existing.priority || 100),
  };
  if (!payload.reminderName) throw new AppError("Reminder Name is required", 400);
  const enabledReminders = payload.reminders.filter((item) => item.enabled !== false);
  if (!enabledReminders.length) throw new AppError("Enable at least one reminder", 400);
  for (const reminder of enabledReminders) {
    if (!reminder.inApp.title || !reminder.inApp.message || !reminder.inApp.ctaText || !reminder.inApp.ctaAction) {
      throw new AppError(`${reminder.name}: In-app title, message, CTA text and CTA action are required`, 400);
    }
    if (!reminder.push.title || !reminder.push.message || !reminder.push.ctaText || !reminder.push.ctaAction) {
      throw new AppError(`${reminder.name}: Push title, message, CTA text and CTA action are required`, 400);
    }
    if (!reminder.email.subject || !reminder.email.body || !reminder.email.ctaText || !reminder.email.ctaUrl) {
      throw new AppError(`${reminder.name}: Email subject, body, CTA text and CTA URL are required`, 400);
    }
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
      await SubscriptionReminder.updateMany(
        { status: "pending" },
        {
          $set: { status: "stopped", stoppedReason: "Reminder disabled" },
          $unset: { activeKey: "", immediateReminderSending: "", scheduledReminderSending: "" },
        },
      );
    }
    await audit(status === "enabled" ? "Enabled" : "Disabled", previous, item.toObject(), admin);
    return item;
  },

  async stopReminder(id, reason = "Stopped by admin") {
    assertObjectId(id, "Invalid reminder id");
    const item = await SubscriptionReminder.findByIdAndUpdate(
      id,
      {
        $set: { status: "stopped", stoppedReason: reason },
        $unset: { activeKey: "", immediateReminderSending: "", scheduledReminderSending: "" },
      },
      { new: true },
    );
    if (!item) throw new AppError("Subscription reminder not found", 404);
    return item;
  },

  async restartReminder(id) {
    assertObjectId(id, "Invalid reminder id");
    const config = await ReminderConfiguration.findOne({ status: "enabled" }).sort({ priority: 1, updatedAt: -1 });
    if (!config) throw new AppError("Enable a reminder configuration before restarting", 400);
    const existing = await SubscriptionReminder.findById(id);
    if (!existing) throw new AppError("Subscription reminder not found", 404);
    const item = await SubscriptionReminder.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "pending",
          purchaseCompleted: false,
          nextReminderDate: nextDateFromConfig(config),
          stoppedReason: "",
          activeKey: `subscription-reminder:${String(existing.userId)}`,
        },
        $unset: { immediateReminderSending: "", scheduledReminderSending: "" },
      },
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
