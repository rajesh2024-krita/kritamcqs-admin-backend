import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import { AdminActivityLog, ThirdPartyScript } from "../models/index.js";

function normalizeScriptCode(value) {
  return String(value || "").replace(/\u0000/g, "").trim();
}

function actor(admin) {
  return {
    employeeId: admin?._id,
    employeeName: admin?.name || "Administrator",
    employeeEmail: admin?.email || "",
  };
}

async function audit(action, previousValue, updatedValue, admin) {
  await AdminActivityLog.create({
    ...actor(admin),
    action: action === "delete" ? "delete" : action === "create" ? "create" : "edit",
    previousValue,
    updatedValue: { ...(updatedValue || {}), featureAction: action },
  }).catch((error) => console.error("[AUDIT] Failed to write script activity", error));
}

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid script id", 400);
}

function sanitizePayload(body = {}, existing = {}) {
  const payload = {
    scriptName: body.scriptName !== undefined ? String(body.scriptName || "").trim() : existing.scriptName,
    description: body.description !== undefined ? String(body.description || "").trim() : existing.description,
    scriptType: body.scriptType !== undefined ? String(body.scriptType || "Custom").trim() : existing.scriptType,
    scriptCode: body.scriptCode !== undefined ? normalizeScriptCode(body.scriptCode) : existing.scriptCode,
    platform: body.platform !== undefined ? String(body.platform || "All").trim() : existing.platform,
    loadPosition: body.loadPosition !== undefined ? String(body.loadPosition || "Body End").trim() : existing.loadPosition,
    priority: body.priority !== undefined ? Number(body.priority || 0) : Number(existing.priority || 100),
    status: body.status !== undefined ? String(body.status || "disabled").trim() : existing.status || "disabled",
  };
  if (!payload.scriptName) throw new AppError("Script Name is required", 400);
  if (!payload.scriptCode) throw new AppError("Script Code is required", 400);
  return payload;
}

export const scriptManagementService = {
  async list(query = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
    const search = String(query.search || "").trim();
    const sortBy = ["scriptName", "platform", "scriptType", "status", "priority", "updatedAt", "createdAt"].includes(query.sortBy)
      ? query.sortBy
      : "updatedAt";
    const sortOrder = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
    const filter = {};
    if (query.status && query.status !== "all") filter.status = String(query.status);
    if (query.platform && query.platform !== "all") filter.platform = String(query.platform);
    if (query.scriptType && query.scriptType !== "all") filter.scriptType = String(query.scriptType);
    if (search) {
      filter.$or = [
        { scriptName: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
        { scriptType: new RegExp(search, "i") },
      ];
    }
    const [items, total] = await Promise.all([
      ThirdPartyScript.find(filter).sort({ [sortBy]: sortOrder, priority: 1 }).skip((page - 1) * limit).limit(limit),
      ThirdPartyScript.countDocuments(filter),
    ]);
    return { items, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async getById(id) {
    assertObjectId(id);
    const item = await ThirdPartyScript.findById(id);
    if (!item) throw new AppError("Script not found", 404);
    return item;
  },

  async create(body, admin) {
    const payload = sanitizePayload(body);
    payload.createdBy = admin?._id;
    payload.updatedBy = admin?._id;
    try {
      const item = await ThirdPartyScript.create(payload);
      await audit("Created", null, item.toObject(), admin);
      return item;
    } catch (error) {
      if (error?.code === 11000) throw new AppError("A script with this name already exists", 409);
      throw error;
    }
  },

  async update(id, body, admin) {
    assertObjectId(id);
    const existing = await ThirdPartyScript.findById(id);
    if (!existing) throw new AppError("Script not found", 404);
    const previous = existing.toObject();
    Object.assign(existing, sanitizePayload(body, existing), { updatedBy: admin?._id });
    try {
      await existing.save();
      await audit("Updated", previous, existing.toObject(), admin);
      return existing;
    } catch (error) {
      if (error?.code === 11000) throw new AppError("A script with this name already exists", 409);
      throw error;
    }
  },

  async remove(id, admin) {
    const item = await this.getById(id);
    const previous = item.toObject();
    await item.deleteOne();
    await audit("Deleted", previous, null, admin);
  },

  async setStatus(id, status, admin) {
    if (!["enabled", "disabled"].includes(status)) throw new AppError("Status must be enabled or disabled", 400);
    const item = await this.getById(id);
    const previous = item.toObject();
    item.status = status;
    item.updatedBy = admin?._id;
    await item.save();
    await audit(status === "enabled" ? "Enabled" : "Disabled", previous, item.toObject(), admin);
    return item;
  },

  async duplicate(id, admin) {
    const item = await this.getById(id);
    const source = item.toObject();
    delete source._id;
    delete source.id;
    delete source.createdAt;
    delete source.updatedAt;
    const name = `${source.scriptName} Copy`;
    source.scriptName = name;
    source.status = "disabled";
    source.createdBy = admin?._id;
    source.updatedBy = admin?._id;
    let suffix = 2;
    while (await ThirdPartyScript.exists({ scriptName: source.scriptName }).collation({ locale: "en", strength: 2 })) {
      source.scriptName = `${name} ${suffix}`;
      suffix += 1;
    }
    const created = await ThirdPartyScript.create(source);
    await audit("Duplicated", item.toObject(), created.toObject(), admin);
    return created;
  },
};
