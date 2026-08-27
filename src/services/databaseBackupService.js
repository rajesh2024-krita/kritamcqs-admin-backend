import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { DatabaseOperation } from "../models/index.js";
import { AppError } from "../utils/AppError.js";

const execFileAsync = promisify(execFile);
const METADATA_COLLECTION = "databaseoperations";
let activeOperation = null;
let schedulerTimer = null;

function backupRoot() {
  return path.resolve(env.databaseBackupDir);
}

function safeError(error) {
  return String(error?.stderr || error?.message || error || "Unknown database tool error")
    .replaceAll(env.mongoUri, "[REDACTED_MONGODB_URI]")
    .slice(0, 4000);
}

function archiveName(prefix, date = new Date()) {
  return `${prefix}-${date.toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${crypto.randomBytes(4).toString("hex")}.archive.gz`;
}

async function runTool(binary, args) {
  return execFileAsync(binary, args, { maxBuffer: 10 * 1024 * 1024, windowsHide: true });
}

async function createOperation(type, actor = null) {
  return DatabaseOperation.create({
    kind: "backup",
    backupType: type,
    status: "in_progress",
    startedAt: new Date(),
    createdById: actor?._id,
    createdByName: actor?.name || actor?.username || actor?.email || (type === "automatic" ? "System" : "Admin"),
    eventMessage: `${type[0].toUpperCase()}${type.slice(1)} backup started`,
  });
}

export async function createBackup({ type = "manual", actor = null } = {}) {
  if (activeOperation) throw new AppError("Another database backup or restore is already in progress", 409);
  const operation = await createOperation(type, actor);
  activeOperation = operation.id;
  const fileName = archiveName(type);
  const filePath = path.join(backupRoot(), fileName);
  try {
    await fs.mkdir(backupRoot(), { recursive: true, mode: 0o700 });
    await runTool(env.mongoDumpBinary, [
      `--uri=${env.mongoUri}`,
      `--archive=${filePath}`,
      "--gzip",
      `--excludeCollection=${METADATA_COLLECTION}`,
    ]);
    const stats = await fs.stat(filePath);
    const completedAt = new Date();
    await DatabaseOperation.findByIdAndUpdate(operation._id, {
      status: "completed", completedAt, durationMs: completedAt - operation.startedAt,
      sizeBytes: stats.size, fileName, filePath, eventMessage: `${type} backup completed`,
    });
    if (type !== "safety") await enforceRetention();
  } catch (error) {
    await fs.unlink(filePath).catch(() => undefined);
    const completedAt = new Date();
    await DatabaseOperation.findByIdAndUpdate(operation._id, {
      status: "failed", completedAt, durationMs: completedAt - operation.startedAt,
      errorDetails: safeError(error), eventMessage: `${type} backup failed`,
    });
  } finally {
    activeOperation = null;
  }
  return DatabaseOperation.findById(operation._id);
}

export async function enforceRetention() {
  const cutoff = new Date(Date.now() - env.databaseBackupRetentionDays * 86400000);
  const expired = await DatabaseOperation.find({
    kind: "backup", backupType: { $in: ["automatic", "manual"] }, status: "completed", completedAt: { $lt: cutoff },
  });
  for (const item of expired) {
    if (item.filePath) await fs.unlink(item.filePath).catch(() => undefined);
    await DatabaseOperation.deleteOne({ _id: item._id });
  }
}

export async function resolveBackup(id) {
  const backup = await DatabaseOperation.findOne({ _id: id, kind: "backup", status: "completed" });
  if (!backup?.filePath) throw new AppError("Backup is not available", 404);
  const resolved = path.resolve(backup.filePath);
  const root = `${backupRoot()}${path.sep}`;
  if (!resolved.startsWith(root)) throw new AppError("Invalid backup file reference", 400);
  await fs.access(resolved).catch(() => { throw new AppError("Backup file is missing", 404); });
  return { backup, resolved };
}

export async function restoreBackup({ backupId, actor }) {
  if (activeOperation) throw new AppError("Another database backup or restore is already in progress", 409);
  const { backup, resolved } = await resolveBackup(backupId);
  const operation = await DatabaseOperation.create({
    kind: "restore", status: "in_progress", startedAt: new Date(), sourceBackupId: backup._id,
    createdById: actor?._id, createdByName: actor?.name || actor?.username || actor?.email || "Admin",
    eventMessage: `Restore from ${backup.fileName} started`,
  });
  activeOperation = operation.id;
  try {
    // Capture the current live state before any collection is replaced.
    activeOperation = null;
    const safety = await createBackup({ type: "safety", actor });
    activeOperation = operation.id;
    if (safety.status !== "completed") throw new Error(`Safety backup failed: ${safety.errorDetails}`);
    await DatabaseOperation.findByIdAndUpdate(operation._id, { safetyBackupId: safety._id });
    await runTool(env.mongoRestoreBinary, [
      `--uri=${env.mongoUri}`, `--archive=${resolved}`, "--gzip", "--drop",
      `--nsExclude=${mongoose.connection.name}.${METADATA_COLLECTION}`,
    ]);
    const completedAt = new Date();
    await DatabaseOperation.findByIdAndUpdate(operation._id, {
      status: "completed", completedAt, durationMs: completedAt - operation.startedAt,
      eventMessage: `Restore from ${backup.fileName} completed`,
    });
  } catch (error) {
    const completedAt = new Date();
    await DatabaseOperation.findByIdAndUpdate(operation._id, {
      status: "failed", completedAt, durationMs: completedAt - operation.startedAt,
      errorDetails: safeError(error), eventMessage: `Restore from ${backup.fileName} failed`,
    });
  } finally {
    activeOperation = null;
  }
  return DatabaseOperation.findById(operation._id);
}

export function queueBackup(options) {
  return new Promise((resolve, reject) => setImmediate(() => createBackup(options).then(resolve, reject)));
}

export function queueRestore(options) {
  return new Promise((resolve, reject) => setImmediate(() => restoreBackup(options).then(resolve, reject)));
}

export function startDatabaseBackupScheduler() {
  if (!env.databaseBackupEnabled || schedulerTimer) return;
  const tick = async () => {
    const now = new Date();
    if (now.getUTCHours() !== env.databaseBackupHourUtc || activeOperation) return;
    const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
    const exists = await DatabaseOperation.exists({ kind: "backup", backupType: "automatic", startedAt: { $gte: start } });
    if (!exists) void createBackup({ type: "automatic" }).catch((error) => console.error("Automatic database backup failed to start", safeError(error)));
  };
  void tick();
  schedulerTimer = setInterval(() => void tick(), 5 * 60 * 1000);
  schedulerTimer.unref?.();
}
