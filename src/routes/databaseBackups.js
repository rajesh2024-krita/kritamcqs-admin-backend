import crypto from "node:crypto";
import { Router } from "express";
import { DatabaseOperation } from "../models/index.js";
import { requireAdmin, requireMainAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { verifyPassword } from "../utils/password.js";
import { getBackupSchedule, queueBackup, queueRestore, resolveBackup, updateBackupSchedule } from "../services/databaseBackupService.js";

export const databaseBackupsRouter = Router();
const restoreAuthorizations = new Map();

databaseBackupsRouter.use(requireAdmin, requireMainAdmin);

function requirePassword(req) {
  const password = String(req.body?.password || "");
  if (!password) throw new AppError("Admin password is required", 401);
  if (!verifyPassword(password, req.admin?.passwordHash)) throw new AppError("Admin password verification failed", 403);
}

function cleanExpiredAuthorizations() {
  const now = Date.now();
  for (const [token, value] of restoreAuthorizations) if (value.expiresAt <= now) restoreAuthorizations.delete(token);
}

databaseBackupsRouter.get("/database-backups", asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const operations = await DatabaseOperation.find().sort({ startedAt: -1 }).limit(limit);
  const schedule = await getBackupSchedule();
  res.json({ success: true, data: operations, schedule });
}));

databaseBackupsRouter.patch("/database-backups/settings", asyncHandler(async (req, res) => {
  if (typeof req.body?.automaticEnabled !== "boolean") throw new AppError("automaticEnabled must be true or false", 400);
  const settings = await updateBackupSchedule({ automaticEnabled: req.body.automaticEnabled, actor: req.admin });
  const schedule = await getBackupSchedule();
  res.json({ success: true, data: settings, schedule, message: `Automatic backups ${settings.automaticEnabled ? "enabled" : "disabled"}` });
}));

databaseBackupsRouter.post("/database-backups", asyncHandler(async (req, res) => {
  requirePassword(req);
  if (req.body?.confirmed !== true) throw new AppError("Backup confirmation is required", 400);
  void queueBackup({ type: "manual", actor: req.admin }).catch((error) => console.error("Manual database backup failed to start", error.message));
  res.status(202).json({ success: true, message: "Manual backup queued" });
}));

databaseBackupsRouter.post("/database-backups/:id/download", asyncHandler(async (req, res) => {
  requirePassword(req);
  const { backup, resolved } = await resolveBackup(req.params.id);
  res.download(resolved, backup.fileName);
}));

databaseBackupsRouter.post("/database-backups/:id/restore-authorization", asyncHandler(async (req, res) => {
  requirePassword(req);
  if (req.body?.confirmed !== true) throw new AppError("Restore confirmation is required", 400);
  await resolveBackup(req.params.id);
  cleanExpiredAuthorizations();
  const token = crypto.randomBytes(32).toString("base64url");
  restoreAuthorizations.set(token, {
    backupId: req.params.id, adminId: req.admin._id.toString(), expiresAt: Date.now() + 5 * 60 * 1000,
  });
  res.json({ success: true, data: { token, expiresInSeconds: 300 }, message: "Password verified; final confirmation required" });
}));

databaseBackupsRouter.post("/database-backups/:id/restore", asyncHandler(async (req, res) => {
  cleanExpiredAuthorizations();
  if (req.body?.finalConfirmation !== true) throw new AppError("Final restore confirmation is required", 400);
  const token = String(req.body?.authorizationToken || "");
  const authorization = restoreAuthorizations.get(token);
  restoreAuthorizations.delete(token);
  if (!authorization || authorization.backupId !== req.params.id || authorization.adminId !== req.admin._id.toString()) {
    throw new AppError("Restore authorization is invalid or expired", 403);
  }
  void queueRestore({ backupId: req.params.id, actor: req.admin }).catch((error) => console.error("Database restore failed to start", error.message));
  res.status(202).json({ success: true, message: "Database restore queued" });
}));
