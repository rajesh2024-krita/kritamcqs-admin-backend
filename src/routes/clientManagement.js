import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAdmin, hasModulePermission, isMainAdmin } from "../middlewares/auth.js";
import { AdminNotification, ClientAuditLog, ClientProfile, FollowUpTask, User, FOLLOW_UP_STATUSES, COMMUNICATION_TYPES } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/apiResponse.js";

export const clientManagementRouter = Router();
clientManagementRouter.use(requireAdmin);

const objectId = z.string().refine(mongoose.isValidObjectId, "Invalid id");
const taskBody = z.object({
  clientId: objectId,
  assignedEmployeeId: objectId.nullish(),
  communicationType: z.enum(COMMUNICATION_TYPES),
  notes: z.string().trim().min(1).max(10000),
  result: z.string().trim().max(2000).optional().default(""),
  followUpAt: z.coerce.date(),
  nextFollowUpAt: z.coerce.date().nullish(),
  status: z.enum(FOLLOW_UP_STATUSES).optional().default("NOT_STARTED"),
});

function permit(moduleKey, action = "view") {
  return (req, _res, next) => hasModulePermission(req.admin, moduleKey, action)
    ? next()
    : next(new AppError("You do not have permission to perform this CRM action", 403));
}

function canViewAll(admin) {
  return isMainAdmin(admin) || admin?.modulePermissions?.["follow-ups"]?.viewAll === true;
}

function clientScope(admin) {
  return canViewAll(admin) ? {} : { assignedEmployeeId: admin._id };
}

async function audit(req, clientId, action, previousValue, newValue, followUpId = null) {
  await ClientAuditLog.create({ clientId, followUpId, actorId: req.admin._id, actorName: req.admin.name || "Administrator", action, previousValue, newValue });
}

async function notify({ recipientUserId = null, clientId, followUpId = null, type, title, message, sourceKey }) {
  return AdminNotification.findOneAndUpdate(
    { sourceKey },
    { $setOnInsert: { recipientUserId, clientId, followUpId, type, title, message, sourceKey, isRead: false } },
    { upsert: true, new: true },
  );
}

async function ensureRegistrationNotifications() {
  const clients = await User.find({ isAdmin: { $ne: true } }).select("_id name email createdAt").sort({ createdAt: -1 }).limit(5000).lean();
  if (!clients.length) return;
  await AdminNotification.bulkWrite(clients.map((client) => ({
    updateOne: {
      filter: { sourceKey: `client-registration:${client._id}` },
      update: { $setOnInsert: { clientId: client._id, type: "NEW_CLIENT", title: "New Client Registered", message: `${client.name || client.email || "A new user"} has registered as a new client.`, sourceKey: `client-registration:${client._id}`, isRead: false, createdAt: client.createdAt || new Date(), updatedAt: client.createdAt || new Date() } },
      upsert: true,
    },
  })), { ordered: false });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dueTasks = await FollowUpTask.find({ assignedEmployeeId: { $ne: null }, followUpAt: { $lt: tomorrow }, status: { $nin: ["COMPLETED", "CANCELLED"] } }).populate("clientId", "name email").lean();
  if (dueTasks.length) await AdminNotification.bulkWrite(dueTasks.map((task) => {
    const overdue = task.followUpAt < now;
    return { updateOne: { filter: { sourceKey: `follow-up-${overdue ? "overdue" : "due"}:${task._id}:${new Date().toISOString().slice(0, 10)}` }, update: { $setOnInsert: { recipientUserId: task.assignedEmployeeId, clientId: task.clientId?._id, followUpId: task._id, type: overdue ? "FOLLOW_UP_OVERDUE" : "FOLLOW_UP_DUE", title: overdue ? "Follow-Up Overdue" : "Follow-Up Due", message: `Follow-up with ${task.clientId?.name || task.clientId?.email || "client"} ${overdue ? "is overdue" : "is due soon"}.`, sourceKey: `follow-up-${overdue ? "overdue" : "due"}:${task._id}:${new Date().toISOString().slice(0, 10)}`, isRead: false } }, upsert: true } };
  }), { ordered: false });
}

clientManagementRouter.get("/employees/options", permit("clients"), asyncHandler(async (_req, res) => {
  const employees = await User.find({ isAdmin: true, adminRole: "employee", isActive: { $ne: false }, isBlocked: { $ne: true } }).select("name email").sort({ name: 1 });
  sendResponse(res, { data: employees });
}));

clientManagementRouter.get("/clients", permit("clients"), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
  const userMatch = { isAdmin: { $ne: true } };
  const search = String(req.query.search || "").trim();
  if (search) userMatch.$or = ["name", "email", "mobile"].map((key) => ({ [key]: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }));
  if (req.query.loginType) userMatch.loginProvider = req.query.loginType;
  if (req.query.course) userMatch.examMode = req.query.course;
  if (req.query.registeredFrom || req.query.registeredTo) userMatch.createdAt = {
    ...(req.query.registeredFrom ? { $gte: new Date(req.query.registeredFrom) } : {}),
    ...(req.query.registeredTo ? { $lte: new Date(`${req.query.registeredTo}T23:59:59.999Z`) } : {}),
  };
  let users = await User.find(userMatch).select("name email mobile loginProvider examMode createdAt isActive isBlocked isPremium premiumPlan premiumExpiresAt").sort({ createdAt: -1 }).lean();
  const ids = users.map((user) => user._id);
  const profiles = await ClientProfile.find({ clientId: { $in: ids }, ...clientScope(req.admin) }).populate("assignedEmployeeId", "name email").lean();
  const profileMap = new Map(profiles.map((profile) => [String(profile.clientId), profile]));
  if (!canViewAll(req.admin)) users = users.filter((user) => profileMap.has(String(user._id)));
  if (req.query.assignedEmployeeId) users = users.filter((user) => String(profileMap.get(String(user._id))?.assignedEmployeeId?._id || "") === req.query.assignedEmployeeId);
  if (req.query.followUpEnabled !== undefined && req.query.followUpEnabled !== "") users = users.filter((user) => (profileMap.get(String(user._id))?.followUpEnabled ?? true) === (req.query.followUpEnabled === "true"));
  const filteredTotal = users.length;
  users = users.slice((page - 1) * limit, page * limit);
  const visibleIds = users.map((user) => user._id);
  const summaries = await FollowUpTask.aggregate([
    { $match: { clientId: { $in: visibleIds } } },
    { $group: { _id: "$clientId", total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } }, lastFollowUpAt: { $max: "$followUpAt" } } },
  ]);
  const summaryMap = new Map(summaries.map((item) => [String(item._id), item]));
  const latest = await FollowUpTask.find({ clientId: { $in: visibleIds } }).sort({ followUpAt: -1 }).populate("assignedEmployeeId", "name").lean();
  const latestMap = new Map(); latest.forEach((item) => { if (!latestMap.has(String(item.clientId))) latestMap.set(String(item.clientId), item); });
  const data = users.map((user) => ({ ...user, id: String(user._id), profile: profileMap.get(String(user._id)) || { followUpEnabled: true }, summary: summaryMap.get(String(user._id)) || { total: 0, completed: 0, cancelled: 0 }, latestFollowUp: latestMap.get(String(user._id)) || null }));
  sendResponse(res, { data, meta: { page, limit, total: filteredTotal, pages: Math.ceil(filteredTotal / limit) } });
}));

clientManagementRouter.get("/clients/:id", permit("clients"), asyncHandler(async (req, res) => {
  const client = await User.findOne({ _id: req.params.id, isAdmin: { $ne: true } }).select("-passwordHash").lean();
  if (!client) throw new AppError("Client not found", 404);
  const profile = await ClientProfile.findOne({ clientId: client._id }).populate("assignedEmployeeId", "name email").lean();
  if (!canViewAll(req.admin) && String(profile?.assignedEmployeeId?._id || "") !== String(req.admin._id)) throw new AppError("This client is not assigned to you", 403);
  const followUps = await FollowUpTask.find({ clientId: client._id }).sort({ followUpAt: -1 }).populate("assignedEmployeeId createdBy updatedBy", "name email").lean();
  const auditLogs = await ClientAuditLog.find({ clientId: client._id }).sort({ createdAt: -1 }).limit(200).lean();
  sendResponse(res, { data: { client: { ...client, id: String(client._id) }, profile: profile || { followUpEnabled: true }, followUps, auditLogs } });
}));

clientManagementRouter.put("/clients/:id/settings", permit("clients", "edit"), asyncHandler(async (req, res) => {
  const body = z.object({ followUpEnabled: z.boolean().optional(), assignedEmployeeId: objectId.nullish(), clientStatus: z.enum(["ACTIVE", "INACTIVE", "CONVERTED", "DO_NOT_CONTACT"]).optional() }).parse(req.body);
  const previous = await ClientProfile.findOne({ clientId: req.params.id }).lean();
  const profile = await ClientProfile.findOneAndUpdate({ clientId: req.params.id }, { $set: body }, { upsert: true, new: true, runValidators: true }).populate("assignedEmployeeId", "name email");
  await audit(req, req.params.id, "CLIENT_SETTINGS_UPDATED", previous, profile.toObject());
  if (body.assignedEmployeeId && body.assignedEmployeeId !== String(previous?.assignedEmployeeId || "")) {
    const client = await User.findById(req.params.id).select("name email").lean();
    await notify({ recipientUserId: body.assignedEmployeeId, clientId: req.params.id, type: "CLIENT_ASSIGNED", title: "New Client Assigned", message: `${client?.name || client?.email || "A client"} has been assigned to you.`, sourceKey: `client-assigned:${req.params.id}:${body.assignedEmployeeId}:${Date.now()}` });
  }
  sendResponse(res, { data: profile, message: "Client settings updated" });
}));

clientManagementRouter.get("/follow-ups", permit("follow-ups"), asyncHandler(async (req, res) => {
  const query = { ...clientScope(req.admin) };
  if (req.query.status) query.status = req.query.status;
  if (req.query.employeeId && canViewAll(req.admin)) query.assignedEmployeeId = req.query.employeeId;
  if (req.query.communicationType) query.communicationType = req.query.communicationType;
  const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  if (req.query.date === "today") query.followUpAt = { $gte: start, $lt: end };
  if (req.query.date === "upcoming") query.followUpAt = { $gte: end };
  if (req.query.date === "overdue") { query.followUpAt = { $lt: now }; query.status = { $nin: ["COMPLETED", "CANCELLED"] }; }
  const tasks = await FollowUpTask.find(query).sort({ followUpAt: 1 }).populate("clientId", "name email mobile examMode").populate("assignedEmployeeId", "name email").populate("createdBy", "name").lean();
  const enabledProfiles = await ClientProfile.find({ clientId: { $in: tasks.map((task) => task.clientId?._id).filter(Boolean) }, followUpEnabled: { $ne: false } }).distinct("clientId");
  const enabled = new Set(enabledProfiles.map(String));
  const data = tasks.filter((task) => enabled.has(String(task.clientId?._id)));
  const all = await FollowUpTask.find(clientScope(req.admin)).select("status followUpAt").lean();
  const stats = { total: all.length, notStarted: 0, inProgress: 0, completed: 0, cancelled: 0, pending: 0, today: 0, overdue: 0 };
  all.forEach((task) => { const key = { NOT_STARTED: "notStarted", IN_PROGRESS: "inProgress", COMPLETED: "completed", CANCELLED: "cancelled" }[task.status] || "pending"; stats[key] += 1; if (task.followUpAt >= start && task.followUpAt < end) stats.today += 1; if (task.followUpAt < now && !["COMPLETED", "CANCELLED"].includes(task.status)) stats.overdue += 1; });
  sendResponse(res, { data, meta: { stats } });
}));

clientManagementRouter.post("/follow-ups", permit("follow-ups", "create"), asyncHandler(async (req, res) => {
  const body = taskBody.parse(req.body);
  const client = await User.findOne({ _id: body.clientId, isAdmin: { $ne: true } }).select("name email").lean();
  if (!client) throw new AppError("The selected client no longer exists", 404);
  if (body.assignedEmployeeId) {
    const employee = await User.exists({ _id: body.assignedEmployeeId, isAdmin: true, adminRole: "employee", isActive: { $ne: false }, isBlocked: { $ne: true } });
    if (!employee) throw new AppError("Please select an active employee", 400);
  }
  const profile = await ClientProfile.findOneAndUpdate({ clientId: body.clientId }, { $setOnInsert: { followUpEnabled: true }, ...(body.assignedEmployeeId ? { $set: { assignedEmployeeId: body.assignedEmployeeId } } : {}) }, { upsert: true, new: true });
  if (profile.followUpEnabled === false) throw new AppError("Follow-up is disabled for this client", 409);
  const task = await FollowUpTask.create({ ...body, assignedEmployeeId: body.assignedEmployeeId || profile.assignedEmployeeId || null, createdBy: req.admin._id, updatedBy: req.admin._id });
  await audit(req, body.clientId, "FOLLOW_UP_CREATED", null, task.toObject(), task._id);
  if (task.assignedEmployeeId) await notify({ recipientUserId: task.assignedEmployeeId, clientId: body.clientId, followUpId: task._id, type: "FOLLOW_UP_ASSIGNED", title: "New Follow-Up Assigned", message: `New follow-up assigned for ${client.name || client.email || "client"}.`, sourceKey: `follow-up-assigned:${task._id}:${task.assignedEmployeeId}` });
  sendResponse(res, { status: 201, data: task, message: "Follow-up created" });
}));

clientManagementRouter.put("/follow-ups/:id", permit("follow-ups", "edit"), asyncHandler(async (req, res) => {
  const task = await FollowUpTask.findById(req.params.id); if (!task) throw new AppError("Follow-up not found", 404);
  if (!canViewAll(req.admin) && String(task.assignedEmployeeId) !== String(req.admin._id)) throw new AppError("This follow-up is not assigned to you", 403);
  const previous = task.toObject(); const body = taskBody.partial().omit({ clientId: true }).parse(req.body);
  Object.assign(task, body, { updatedBy: req.admin._id }); await task.save(); await audit(req, task.clientId, "FOLLOW_UP_UPDATED", previous, task.toObject(), task._id);
  if (body.status === "COMPLETED") await notify({ recipientUserId: null, clientId: task.clientId, followUpId: task._id, type: "FOLLOW_UP_COMPLETED", title: "Follow-Up Completed", message: "A client follow-up has been completed.", sourceKey: `follow-up-completed:${task._id}` });
  sendResponse(res, { data: task, message: "Follow-up updated" });
}));

clientManagementRouter.delete("/follow-ups/:id", permit("follow-ups", "delete"), asyncHandler(async (req, res) => {
  const task = await FollowUpTask.findById(req.params.id); if (!task) throw new AppError("Follow-up not found", 404);
  await audit(req, task.clientId, "FOLLOW_UP_DELETED", task.toObject(), null, task._id); await task.deleteOne();
  sendResponse(res, { message: "Follow-up deleted" });
}));

clientManagementRouter.get("/crm-notifications", asyncHandler(async (req, res) => {
  await ensureRegistrationNotifications();
  const recipient = isMainAdmin(req.admin) ? { $in: [null, req.admin._id] } : req.admin._id;
  const data = await AdminNotification.find({ recipientUserId: recipient }).sort({ createdAt: -1 }).limit(100).populate("clientId", "name email").lean();
  sendResponse(res, { data });
}));
clientManagementRouter.get("/crm-notifications/unread-count", asyncHandler(async (req, res) => {
  await ensureRegistrationNotifications(); const recipient = isMainAdmin(req.admin) ? { $in: [null, req.admin._id] } : req.admin._id;
  sendResponse(res, { data: { count: await AdminNotification.countDocuments({ recipientUserId: recipient, isRead: false }) } });
}));
clientManagementRouter.put("/crm-notifications/read-all", asyncHandler(async (req, res) => {
  const recipient = isMainAdmin(req.admin) ? { $in: [null, req.admin._id] } : req.admin._id; await AdminNotification.updateMany({ recipientUserId: recipient, isRead: false }, { $set: { isRead: true, readAt: new Date() } }); sendResponse(res, { message: "Notifications marked as read" });
}));
clientManagementRouter.put("/crm-notifications/:id/read", asyncHandler(async (req, res) => {
  const recipient = isMainAdmin(req.admin) ? { $in: [null, req.admin._id] } : req.admin._id; const item = await AdminNotification.findOneAndUpdate({ _id: req.params.id, recipientUserId: recipient }, { $set: { isRead: true, readAt: new Date() } }, { new: true }); if (!item) throw new AppError("Notification not found", 404); sendResponse(res, { data: item });
}));
