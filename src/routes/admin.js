import { Router } from "express";
import mongoose from "mongoose";
import { createCrudController } from "../controllers/crudController.js";
import { dashboardController } from "../controllers/dashboardController.js";
import { requireAdmin } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  Chapter,
  ChapterPerformance,
  AuthSettings,
  Topic,
  Coupon,
  DailyAssignment,
  DailyTest,
  DailyTestAnalytics,
  DailyTestSettings,
  DailyPlanConfig,
  Difficulty,
  FreeQuestionConfig,
  EmailLog,
  EmailTemplate,
  ExamType,
  ExamMarkingSettings,
  Invoice,
  InvoiceSettings,
  LearningSession,
  LearningLevel,
  Mistake,
  MockTest,
  Mode,
  NotificationSettings,
  PaymentGatewaySettings,
  Question,
  QuestionAttempt,
  QuestionType,
  RevisionAnalytics,
  RevisionSettings,
  SessionAttempt,
  Subject,
  Subscription,
  SubscriptionPlan,
  SupportTicket,
  Test,
  User,
  UserNotification,
  Year,
} from "../models/index.js";
import { userInsightsController } from "../controllers/userInsightsController.js";
import { createCrudService } from "../services/crudService.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/apiResponse.js";
import { hashPassword } from "../utils/password.js";
import { bulkDeleteSchema, createSchemas, listQuerySchema, updateSchemas } from "../validators/crudValidators.js";
import { upload } from "../middlewares/upload.js";
import { z } from "zod";
import { questionBulkUploadService } from "../services/questionBulkUploadService.js";
import { oldUserMigrationService } from "../services/oldUserMigrationService.js";
import { buildPublicUploadPath, ensureDir, questionUploadsRoot, sanitizeFileName, uploadsRoot } from "../utils/uploadStorage.js";
import { sendEmail } from "../utils/simpleEmail.js";
import {
  COMMON_EMAIL_VARIABLES,
  EMAIL_TEMPLATE_DEFINITIONS,
  EMAIL_TEMPLATE_KEYS,
  buildDefaultTemplate,
} from "../utils/templatedEmail.js";
import fs from "fs/promises";
import { accessSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import crypto from "crypto";
import puppeteer from "puppeteer";
import { env } from "../config/env.js";
import {
  deriveExamType,
  normalizeQuestionExamFields,
  isQuestionModeCompatible,
} from "../utils/examStructure.js";
import { ownQuestionAssetUrl } from "../utils/questionAssetOwner.js";

const router = Router();
router.use(requireAdmin);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromeLinuxDepsCommand = "npm run setup:chrome-deps";
const invoiceRenderViewportWidth = Math.max(600, Math.min(1800, Number(process.env.INVOICE_RENDER_WIDTH || 840)));
const invoiceRenderScale = Math.max(1, Math.min(3, Number(process.env.INVOICE_RENDER_SCALE || 2)));
const invoiceRenderTimeoutMs = Math.max(30000, Math.min(180000, Number(process.env.INVOICE_RENDER_TIMEOUT_MS || 90000)));
const invoiceAssetTimeoutMs = Math.max(3000, Math.min(30000, Number(process.env.INVOICE_ASSET_TIMEOUT_MS || 10000)));

function renderTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => String(values[key] ?? ""));
}

function sampleEmailVariables(overrides = {}) {
  const now = new Date();
  return {
    user_name: "Test User",
    email: "test@example.com",
    mobile: "+91 98765 43210",
    app_name: "Krita",
    company_name: "Krita NEET JEE",
    customer_name: "Test User",
    support_email: "support@krita.com",
    invoice_number: "INV-TEST-001",
    invoice_date: now.toLocaleDateString("en-IN"),
    due_date: now.toLocaleDateString("en-IN"),
    payment_amount: "₹1,000.00",
    invoice_amount: "₹1,000.00",
    tax_amount: "₹180.00",
    convenience_fee: "₹20.00",
    convenience_fee_gst: "₹3.60",
    total_amount: "₹1,203.60",
    payment_status: "PAID",
    transaction_id: "TXN-123456",
    otp: "123456",
    otp_code: "123456",
    otp_expiry: "10 minutes",
    expiry_date: now.toLocaleDateString("en-IN"),
    expiry_type: "Subscription",
    days_before: "7",
    plan_name: "Premium Plan",
    ticket_id: "SUP-TEST-001",
    ticket_category: "Account Help",
    ticket_status: "Open",
    ticket_message: "This is a sample support ticket update.",
    admin_email: "admin@example.com",
    announcement_title: "New Announcement",
    announcement_message: "This is a sample announcement message.",
    update_title: "Product Update",
    update_message: "A new platform update is ready.",
    offer_title: "Special Offer",
    offer_code: "SAVE20",
    offer_discount: "20%",
    notification_title: "Reminder",
    notification_message: "This is a sample notification.",
    current_date: now.toLocaleDateString("en-IN"),
    current_time: now.toLocaleTimeString("en-IN"),
    ...overrides,
  };
}

function buildDefaultHtmlBody(textContent) {
  const text = String(textContent || "").trim();
  const safeText = text
    ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br/>")
    : "This email contains no HTML content.";
  return `<html><body><div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.5;">${safeText}</div></body></html>`;
}

async function sendTemplatedEmail(templateKey, to, variables, attachments = []) {
  const template = await EmailTemplate.findOne({ key: templateKey });
  const settings = await InvoiceSettings.findOne({ key: "default" });
  const definition = EMAIL_TEMPLATE_DEFINITIONS.find((item) => item.key === templateKey);
  const mergedData = sampleEmailVariables({ ...(template?.sampleData || {}), ...(variables || {}) });

  if (!template || template.isActive === false) {
    const reason = !template ? `Email template '${templateKey}' is missing` : `Email template '${templateKey}' is inactive`;
    const log = await EmailLog.create({
      templateKey,
      templateName: template?.name || definition?.name || templateKey,
      module: template?.module || definition?.module || "",
      to,
      subject: template?.subject || definition?.name || templateKey,
      status: "skipped",
      attempts: 0,
      error: reason,
      payload: mergedData,
    });
    console.warn(`[EMAIL] ${reason}. Skipping send to ${to}`);
    return { skipped: true, reason, logId: String(log._id) };
  }

  if (settings?.emailEnabled === false) {
    const reason = "Email delivery is disabled in invoice/email settings";
    const log = await EmailLog.create({
      templateKey,
      templateName: template.name,
      module: template.module || template.type,
      to,
      subject: template.subject,
      status: "skipped",
      attempts: 0,
      error: reason,
      payload: mergedData,
    });
    return { skipped: true, reason, logId: String(log._id) };
  }

  const subject = renderTemplate(template.subject, mergedData);
  const textContent = renderTemplate(template.textContent, mergedData);
  const htmlContent = renderTemplate(template.htmlContent, mergedData);
  const htmlBody = htmlContent.trim() || buildDefaultHtmlBody(textContent);

  console.log(
    `[EMAIL] Sending template: ${templateKey} | To: ${to} | Subject: ${subject} | Variables: ${Object.keys(variables || {}).join(", ")} | htmlLength=${htmlBody.length}`
  );

  const log = await EmailLog.create({
    templateKey,
    templateName: template.name,
    module: template.module || template.type,
    to,
    subject,
    status: "pending",
    attempts: 0,
    payload: mergedData,
  });

  try {
    const result = await sendEmail({
      smtp: settings?.smtp,
      to,
      subject,
      html: htmlBody,
      attachments,
    });

    log.attempts += 1;
    log.lastAttemptAt = new Date();
    log.status = result.skipped ? "skipped" : "sent";
    log.error = result.skipped ? result.reason || "" : "";
    log.sentAt = result.skipped ? undefined : new Date();
    await log.save();

    if (result.skipped) {
      console.warn(`[EMAIL] Email skipped for ${templateKey}: ${result.reason}`);
    } else {
      console.info(`[EMAIL] Email sent successfully for ${templateKey} to ${to} (LogId: ${log._id})`);
    }

    return { ...result, logId: String(log._id) };
  } catch (error) {
    log.attempts += 1;
    log.lastAttemptAt = new Date();
    log.status = "failed";
    log.error = error instanceof Error ? error.message : String(error);
    await log.save();
    console.error(`[EMAIL] Email send failed for ${templateKey}: ${log.error}`);
    throw error;
  }
}

async function truncateUserData(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new AppError("Invalid user id", 400);
  }

  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  const objectId = new mongoose.Types.ObjectId(userId);
  const userDataFilter = { userId: { $in: [String(userId), objectId] } };
  const deletionTasks = [
    ["Chapter Performance", ChapterPerformance.collection.deleteMany(userDataFilter)],
    ["Daily Assignments", DailyAssignment.collection.deleteMany(userDataFilter)],
    ["Daily Tests", DailyTest.collection.deleteMany(userDataFilter)],
    ["Invoices", Invoice.collection.deleteMany(userDataFilter)],
    ["Learning Sessions", LearningSession.collection.deleteMany(userDataFilter)],
    ["Mistakes", Mistake.collection.deleteMany(userDataFilter)],
    ["Question Attempts", QuestionAttempt.collection.deleteMany(userDataFilter)],
    ["Session Attempts", SessionAttempt.collection.deleteMany(userDataFilter)],
    ["Subscriptions", Subscription.collection.deleteMany(userDataFilter)],
    ["Support Tickets", SupportTicket.collection.deleteMany(userDataFilter)],
    ["Tests", Test.collection.deleteMany(userDataFilter)],
    ["Notifications", UserNotification.collection.deleteMany(userDataFilter)],
  ];

  const results = await Promise.all(deletionTasks.map(async ([label, task]) => {
    const result = await task;
    return { label, deletedCount: Number(result.deletedCount || 0) };
  }));

  const analyticsResult = await DailyTestAnalytics.updateMany(
    { "topPerformingUsers.userId": String(userId) },
    { $pull: { topPerformingUsers: { userId: String(userId) } } },
  );

  await User.findByIdAndUpdate(userId, {
    $set: {
      onboardingComplete: false,
      requiresProfileCompletion: false,
      isPremium: false,
    },
    $unset: {
      examMode: "",
      level: "",
      premiumExpiresAt: "",
      lastPurchase: "",
      lastLoginAt: "",
    },
  });

  return {
    userId: String(userId),
    deleted: results,
    analyticsUpdatedCount: Number(analyticsResult.modifiedCount || 0),
    totalDeletedCount: results.reduce((total, item) => total + item.deletedCount, 0),
  };
}

const defaultInvoiceFields = [
  { id: "invoiceNumber", label: "Invoice # {{invoiceNumber}}", x: 48, y: 118, size: 10, enabled: true },
  { id: "issuedAt", label: "Issued: {{issuedAt}}", x: 48, y: 134, size: 10, enabled: true },
  { id: "customer", label: "Bill To: {{userName}}", x: 48, y: 166, size: 11, enabled: true },
  { id: "email", label: "Email: {{userEmail}}", x: 48, y: 182, size: 10, enabled: true },
  { id: "paidStamp", label: "{{paidStampText}}", x: 430, y: 120, size: 30, enabled: true },
];

const defaultExpiryReminders = [10, 5, 2, 0].map((daysBefore) => ({
  daysBefore,
  enabled: true,
  title: daysBefore === 0 ? "Premium expires today" : `Premium expires in ${daysBefore} days`,
  body:
    daysBefore === 0
      ? "Your premium plan expires today. Renew to keep unlimited access."
      : `Your premium plan expires in ${daysBefore} days. Renew to keep unlimited access.`,
  emailSubject: daysBefore === 0 ? "Your Krita Premium expires today" : `Your Krita Premium expires in ${daysBefore} days`,
  emailBody:
    daysBefore === 0
      ? "Hi {{userName}}, your premium plan expires today. Renew to continue uninterrupted access."
      : "Hi {{userName}}, your premium plan expires in {{daysBefore}} days. Renew to continue uninterrupted access.",
}));

async function getInvoiceSettingsDoc() {
  return InvoiceSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", fields: defaultInvoiceFields } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function getNotificationSettingsDoc() {
  return NotificationSettings.findOneAndUpdate(
    { key: "subscription-expiry" },
    { $setOnInsert: { key: "subscription-expiry", reminders: defaultExpiryReminders } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

function replaceTokens(template, data) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_match, key) => String(data[key] ?? ""));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escPdf(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function textOp(text, x, y, size = 10) {
  return `BT /F1 ${size} Tf ${x} ${842 - y} Td (${escPdf(text)}) Tj ET`;
}

function textStyleOp(raw = {}) {
  const bold = String(raw.fontWeight || "").toLowerCase() === "bold" || Number(raw.fontWeight || 0) >= 600;
  const italic = String(raw.fontStyle || "").toLowerCase() === "italic";
  if (bold && italic) return "/F4";
  if (bold) return "/F2";
  if (italic) return "/F3";
  return "/F1";
}

function hexToRgb(value, fallback = [0, 0, 0]) {
  const hex = String(value || "").trim();
  const match = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return fallback;
  const raw = match[1];
  return [parseInt(raw.slice(0, 2), 16) / 255, parseInt(raw.slice(2, 4), 16) / 255, parseInt(raw.slice(4, 6), 16) / 255];
}

function colorOp(fill = "#000000", stroke = fill) {
  const [fr, fg, fb] = hexToRgb(fill);
  const [sr, sg, sb] = hexToRgb(stroke, [fr, fg, fb]);
  return `${fr.toFixed(3)} ${fg.toFixed(3)} ${fb.toFixed(3)} rg ${sr.toFixed(3)} ${sg.toFixed(3)} ${sb.toFixed(3)} RG`;
}

function coloredTextOp(text, x, y, size = 10, color = "#000000") {
  return `${colorOp(color)} ${textOp(text, x, y, size)} 0 0 0 rg 0 0 0 RG`;
}

function styledTextOp(text, x, y, size = 10, color = "#000000", raw = {}) {
  const angle = Number(raw.angle || 0);
  const font = textStyleOp(raw);
  const safeText = escPdf(text);
  const drawText = angle
    ? `BT ${font} ${size} Tf ${angleMatrix(angle, x, 842 - y)} Tm (${safeText}) Tj ET`
    : `BT ${font} ${size} Tf ${x} ${842 - y} Td (${safeText}) Tj ET`;
  return `${colorOp(color)} ${drawText} 0 0 0 rg 0 0 0 RG`;
}

function angleMatrix(degrees, x = 0, y = 0) {
  const radians = (Number(degrees || 0) * Math.PI) / 180;
  const cos = Math.cos(radians).toFixed(6);
  const sin = Math.sin(radians).toFixed(6);
  return `${cos} ${sin} ${(-Math.sin(radians)).toFixed(6)} ${cos} ${x} ${y}`;
}

function lineOp(x1, y1, x2, y2) {
  return `${x1} ${842 - y1} m ${x2} ${842 - y2} l S`;
}

function rectOp(x, y, width, height) {
  return `${x} ${842 - y - height} ${width} ${height} re S`;
}

function fillRectOp(x, y, width, height, shade = 0.94) {
  return `${shade} g ${x} ${842 - y - height} ${width} ${height} re f 0 g`;
}

function colorRectOp(x, y, width, height, fill = "#ffffff", stroke = "#000000", strokeWidth = 0) {
  const draw = Number(strokeWidth || 0) > 0 ? "B" : "f";
  return `${colorOp(fill, stroke)} ${Number(strokeWidth || 0)} w ${x} ${842 - y - height} ${width} ${height} re ${draw} 0 0 0 rg 0 0 0 RG 1 w`;
}

function rotateOp(inner, x, y, angle = 0) {
  if (!Number(angle)) return inner;
  const radians = (Number(angle) * Math.PI) / 180;
  const cos = Math.cos(radians).toFixed(6);
  const sin = Math.sin(radians).toFixed(6);
  const px = Number(x || 0);
  const py = 842 - Number(y || 0);
  return `q 1 0 0 1 ${px} ${py} cm ${cos} ${sin} ${(-Math.sin(radians)).toFixed(6)} ${cos} 0 0 cm 1 0 0 1 ${-px} ${-py} cm ${inner} Q`;
}

function rotateCenterOp(inner, x, y, width, height, angle = 0) {
  return rotateOp(inner, x + width / 2, y + height / 2, angle);
}

function colorCircleOp(x, y, radius, fill = "#ffffff", stroke = "#000000", strokeWidth = 0) {
  const c = 0.5522847498;
  const cx = x + radius;
  const cy = 842 - (y + radius);
  const r = radius;
  const draw = Number(strokeWidth || 0) > 0 ? "B" : "f";
  return `${colorOp(fill, stroke)} ${Number(strokeWidth || 0)} w ${cx + r} ${cy} m ${cx + r} ${cy + c * r} ${cx + c * r} ${cy + r} ${cx} ${cy + r} c ${cx - c * r} ${cy + r} ${cx - r} ${cy + c * r} ${cx - r} ${cy} c ${cx - r} ${cy - c * r} ${cx - c * r} ${cy - r} ${cx} ${cy - r} c ${cx + c * r} ${cy - r} ${cx + r} ${cy - c * r} ${cx + r} ${cy} c ${draw} 0 0 0 rg 0 0 0 RG 1 w`;
}

function colorTriangleOp(x, y, width, height, fill = "#ffffff", stroke = "#000000", strokeWidth = 0) {
  const draw = Number(strokeWidth || 0) > 0 ? "B" : "f";
  return `${colorOp(fill, stroke)} ${Number(strokeWidth || 0)} w ${x + width / 2} ${842 - y} m ${x + width} ${842 - y - height} l ${x} ${842 - y - height} l h ${draw} 0 0 0 rg 0 0 0 RG 1 w`;
}

function textLines(text, x, y, size = 10, lineHeight = 14) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => textOp(line, x, y + index * lineHeight, size));
}

function pageMetricsFromFields(fields) {
  const first = fields.find((field) => field?.raw?.pageWidth && field?.raw?.pageHeight);
  const pageWidth = Number(first?.raw?.pageWidth || 794);
  const pageHeight = Number(first?.raw?.pageHeight || 1123);
  return {
    scaleX: 595 / pageWidth,
    scaleY: 842 / pageHeight,
    pageLeft: 0,
    pageTop: 0,
  };
}

function imageSizeFromJpeg(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function imageFromDataUrl(src, width, height) {
  const match = String(src || "").match(/^data:image\/jpe?g;base64,(.+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  const size = imageSizeFromJpeg(buffer) || { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  return { buffer, width: size.width, height: size.height };
}

function imageOp(name, x, y, width, height) {
  return `q ${width} 0 0 ${height} ${x} ${842 - y - height} cm /${name} Do Q`;
}

function invoiceTemplates(settings) {
  return Array.isArray(settings?.reusableBlocks)
    ? settings.reusableBlocks.filter((item) => item?.type === "fabric-template")
    : [];
}

function connectedInvoiceTemplate(settings) {
  const templates = invoiceTemplates(settings);
  return templates.find((item) => String(item.id) === String(settings?.connectedTemplateId || "") && item.connected)
    || templates.find((item) => item.connected)
    || null;
}

function requireConnectedInvoiceTemplate(settings) {
  const template = connectedInvoiceTemplate(settings);
  if (!template || !String(template.htmlCode || "").trim() || !String(template.cssCode || "").trim()) {
    throw new AppError("No invoice template is connected to email. Connect an Invoice Editor template before sending invoice emails.", 400);
  }
  return template;
}

function settingsWithInvoiceTemplate(settings, invoice = {}, options = {}) {
  const source = typeof settings?.toJSON === "function" ? settings.toJSON() : { ...(settings || {}) };
  const templates = invoiceTemplates(source);
  const emailTemplate = options.requireConnectedTemplate ? requireConnectedInvoiceTemplate(source) : connectedInvoiceTemplate(source);
  const invoiceTemplate = invoice?.templateId
    ? templates.find((item) => String(item.id) === String(invoice.templateId))
    : null;
  const activeTemplate = templates.find((item) => item.active) || templates.find((item) => String(item.id) === String(source.activeTemplateId));
  const active = emailTemplate || invoiceTemplate || activeTemplate || templates[0];
  if (Array.isArray(active?.fields) && active.fields.length) {
    return {
      ...source,
      fields: active.fields,
      activeTemplateId: active.id || source.activeTemplateId,
      activeTemplateName: active.name || source.activeTemplateName,
      activeTemplateHtmlCode: active.htmlCode || "",
      activeTemplateCssCode: active.cssCode || "",
    };
  }
  return {
    ...source,
    activeTemplateId: active?.id || source.activeTemplateId,
    activeTemplateName: active?.name || source.activeTemplateName,
    activeTemplateHtmlCode: active?.htmlCode || "",
    activeTemplateCssCode: active?.cssCode || "",
  };
}

function fieldGeometry(field, metrics) {
  const raw = field.raw || field;
  const hasNormalized = Number.isFinite(Number(raw.pageX)) && Number.isFinite(Number(raw.pageY));
  const x = Number(field.x ?? (hasNormalized ? Number(raw.pageX || 0) * metrics.scaleX : (Number(raw.left || 0) - metrics.pageLeft) * metrics.scaleX));
  const y = Number(field.y ?? (hasNormalized ? Number(raw.pageY || 0) * metrics.scaleY : (Number(raw.top || 0) - metrics.pageTop) * metrics.scaleY));
  const width = Number(field.width ?? ((raw.scaledWidth ?? Number(raw.width || 80) * Number(raw.scaleX ?? 1)) * metrics.scaleX));
  const height = Number(field.height ?? ((raw.scaledHeight ?? Number(raw.height || 30) * Number(raw.scaleY ?? 1)) * metrics.scaleY));
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function drawInvoiceTable(field, data, metrics) {
  const raw = field.raw || field;
  const meta = raw.invoiceTable || field.invoiceTable;
  if (!meta) return [];
  const { x, y, width, height } = fieldGeometry(field, metrics);
  const cols = Math.max(1, Number(meta.cols || meta.headers?.length || 1));
  const rows = Math.max(1, Number(meta.rows || 1));
  const style = {
    borderColor: "#cbd5e1",
    borderWidth: 0.5,
    borderStyle: "solid",
    headerBackground: "#0f172a",
    headerTextColor: "#ffffff",
    bodyTextColor: "#334155",
    bodyBackground: "#ffffff",
    alternateRowBackground: "#f8fafc",
    useAlternateRows: false,
    padding: 6,
    ...(meta.style || {}),
  };
  const rowHeights = Array.from({ length: rows }).map((_, index) => Number(meta.rowHeights?.[index] || height / rows));
  const rowTotal = rowHeights.reduce((sum, value) => sum + value, 0) || 1;
  const scaledRows = rowHeights.map((value) => (value / rowTotal) * height);
  const colWidths = Array.from({ length: cols }).map((_, index) => Number(meta.colWidths?.[index] || width / cols));
  const colTotal = colWidths.reduce((sum, value) => sum + value, 0) || 1;
  const scaledCols = colWidths.map((value) => (value / colTotal) * width);
  const headers = Array.from({ length: cols }).map((_, index) => meta.headers?.[index] || `Column ${index + 1}`);
  const cells = Array.isArray(meta.cells) ? meta.cells : [];
  const ops = [];
  const borderWidth = Number(style.borderWidth || 0);

  let currentX = x;
  headers.forEach((header, index) => {
    const colWidth = scaledCols[index];
    ops.push(colorRectOp(currentX, y, colWidth, scaledRows[0], style.headerBackground, style.borderColor, borderWidth));
    ops.push(styledTextOp(replaceTokens(header, data), currentX + Number(style.padding || 0), y + scaledRows[0] / 2 + 4, Math.max(4, scaledRows[0] * 0.32), style.headerTextColor, { fontWeight: "bold" }));
    currentX += colWidth;
  });

  let currentY = y + scaledRows[0];
  for (let row = 1; row < rows; row += 1) {
    currentX = x;
    for (let col = 0; col < cols; col += 1) {
      const value = cells[row - 1]?.[col] ?? "";
      const colWidth = scaledCols[col];
      const fill = meta.rowColors?.[row] || meta.colColors?.[col] || (style.useAlternateRows && row % 2 === 0 ? style.alternateRowBackground : style.bodyBackground);
      ops.push(colorRectOp(currentX, currentY, colWidth, scaledRows[row], fill, style.borderColor, borderWidth));
      ops.push(styledTextOp(replaceTokens(value, data), currentX + Number(style.padding || 0), currentY + scaledRows[row] / 2 + 4, Math.max(4, scaledRows[row] * 0.3), style.bodyTextColor, {}));
      currentX += colWidth;
    }
    currentY += scaledRows[row];
  }
  return Number(raw.angle || 0) ? [rotateCenterOp(ops.join("\n"), x, y, width, height, raw.angle)] : ops;
}

function drawFieldObject(field, data, metrics, offsetX = 0, offsetY = 0, images = []) {
  const raw = field.raw || field;
  const type = String(raw.type || field.type || "").toLowerCase();
  const geometry = fieldGeometry(field, metrics);
  const x = geometry.x + offsetX;
  const y = geometry.y + offsetY;
  const width = geometry.width;
  const height = geometry.height;
  const fill = raw.fill || field.style?.fill || field.style?.color || "#111827";
  const stroke = raw.stroke || field.style?.stroke || "#000000";
  const strokeWidth = Number(raw.strokeWidth ?? field.style?.strokeWidth ?? 0);
  const ops = [];

  if ((type === "group" || type === "table") && (raw.invoiceTable || field.invoiceTable)) {
    ops.push(...drawInvoiceTable(field, data, metrics));
  } else if (type === "text" || type === "i-text") {
    const content = replaceTokens(raw.text || field.content || field.label || "", data);
    const fontSize = Math.max(1, Number(field.size ?? (Number(raw.fontSize || 10) * metrics.scaleY)));
    ops.push(...String(content).split(/\r?\n/).flatMap((line, index) => styledTextOp(line, x, y + index * (fontSize + 4), fontSize, fill, raw)));
  } else if (type === "rect") {
    ops.push(rotateCenterOp(colorRectOp(x, y, width, height, fill, stroke, strokeWidth), x, y, width, height, raw.angle));
  } else if (type === "circle") {
    ops.push(rotateCenterOp(colorCircleOp(x, y, Math.max(1, Math.min(width, height) / 2), fill, stroke, strokeWidth), x, y, width, height, raw.angle));
  } else if (type === "triangle") {
    ops.push(rotateCenterOp(colorTriangleOp(x, y, width, height, fill, stroke, strokeWidth), x, y, width, height, raw.angle));
  } else if (type === "group" && Array.isArray(raw.objects)) {
    raw.objects.forEach((child) => {
      const childWidth = Math.max(1, Number(child.width || 40) * Number(child.scaleX ?? 1) * metrics.scaleX);
      const childHeight = Math.max(1, Number(child.height || 20) * Number(child.scaleY ?? 1) * metrics.scaleY);
      const childField = {
        ...field,
        raw: child,
        x: x + (Number(child.left || 0) + Number(raw.width || 0) / 2) * metrics.scaleX,
        y: y + (Number(child.top || 0) + Number(raw.height || 0) / 2) * metrics.scaleY,
        width: childWidth,
        height: childHeight,
        size: Math.max(1, Number(child.fontSize || 10) * metrics.scaleY),
      };
      ops.push(...drawFieldObject(childField, data, metrics, 0, 0, images));
    });
  } else if (type === "image") {
    const image = imageFromDataUrl(raw.src || field.src, width, height);
    if (image) {
      const name = `Im${images.length + 1}`;
      images.push({ name, ...image });
      ops.push(rotateCenterOp(imageOp(name, x, y, width, height), x, y, width, height, raw.angle));
    }
  }

  return ops;
}

function buildPdf(lines, images = []) {
  const objects = [];
  const add = (value) => {
    objects.push(value);
    return objects.length;
  };
  const content = lines.join("\n");
  const addStream = (dict, buffer) => add({
    dict: `<< ${dict} /Length ${buffer.length} >>`,
    stream: buffer,
  });
  const contentId = addStream("", Buffer.from(content, "utf8"));
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const italicFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>");
  const boldItalicFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>");
  const imageIds = images.map((image) => addStream(
    `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
    image.buffer,
  ));
  const xObjectResources = imageIds.length
    ? ` /XObject << ${images.map((image, index) => `/${image.name} ${imageIds[index]} 0 R`).join(" ")} >>`
    : "";
  const pageId = objects.length + 1;
  const pagesId = pageId + 1;
  add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R /F3 ${italicFontId} 0 R /F4 ${boldItalicFontId} 0 R >>${xObjectResources} >> /Contents ${contentId} 0 R >>`);
  add(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const chunks = [Buffer.from("%PDF-1.4\n", "utf8")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "utf8"));
    if (typeof object === "string") {
      chunks.push(Buffer.from(`${object}\n`, "utf8"));
    } else {
      chunks.push(Buffer.from(`${object.dict}\nstream\n`, "utf8"), object.stream, Buffer.from("\nendstream\n", "utf8"));
    }
    chunks.push(Buffer.from("endobj\n", "utf8"));
  });
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, "utf8"));
  offsets.slice(1).forEach((offset) => chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "utf8")));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`, "utf8"));
  return Buffer.concat(chunks);
}

function invoiceData(input = {}) {
  const firstItem = Array.isArray(input.items) ? input.items[0] || {} : {};
  const formatCurrency = (value) => `${input.currency || "INR"} ${Number(value || 0).toFixed(2)}`;
  const convenienceCharge = Number(input.convenienceCharge || 0);
  const convenienceChargeGst = Number(input.convenienceChargeGst || 0);
  const totalCharges = convenienceCharge + convenienceChargeGst;
  const configuredChargeGstPercent = Number(input.taxDetails?.convenienceChargeGstPercent ?? 0);
  const derivedChargeGstPercent = convenienceCharge > 0 && convenienceChargeGst > 0
    ? (convenienceChargeGst / convenienceCharge) * 100
    : 0;
  const displayChargeGstPercent = configuredChargeGstPercent > 0
    ? configuredChargeGstPercent
    : Math.abs(derivedChargeGstPercent - Math.round(derivedChargeGstPercent)) < 0.1
      ? Math.round(derivedChargeGstPercent)
      : Number(derivedChargeGstPercent.toFixed(2));
  return {
    invoiceNumber: input.invoiceNumber || "",
    invoice_number: input.invoiceNumber || "",
    invoiceDate: input.invoiceDate ? new Date(input.invoiceDate).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN"),
    invoice_date: input.invoiceDate ? new Date(input.invoiceDate).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN"),
    dueDate: input.dueDate ? new Date(input.dueDate).toLocaleDateString("en-IN") : "",
    due_date: input.dueDate ? new Date(input.dueDate).toLocaleDateString("en-IN") : "",
    userName: input.userName || input.customerCompany?.name || "Customer",
    customer_name: input.customerCompany?.name || input.userName || "Customer",
    userEmail: input.userEmail || input.customerCompany?.email || "",
    customer_email: input.customerCompany?.email || input.userEmail || "",
    userMobile: input.userMobile || input.customerCompany?.phone || "",
    customer_phone: input.customerCompany?.phone || input.userMobile || "",
    customerAddress: input.customerCompany?.address || "",
    customer_address: input.customerCompany?.address || "",
    customerGstin: input.customerCompany?.gstin || "",
    planName: input.planName || input.planId || firstItem.product || "Premium Subscription",
    productDescription: firstItem.description || "Premium subscription purchase",
    description: firstItem.description || firstItem.product || "Premium subscription purchase",
    quantity: firstItem.quantity || 1,
    item_quantity: firstItem.quantity || 1,
    item_amount: formatCurrency(firstItem.price ?? input.subtotal ?? input.amount),
    planAmount: formatCurrency(input.subtotal ?? firstItem.price ?? input.amount),
    baseAmount: formatCurrency(input.subtotal ?? firstItem.price ?? input.amount),
    base_amount: formatCurrency(input.subtotal ?? firstItem.price ?? input.amount),
    discountAmount: formatCurrency(input.discountTotal || 0),
    discount_amount: formatCurrency(input.discountTotal || 0),
    discount: formatCurrency(input.discountTotal || 0),
    taxPercent: Number(input.taxDetails?.taxPercent ?? firstItem.tax ?? 0),
    tax_rate: `${Number(input.taxDetails?.taxPercent ?? firstItem.tax ?? 0)}%`,
    gst_rate: `${Number(input.taxDetails?.taxPercent ?? firstItem.tax ?? 0)}%`,
    taxAmount: formatCurrency(input.taxTotal || 0),
    tax_amount: formatCurrency(input.taxTotal || 0),
    gst: formatCurrency(input.taxTotal || 0),
    convenienceCharge: formatCurrency(convenienceCharge),
    convenience_charge: formatCurrency(convenienceCharge),
    platform_charge: formatCurrency(convenienceCharge),
    convenienceChargeGstPercent: displayChargeGstPercent,
    convenienceChargeGst: formatCurrency(convenienceChargeGst),
    convenience_charge_gst: formatCurrency(convenienceChargeGst),
    platform_charge_gst: formatCurrency(convenienceChargeGst),
    totalCharges: formatCurrency(totalCharges),
    total_charges: formatCurrency(totalCharges),
    finalAmount: formatCurrency(input.grandTotal || input.amount),
    amount: formatCurrency(input.amount || input.grandTotal),
    totalAmount: formatCurrency(input.grandTotal || input.amount),
    total_amount: formatCurrency(input.grandTotal || input.amount),
    total: formatCurrency(input.grandTotal || input.amount),
    subtotal: formatCurrency(input.subtotal ?? firstItem.price ?? input.amount),
    currency: input.currency || "INR",
    paymentStatus: String(input.status || "paid").toUpperCase(),
    transactionId: input.transactionId || "",
    transaction_id: input.transactionId || "",
    paidStampText: input.paidStampText || "PAID",
    company_name: input.billingCompany?.name || input.companyName || "Krita NEET JEE",
    company_address: input.billingCompany?.address || input.companyAddress || "",
    company_email: input.billingCompany?.email || input.companyEmail || "",
    company_phone: input.billingCompany?.phone || input.companyPhone || "",
    payment_terms: input.terms || "Net 15 Days",
    notes: input.notes || "Thank you for your business!",
  };
}

function getActiveInvoiceTemplate(settings) {
  const templates = invoiceTemplates(settings);
  return templates.find((item) => item.active) || templates[0] || null;
}

function localUploadUrl(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/uploads/")) return raw;
  return pathToFileURL(path.join(uploadsRoot, raw.replace(/^\/uploads\/?/, ""))).href;
}

function absoluteRequestUrl(req, publicPath) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");
  const base = String(process.env.PUBLIC_API_BASE_URL || `${protocol}://${host}`).replace(/\/+$/, "");
  return `${base}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
}

function invoiceAssetFileName(file) {
  const mimeExt = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
  };
  const baseName = sanitizeFileName(file?.originalname || "invoice-image.png");
  const dotIndex = baseName.lastIndexOf(".");
  const ext = mimeExt[file?.mimetype] || (dotIndex > 0 ? baseName.slice(dotIndex) : ".png");
  const name = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  return `${name || "invoice-image"}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}

function existingFile(candidate) {
  if (!candidate) return "";
  try {
    accessSync(candidate);
    return candidate;
  } catch {
    return "";
  }
}

function puppeteerExecutablePath() {
  try {
    return puppeteer.executablePath();
  } catch {
    return "";
  }
}

function puppeteerCacheExecutables() {
  const roots = [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(os.homedir(), ".cache", "puppeteer"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "puppeteer") : "",
  ].filter(Boolean);
  const executables = [];
  for (const root of roots) {
    const chromeRoot = path.join(root, "chrome");
    let versions = [];
    try {
      versions = readdirSync(chromeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
    } catch {
      continue;
    }
    for (const version of versions) {
      executables.push(
        path.join(chromeRoot, version, "chrome-win64", "chrome.exe"),
        path.join(chromeRoot, version, "chrome-win", "chrome.exe"),
        path.join(chromeRoot, version, "chrome-linux64", "chrome"),
        path.join(chromeRoot, version, "chrome-linux", "chrome"),
        path.join(chromeRoot, version, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(chromeRoot, version, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(chromeRoot, version, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      );
    }
  }
  return executables;
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    puppeteerExecutablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Puppeteer bundled Chromium paths
    path.join(backendRoot, "node_modules", "puppeteer", ".local-chromium", "win64-1290181", "chrome-win", "chrome.exe"),
    path.join(backendRoot, "node_modules", "puppeteer", ".local-chromium", "mac-1290181", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    path.join(backendRoot, "node_modules", "puppeteer", ".local-chromium", "linux-1290181", "chrome-linux", "chrome"),
    ...puppeteerCacheExecutables(),
  ].filter(Boolean);
  return candidates.map(existingFile).find(Boolean) || "";
}

function chromeLaunchArgs() {
  return [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "--no-zygote",
    "--font-render-hinting=medium",
    "--allow-file-access-from-files",
  ];
}

function chromeLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  const output = `${message}\n${stderr}`;
  if (/error while loading shared libraries|cannot open shared object file|libatk-1\.0\.so\.0|libnss3\.so|libgbm\.so|libxss\.so|libgtk-3\.so/i.test(output)) {
    return new AppError(
      `Chrome was found but cannot start because Linux system libraries are missing. Run ${chromeLinuxDepsCommand} on the backend server, then restart the backend.`,
      500,
    );
  }
  return new AppError(`Chrome failed while rendering the invoice PDF: ${message}`, 500);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForInvoiceAssets(page) {
  const result = await withTimeout(
    page.evaluate(async (assetTimeout) => {
      const timed = (promise, timeout) => Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve("timeout"), timeout)),
      ]);
      const fontStatus = document.fonts?.ready
        ? await timed(document.fonts.ready.then(() => "loaded").catch(() => "error"), assetTimeout)
        : "unsupported";
      const images = Array.from(document.images || []);
      const imageResults = await Promise.all(images.map((image) => {
        if (image.complete) return Promise.resolve(image.naturalWidth > 0 ? "loaded" : "error");
        return timed(new Promise((resolve) => {
          image.addEventListener("load", () => resolve("loaded"), { once: true });
          image.addEventListener("error", () => resolve("error"), { once: true });
        }), assetTimeout);
      }));
      return {
        fonts: fontStatus,
        images: {
          total: images.length,
          loaded: imageResults.filter((item) => item === "loaded").length,
          timedOut: imageResults.filter((item) => item === "timeout").length,
          failed: imageResults.filter((item) => item === "error").length,
        },
      };
    }, invoiceAssetTimeoutMs),
    invoiceAssetTimeoutMs + 1000,
    { fonts: "timeout", images: { total: 0, loaded: 0, timedOut: 0, failed: 0 } },
  );
  await wait(150);
  return result;
}

async function captureInvoiceImage(page) {
  const metrics = await page.evaluate(() => {
    const body = document.body;
    const element = document.documentElement;
    const width = Math.ceil(Math.max(body.scrollWidth, body.offsetWidth, element.clientWidth, element.scrollWidth, element.offsetWidth));
    const height = Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, element.clientHeight, element.scrollHeight, element.offsetHeight));
    return { width, height };
  });
  const width = Math.max(1, Math.min(2400, metrics.width || invoiceRenderViewportWidth));
  const height = Math.max(1, Math.min(12000, metrics.height || 1200));
  await page.setViewport({ width, height: Math.min(height, 4096), deviceScaleFactor: invoiceRenderScale });
  const image = await page.screenshot({
    type: "jpeg",
    quality: 94,
    fullPage: true,
    omitBackground: false,
  });
  return { image, width, height };
}

function buildImagePdf(image, width, height) {
  const imageBuffer = Buffer.from(image);
  const imageSize = imageSizeFromJpeg(imageBuffer) || { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const pageWidth = Math.max(1, Math.round(width));
  const pageHeight = Math.max(1, Math.round(height));
  const objects = [];
  const add = (value) => {
    objects.push(value);
    return objects.length;
  };
  const addStream = (dict, stream) => add({ dict: `<< ${dict} /Length ${stream.length} >>`, stream });
  const imageId = addStream(`/Type /XObject /Subtype /Image /Width ${imageSize.width} /Height ${imageSize.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, imageBuffer);
  const content = Buffer.from(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im1 Do Q`, "utf8");
  const contentId = addStream("", content);
  const pageId = objects.length + 1;
  const pagesId = pageId + 1;
  add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  add(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const catalogId = add("<< /Type /Catalog /Pages " + pagesId + " 0 R >>");
  const chunks = [Buffer.from("%PDF-1.4\n", "utf8")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "utf8"));
    if (typeof object === "string") {
      chunks.push(Buffer.from(`${object}\n`, "utf8"));
    } else {
      chunks.push(Buffer.from(`${object.dict}\nstream\n`, "utf8"), object.stream, Buffer.from("\nendstream\n", "utf8"));
    }
    chunks.push(Buffer.from("endobj\n", "utf8"));
  });
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, "utf8"));
  offsets.slice(1).forEach((offset) => chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "utf8")));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`, "utf8"));
  return Buffer.concat(chunks);
}

async function renderHtmlImageToPdf(html, invoiceNumber) {
  const executable = chromeExecutable();
  if (!executable) {
    throw new AppError("Chrome/Edge is required on the admin backend to render Invoice Editor HTML/CSS PDFs. Set CHROME_PATH or install Chrome.", 500);
  }
  let browser;
  try {
    console.info(`[INVOICE_PDF] Rendering invoice ${invoiceNumber || "invoice"} via Puppeteer image-to-PDF. executable=${executable}`);
    browser = await puppeteer.launch({
      executablePath: executable,
      headless: "new",
      args: chromeLaunchArgs(),
      timeout: invoiceRenderTimeoutMs,
      protocolTimeout: invoiceRenderTimeoutMs,
    });
    const page = await browser.newPage();
    const failedAssets = [];
    page.on("requestfailed", (request) => {
      failedAssets.push({ url: request.url(), error: request.failure()?.errorText || "request failed" });
    });
    page.on("pageerror", (pageError) => {
      console.warn(`[INVOICE_PDF] Page script error for invoice ${invoiceNumber || "invoice"}: ${pageError.message}`);
    });
    page.setDefaultTimeout(invoiceRenderTimeoutMs);
    page.setDefaultNavigationTimeout(invoiceRenderTimeoutMs);
    await page.setCacheEnabled(false);
    await page.setViewport({ width: invoiceRenderViewportWidth, height: 1200, deviceScaleFactor: invoiceRenderScale });
    await page.emulateMediaType("screen");
    try {
      await page.setContent(html, { waitUntil: ["domcontentloaded", "load"], timeout: invoiceRenderTimeoutMs });
    } catch (error) {
      console.warn(`[INVOICE_PDF] Initial page load wait failed for invoice ${invoiceNumber || "invoice"}; continuing with current DOM.`, error instanceof Error ? error.message : String(error));
    }
    const assetStatus = await waitForInvoiceAssets(page);
    if (assetStatus.fonts === "timeout" || assetStatus.images.timedOut || assetStatus.images.failed) {
      console.warn(`[INVOICE_PDF] Invoice ${invoiceNumber || "invoice"} asset wait completed with warnings.`, assetStatus);
    }
    if (failedAssets.length) {
      console.warn(`[INVOICE_PDF] Invoice ${invoiceNumber || "invoice"} had ${failedAssets.length} failed asset request(s).`, failedAssets.slice(0, 5));
    }
    const { image, width, height } = await captureInvoiceImage(page);
    const pdf = buildImagePdf(image, width, height);
    console.info(`[INVOICE_PDF] Rendered invoice ${invoiceNumber || "invoice"} image=${width}x${height} imageBytes=${image.length} pdfBytes=${pdf.length}`);
    return pdf;
  } catch (error) {
    const appError = chromeLaunchError(error);
    console.error(`[INVOICE_PDF] Failed invoice ${invoiceNumber || "invoice"}: ${appError.message}`, {
      originalError: error instanceof Error ? error.message : String(error),
    });
    throw appError;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

function invoiceEditorData(source, effectiveSettings, data) {
  const currency = source.currency || "INR";
  const itemRows = (Array.isArray(source.items) ? source.items : []).map((item) => {
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const discount = Number(item.discount || 0);
    const taxable = Math.max(0, quantity * price - discount);
    const total = Number(item.total ?? taxable + (taxable * Number(item.tax || 0)) / 100);
    return {
      item_name: item.product || item.description || "Item",
      item_description: item.description || "",
      item_quantity: quantity || 0,
      item_price: `${currency} ${price.toFixed(2)}`,
      item_tax: `${Number(item.tax || 0)}%`,
      item_discount: `${currency} ${discount.toFixed(2)}`,
      item_total: `${currency} ${total.toFixed(2)}`,
    };
  });
  const itemsHtml = itemRows.map((item) =>
    `<tr><td>${escapeHtml(item.item_name)}</td><td>${escapeHtml(item.item_quantity)}</td><td>${escapeHtml(item.item_price)}</td><td>${escapeHtml(item.item_total)}</td></tr>`
  ).join("");
  return {
    ...data,
    invoice_number: data.invoice_number || source.invoiceNumber || "INV-DRAFT",
    customer_name: source.customerCompany?.name || source.userName || data.customer_name || "",
    customer_email: source.customerCompany?.email || source.userEmail || data.customer_email || "",
    customer_phone: source.customerCompany?.phone || source.userMobile || data.customer_phone || "",
    customer_address: source.customerCompany?.address || data.customer_address || "",
    invoice_date: data.invoice_date || data.invoiceDate || "",
    due_date: data.due_date || data.dueDate || "",
    description: data.description || source.items?.[0]?.description || source.items?.[0]?.product || "",
    quantity: data.quantity || source.items?.[0]?.quantity || 1,
    item_amount: data.item_amount || data.planAmount || `${currency} 0.00`,
    amount: data.amount || data.totalAmount || `${currency} 0.00`,
    company_name: source.billingCompany?.name || effectiveSettings.companyName || data.company_name || "Krita NEET JEE",
    company_address: source.billingCompany?.address || effectiveSettings.companyAddress || data.company_address || "",
    company_email: source.billingCompany?.email || effectiveSettings.companyEmail || data.company_email || "",
    company_phone: source.billingCompany?.phone || effectiveSettings.companyPhone || data.company_phone || "",
    company_logo: localUploadUrl(source.logoUrl || effectiveSettings.logoUrl || ""),
    items: itemsHtml,
    items_table: itemsHtml,
    subtotal: data.subtotal || data.baseAmount || `${currency} 0.00`,
    base_amount: data.base_amount || data.baseAmount || data.subtotal || `${currency} 0.00`,
    tax_rate: data.tax_rate || `${Number(source.taxDetails?.taxPercent ?? source.items?.[0]?.tax ?? 0)}%`,
    gst_rate: data.gst_rate || data.tax_rate || `${Number(source.taxDetails?.taxPercent ?? source.items?.[0]?.tax ?? 0)}%`,
    tax_amount: data.tax_amount || data.taxAmount || `${currency} 0.00`,
    gst: data.gst || data.tax_amount || data.taxAmount || `${currency} 0.00`,
    discount: data.discount || data.discountAmount || `${currency} 0.00`,
    discount_amount: data.discount_amount || data.discountAmount || data.discount || `${currency} 0.00`,
    transaction_id: data.transaction_id || source.transactionId || "",
    platform_charge: data.platform_charge || data.convenienceCharge || `${currency} 0.00`,
    platform_charge_gst: data.platform_charge_gst || data.convenienceChargeGst || `${currency} 0.00`,
    total_charges: data.total_charges || data.totalCharges || `${currency} 0.00`,
    total_amount: data.total_amount || data.totalAmount || `${currency} 0.00`,
    total: data.total || data.total_amount || data.totalAmount || `${currency} 0.00`,
    currency,
    payment_terms: source.terms || data.payment_terms || "Net 15 Days",
    notes: source.notes || data.notes || "Thank you for your business!",
    itemRows,
  };
}

function renderInvoiceEditorDocument(htmlCode, cssCode, source, effectiveSettings, data) {
  const previewData = invoiceEditorData(source, effectiveSettings, data);
  let processedHtml = String(htmlCode || "");
  let processedCss = String(cssCode || "");
  processedHtml = processedHtml.replace(/\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g, (_match, inner) =>
    previewData.itemRows.map((item) => inner.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (__match, key) => escapeHtml(item[key] ?? ""))).join("")
  );
  processedHtml = processedHtml.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_match, key) => (key === "items_table" ? previewData.items_table : previewData[key]) ?? "");
  processedCss = processedCss.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_match, key) => String(previewData[key] ?? ""));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}@page{size:A4;margin:0}body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;print-color-adjust:exact;-webkit-print-color-adjust:exact}${processedCss}</style></head><body>${processedHtml}</body></html>`;
}

async function renderInvoicePdf(invoice, settings, extras = {}, options = {}) {
  const source = { ...(typeof invoice?.toJSON === "function" ? invoice.toJSON() : invoice), ...extras };
  const effectiveSettings = settingsWithInvoiceTemplate(settings, source, options);
  const data = invoiceData({ ...source, paidStampText: effectiveSettings.paidStampText });
  if (String(effectiveSettings.activeTemplateHtmlCode || effectiveSettings.activeTemplateCssCode || "").trim()) {
    const html = renderInvoiceEditorDocument(
      effectiveSettings.activeTemplateHtmlCode,
      effectiveSettings.activeTemplateCssCode,
      source,
      effectiveSettings,
      data,
    );
    return renderHtmlImageToPdf(html, source.invoiceNumber || "invoice");
  }
  if (options.requireConnectedTemplate) {
    requireConnectedInvoiceTemplate(settings);
  }
  const mappedFields = Array.isArray(effectiveSettings.fields)
    ? effectiveSettings.fields.filter((field) => field?.enabled !== false && (field?.raw || String(field?.label || field?.content || "").trim()))
    : [];
  if (mappedFields.length) {
    const metrics = pageMetricsFromFields(mappedFields);
    const images = [];
    const content = [
      fillRectOp(0, 0, 595, 842, 1),
      ...mappedFields
        .sort((left, right) => Number(left.zIndex || 0) - Number(right.zIndex || 0))
        .flatMap((field) => drawFieldObject(field, data, metrics, 0, 0, images)),
    ];
    return buildPdf(content, images);
  }
  const items = Array.isArray(source.items) && source.items.length
    ? source.items
    : [{ product: data.planName, description: data.productDescription, quantity: data.quantity, price: source.amount, discount: 0, tax: 0, total: source.amount }];
  const companyLines = [effectiveSettings.companyName || "Krita NEET JEE", effectiveSettings.companyAddress, effectiveSettings.companyEmail, effectiveSettings.companyPhone].filter(Boolean);
  const customerLines = [
    source.customerCompany?.name || data.userName,
    source.customerCompany?.email || data.userEmail,
    source.customerCompany?.phone || data.userMobile,
    source.customerCompany?.address || data.customerAddress,
    source.customerCompany?.gstin ? `GSTIN: ${source.customerCompany.gstin}` : "",
  ].filter(Boolean);
  const content = [
    fillRectOp(0, 0, 595, 96, 0.97),
    ...textLines(companyLines.join("\n"), 42, 34, 10, 13),
    textOp(String(effectiveSettings.templateTitle || "Tax Invoice").toUpperCase(), 392, 34, 14),
    textOp("INVOICE", 392, 54, 30),
    lineOp(42, 112, 553, 112),
    textOp(`Invoice No: ${data.invoiceNumber || "-"}`, 42, 136, 10),
    textOp(`Invoice Date: ${data.invoiceDate || "-"}`, 42, 153, 10),
    textOp(`Due Date: ${data.dueDate || "-"}`, 42, 170, 10),
    textOp(`Status: ${data.paymentStatus || "-"}`, 392, 136, 10),
    textOp(`Transaction ID: ${data.transactionId || "-"}`, 392, 153, 10),
    textOp("Bill To", 42, 214, 13),
    rectOp(42, 226, 230, 88),
    ...textLines(customerLines.join("\n") || "Customer", 54, 246, 9, 13),
    textOp("Payment Summary", 332, 214, 13),
    rectOp(332, 226, 221, 88),
    textOp(`Subtotal: ${data.baseAmount}`, 344, 246, 9),
    textOp(`Discount: ${data.discountAmount}`, 344, 263, 9),
    textOp(`Tax: ${data.taxAmount}`, 344, 280, 9),
    textOp(`Convenience: ${data.convenienceCharge}`, 344, 297, 9),
    textOp(`GST on Charges: ${data.convenienceChargeGst}`, 344, 314, 9),
    textOp(`Total: ${data.totalAmount}`, 344, 334, 11),
    textOp(String(effectiveSettings.productDetailsTitle || "Product Details"), 42, 348, 13),
    fillRectOp(42, 362, 511, 24, 0.92),
    textOp("Item", 54, 378, 9),
    textOp("Qty", 300, 378, 9),
    textOp("Rate", 350, 378, 9),
    textOp("Discount", 418, 378, 9),
    textOp("Amount", 500, 378, 9),
  ];
  items.slice(0, 8).forEach((item, index) => {
    const y = 406 + index * 28;
    const amount = Number((item.total ?? (Number(item.quantity || 1) * Number(item.price || 0) - Number(item.discount || 0))) || 0);
    content.push(
      lineOp(42, y - 13, 553, y - 13),
      textOp(String(item.product || item.description || data.planName || "Item").slice(0, 45), 54, y, 9),
      textOp(String(item.quantity || 1), 304, y, 9),
      textOp(`${source.currency || "INR"} ${Number(item.price || 0).toFixed(2)}`, 350, y, 9),
      textOp(`${source.currency || "INR"} ${Number(item.discount || 0).toFixed(2)}`, 418, y, 9),
      textOp(`${source.currency || "INR"} ${amount.toFixed(2)}`, 500, y, 9),
    );
  });
  content.push(
    lineOp(42, 634, 553, 634),
    textOp(`Grand Total: ${data.totalAmount}`, 392, 662, 14),
    ...(source.notes ? [textOp("Notes", 42, 680, 11), ...textLines(source.notes, 42, 696, 9, 13)] : []),
    ...(source.terms ? [textOp("Terms", 42, 736, 11), ...textLines(source.terms, 42, 752, 9, 13)] : []),
    textOp(effectiveSettings.footerText || "This is a computer-generated invoice.", 42, 802, 8),
  );
  return buildPdf(content);
}

async function saveInvoicePdf(buffer, invoiceNumber) {
  const dir = path.join(uploadsRoot, "invoices");
  ensureDir(dir);
  const fileName = `${String(invoiceNumber || `INV-${Date.now()}`).replace(/[^a-z0-9_-]/gi, "-")}.pdf`;
  await fs.writeFile(path.join(dir, fileName), buffer);
  return `/uploads/invoices/${fileName}`;
}

async function regenerateInvoicePdf(invoice, settings = null, extras = {}, options = {}) {
  const resolvedSettings = settings || await getInvoiceSettingsDoc();
  const pdf = await renderInvoicePdf(invoice, resolvedSettings, extras, options);
  invoice.pdfPath = await saveInvoicePdf(pdf, invoice.invoiceNumber);
  return pdf;
}

function resolvePublicAssetUrl(publicPath) {
  const appAssetBaseUrl = String(env.appAssetBaseUrl || "").replace(/\/+$/, "");
  return appAssetBaseUrl ? `${appAssetBaseUrl}${publicPath}` : publicPath;
}

function inferImageExtensionFromUrl(urlValue, contentType = "") {
  const byMime = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
  };

  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalizedType && byMime[normalizedType]) return byMime[normalizedType];

  try {
    const parsed = new URL(String(urlValue || ""));
    const pathName = parsed.pathname || "";
    const dotIndex = pathName.lastIndexOf(".");
    if (dotIndex > -1) {
      const ext = pathName.slice(dotIndex).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"].includes(ext)) {
        return ext === ".jpeg" ? ".jpg" : ext;
      }
    }
  } catch {
    return ".jpg";
  }

  return ".jpg";
}

function normalizeImageSourceUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.startsWith("data:")) return value;
  if (value.startsWith("/uploads/")) return value;

  let normalized = value;
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  } else if (!/^[a-z]+:\/\//i.test(normalized) && /^www\./i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.includes("drive.google.com")) {
      const idFromQuery = parsed.searchParams.get("id");
      const idFromPath = (() => {
        const match = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
        return match?.[1] || "";
      })();
      const fileId = idFromQuery || idFromPath;
      if (fileId) {
        return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
      }
    }
    if (parsed.hostname.includes("dropbox.com")) {
      parsed.searchParams.set("raw", "1");
      parsed.searchParams.delete("dl");
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

async function fetchImageWithFallback(urlValue) {
  const firstUrl = normalizeImageSourceUrl(urlValue);
  const attempts = [firstUrl];
  if (/^https:\/\//i.test(firstUrl)) {
    attempts.push(firstUrl.replace(/^https:\/\//i, "http://"));
  }

  let lastError = null;
  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl, {
        redirect: "follow",
        headers: {
          "user-agent": "krita-question-asset-owner/1.0",
          "accept": "image/*,*/*;q=0.8",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to download image (${response.status})`);
      }
      return { response, finalUrl: attemptUrl };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to download image");
}

router.get("/stats", asyncHandler(dashboardController.stats));
router.get("/dashboard", asyncHandler(dashboardController.dashboard));
router.get("/catalog", asyncHandler(dashboardController.catalog));
router.get("/daily-test-analytics", asyncHandler(dashboardController.dailyTestAnalytics));
router.get("/users/:id/overview", asyncHandler(userInsightsController.overview));
router.post("/users/:id/truncate", asyncHandler(async (req, res) => {
  const result = await truncateUserData(req.params.id);
  sendResponse(res, {
    message: "User data truncated successfully",
    data: result,
  });
}));
router.post("/users/migration/preview", upload.single("file"), asyncHandler(async (req, res) => {
  sendResponse(res, {
    data: await oldUserMigrationService.preview(req.file),
  });
}));
router.post("/users/migration/import", upload.single("file"), asyncHandler(async (req, res) => {
  res.status(202);
  sendResponse(res, {
    status: 202,
    message: "Old app user import started",
    data: await oldUserMigrationService.startImport(req.file),
  });
}));
router.get("/users/migration/logs", asyncHandler(async (_req, res) => {
  sendResponse(res, {
    data: await oldUserMigrationService.logs(),
  });
}));

const revisionConfigSchema = z.object({
  wrongQuestionLimit: z.coerce.number().int().min(1).max(100).optional(),
  oldQuestionLimit: z.coerce.number().int().min(1).max(100).optional(),
  dailyRevisionLimit: z.coerce.number().int().min(1).max(200).optional(),
  revisionEnabled: z.coerce.boolean().optional(),
  includeWrongQuestions: z.coerce.boolean().optional(),
  includeSkippedQuestions: z.coerce.boolean().optional(),
  includeLowAccuracyQuestions: z.coerce.boolean().optional(),
  includeWeakAreaQuestions: z.coerce.boolean().optional(),
  accuracyThreshold: z.coerce.number().min(0).max(100).optional(),
  minimumCorrectAnswers: z.coerce.number().int().min(0).max(200).optional(),
  completionAttemptCount: z.coerce.number().int().min(1).max(20).optional(),
  difficultyMode: z.enum(["easy", "medium", "moderate", "hard", "mixed"]).optional(),
  scheduleMode: z.enum(["daily", "weekly", "custom"]).optional(),
  autoGeneratedRevisionTests: z.coerce.boolean().optional(),
  customRevisionQuestionIds: z.array(z.string()).optional(),
  subjectSettings: z.record(z.unknown()).optional(),
  chapterSettings: z.record(z.unknown()).optional(),
  topicSettings: z.record(z.unknown()).optional(),
  spacedDays: z.array(z.coerce.number().int().positive()).min(1).max(12).optional(),
  wrong_question_limit: z.coerce.number().int().min(1).max(100).optional(),
  old_question_limit: z.coerce.number().int().min(1).max(100).optional(),
  daily_revision_limit: z.coerce.number().int().min(1).max(200).optional(),
  revision_enabled: z.coerce.boolean().optional(),
  include_wrong_questions: z.coerce.boolean().optional(),
  include_skipped_questions: z.coerce.boolean().optional(),
  include_low_accuracy_questions: z.coerce.boolean().optional(),
  include_weak_area_questions: z.coerce.boolean().optional(),
  accuracy_threshold: z.coerce.number().min(0).max(100).optional(),
  minimum_correct_answers: z.coerce.number().int().min(0).max(200).optional(),
  completion_attempt_count: z.coerce.number().int().min(1).max(20).optional(),
  difficulty_mode: z.enum(["easy", "medium", "moderate", "hard", "mixed"]).optional(),
  schedule_mode: z.enum(["daily", "weekly", "custom"]).optional(),
  auto_generated_revision_tests: z.coerce.boolean().optional(),
  custom_revision_question_ids: z.array(z.string()).optional(),
  spaced_days: z.array(z.coerce.number().int().positive()).min(1).max(12).optional(),
});

const revisionGenerateSchema = z.object({
  userId: z.string().trim().optional(),
  user_id: z.string().trim().optional(),
  email: z.string().trim().optional(),
  email_id: z.string().trim().optional(),
  examMode: z.enum(["NEET", "JEE", "BOTH"]).optional(),
  exam_mode: z.enum(["NEET", "JEE", "BOTH"]).optional(),
});

const dailyTestSettingsSchema = z.object({
  examType: z.enum(["NEET", "JEE", "BOTH"]).optional(),
  exam_type: z.enum(["NEET", "JEE", "BOTH"]).optional(),
  totalQuestions: z.coerce.number().int().min(1).max(200).optional(),
  newQuestions: z.coerce.number().int().min(0).max(200).optional(),
  weakQuestions: z.coerce.number().int().min(0).max(200).optional(),
  revisionQuestions: z.coerce.number().int().min(0).max(200).optional(),
  easyPercentage: z.coerce.number().int().min(0).max(100).optional(),
  moderatePercentage: z.coerce.number().int().min(0).max(100).optional(),
  hardPercentage: z.coerce.number().int().min(0).max(100).optional(),
  enabled: z.coerce.boolean().optional(),
  allowBothExamsSameDay: z.coerce.boolean().optional(),
  allow_both_exams_same_day: z.coerce.boolean().optional(),
  total_questions: z.coerce.number().int().min(1).max(200).optional(),
  new_questions: z.coerce.number().int().min(0).max(200).optional(),
  weak_questions: z.coerce.number().int().min(0).max(200).optional(),
  revision_questions: z.coerce.number().int().min(0).max(200).optional(),
  easy_percentage: z.coerce.number().int().min(0).max(100).optional(),
  moderate_percentage: z.coerce.number().int().min(0).max(100).optional(),
  hard_percentage: z.coerce.number().int().min(0).max(100).optional(),
  adaptiveModeEnabled: z.coerce.boolean().optional(),
  repeatLookbackSessions: z.coerce.number().int().min(1).max(30).optional(),
  maxRepeatedQuestions: z.coerce.number().int().min(0).max(200).optional(),
  adaptive_mode_enabled: z.coerce.boolean().optional(),
  repeat_lookback_sessions: z.coerce.number().int().min(1).max(30).optional(),
  max_repeated_questions: z.coerce.number().int().min(0).max(200).optional(),
  lowPerformanceRatio: z.object({
    easy: z.coerce.number().int().min(0).max(100),
    moderate: z.coerce.number().int().min(0).max(100),
    hard: z.coerce.number().int().min(0).max(100),
  }).optional(),
  mediumPerformanceRatio: z.object({
    easy: z.coerce.number().int().min(0).max(100),
    moderate: z.coerce.number().int().min(0).max(100),
    hard: z.coerce.number().int().min(0).max(100),
  }).optional(),
  highPerformanceRatio: z.object({
    easy: z.coerce.number().int().min(0).max(100),
    moderate: z.coerce.number().int().min(0).max(100),
    hard: z.coerce.number().int().min(0).max(100),
  }).optional(),
  mixedModeRatio: z.object({
    easy: z.coerce.number().int().min(0).max(100),
    moderate: z.coerce.number().int().min(0).max(100),
    hard: z.coerce.number().int().min(0).max(100),
  }).optional(),
});

const dailyTestResetSchema = z.object({
  userId: z.string().trim().optional(),
  user_id: z.string().trim().optional(),
  email: z.string().trim().optional(),
  email_id: z.string().trim().optional(),
  date: z.string().trim().optional(),
  resetAll: z.coerce.boolean().optional(),
  reset_all: z.coerce.boolean().optional(),
  examMode: z.enum(["NEET", "JEE", "BOTH"]).optional(),
  exam_mode: z.enum(["NEET", "JEE", "BOTH"]).optional(),
});

const chapterBulkFreeAccessSchema = z.object({
  chapterIds: z.array(z.string().trim().min(1)).optional().default([]),
  subjectId: z.string().trim().min(1).optional(),
  isLockedForFreeUsers: z.coerce.boolean(),
});

const markingRuleSchema = z.object({
  correct: z.coerce.number(),
  wrong: z.coerce.number(),
  unanswered: z.coerce.number().default(0),
});

const examMarkingSettingsSchema = z.object({
  predictionMinimumMockTests: z.coerce.number().int().min(1).max(50).optional(),
  neet: z.object({
    version: z.string().trim().min(1),
    mcq: markingRuleSchema,
    numerical: markingRuleSchema,
    active: z.coerce.boolean().optional().default(true),
  }).optional(),
  jeeMain: z.object({
    version: z.string().trim().min(1),
    mcq: markingRuleSchema,
    numerical: markingRuleSchema,
    active: z.coerce.boolean().optional().default(true),
  }).optional(),
  jeeAdvanced: z.object({
    version: z.string().trim().min(1),
    mcq: markingRuleSchema,
    numerical: markingRuleSchema,
    active: z.coerce.boolean().optional().default(true),
  }).optional(),
});

const supportReplySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  sendEmail: z.coerce.boolean().optional().default(true),
  sendNotification: z.coerce.boolean().optional().default(true),
});

const notificationBroadcastSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(1).max(3000),
  type: z.enum(["text", "image", "offer", "announcement", "update", "reminder"]).default("text"),
  targetGroup: z.enum(["all", "premium", "non_premium", "highest_premium", "middle_premium", "lowest_premium"]).default("all"),
  deliveryMode: z.enum(["notification", "email", "both", "push", "email_push"]).default("notification"),
  templateKey: z.string().trim().optional().default(""),
  variables: z.string().trim().optional().default("{}"),
  linkUrl: z.string().trim().optional().default(""),
});

function notificationTemplateKeyForType(type, explicitTemplateKey = "") {
  const requested = String(explicitTemplateKey || "").trim();
  if (requested) return requested;

  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "announcement") return EMAIL_TEMPLATE_KEYS.NOTIFICATION_ANNOUNCEMENT;
  if (normalized === "update") return EMAIL_TEMPLATE_KEYS.NOTIFICATION_UPDATE;
  if (normalized === "offer") return EMAIL_TEMPLATE_KEYS.NOTIFICATION_OFFER;
  if (normalized === "reminder") return EMAIL_TEMPLATE_KEYS.NOTIFICATION_REMINDER;
  return EMAIL_TEMPLATE_KEYS.NOTIFICATION_GENERAL;
}

function parseNotificationVariables(rawValue) {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(String(rawValue));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new AppError("Email Variables must be valid JSON", 400);
  }
}

function buildNotificationEmailVariables({ user, payload, settings, extraVariables }) {
  const supportEmail = settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com";
  return {
    ...extraVariables,
    user_name: user.name || user.mobile || "Learner",
    email: user.email || "",
    notification_title: payload.title,
    notification_message: payload.body,
    broadcast_title: payload.title,
    broadcast_body: payload.body,
    announcement_title: payload.title,
    announcement_message: payload.body,
    update_title: payload.title,
    update_message: payload.body,
    offer_title: payload.title,
    offer_code: extraVariables.offer_code || extraVariables.coupon_code || "",
    offer_discount: extraVariables.offer_discount || extraVariables.discount || "",
    support_email: supportEmail,
  };
}

function notificationLinkForType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "offer") return "/subscription";
  if (normalized === "announcement" || normalized === "update") return "/notifications";
  return "/notifications";
}

function splitPremiumUsersBySpend(users, targetGroup) {
  const sorted = [...users].sort((a, b) => Number(b.lastPurchase?.finalAmount || 0) - Number(a.lastPurchase?.finalAmount || 0));
  if (!["highest_premium", "middle_premium", "lowest_premium"].includes(targetGroup)) return sorted;
  const bucketSize = Math.max(1, Math.ceil(sorted.length / 3));
  if (targetGroup === "highest_premium") return sorted.slice(0, bucketSize);
  if (targetGroup === "lowest_premium") return sorted.slice(-bucketSize);
  return sorted.slice(bucketSize, sorted.length - bucketSize);
}

async function getNotificationRecipients(targetGroup) {
  if (targetGroup === "all") return User.find({ isAdmin: { $ne: true } }).lean();
  if (targetGroup === "non_premium") return User.find({ isAdmin: { $ne: true }, isPremium: { $ne: true } }).lean();

  const premiumUsers = await User.find({ isAdmin: { $ne: true }, isPremium: true }).lean();
  if (targetGroup === "premium") return premiumUsers;
  return splitPremiumUsersBySpend(premiumUsers, targetGroup);
}

async function saveNotificationAttachment(file) {
  if (!file) return { attachmentUrl: "", imageUrl: "", attachmentName: "" };

  const allowed = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ]);
  const mimeType = String(file.mimetype || "").toLowerCase();
  if (!allowed.has(mimeType)) throw new AppError("Unsupported notification attachment type", 400);

  const root = path.join(uploadsRoot, "notifications");
  ensureDir(root);
  const baseName = sanitizeFileName(file.originalname || "notification-file");
  const ext = path.extname(baseName) || (mimeType === "application/pdf" ? ".pdf" : ".png");
  const name = path.basename(baseName, ext);
  const fileName = `${name}-${Date.now()}-${crypto.randomInt(1000, 9999)}${ext}`;
  await fs.writeFile(path.join(root, fileName), file.buffer);
  const publicPath = `/uploads/notifications/${fileName}`;

  return {
    attachmentUrl: publicPath,
    imageUrl: mimeType.startsWith("image/") ? publicPath : "",
    attachmentName: file.originalname || fileName,
  };
}

function getTodayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

function resolveDateRange(dateValue) {
  if (!dateValue) return getTodayRange();
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) throw new AppError("Invalid date format for reset", 400);
  const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

function createDefaultMarkingSettingsPayload() {
  return {
    predictionMinimumMockTests: 5,
    neet: {
      version: "v1",
      examType: "NEET",
      mcq: { correct: 4, wrong: -1, unanswered: 0 },
      numerical: { correct: 4, wrong: -1, unanswered: 0 },
      active: true,
    },
    jeeMain: {
      version: "v1",
      examType: "JEE_MAIN",
      mcq: { correct: 4, wrong: -1, unanswered: 0 },
      numerical: { correct: 4, wrong: 0, unanswered: 0 },
      active: true,
    },
    jeeAdvanced: {
      version: "v1",
      examType: "JEE_ADVANCED",
      mcq: { correct: 4, wrong: -1, unanswered: 0 },
      numerical: { correct: 4, wrong: 0, unanswered: 0 },
      active: true,
    },
  };
}

function normalizeMarkingRule(rule, fallback) {
  return {
    correct: Number(rule?.correct ?? fallback.correct),
    wrong: Number(rule?.wrong ?? fallback.wrong),
    unanswered: Number(rule?.unanswered ?? fallback.unanswered ?? 0),
  };
}

function normalizeMarkingScheme(scheme, fallback) {
  return {
    version: String(scheme?.version ?? fallback.version ?? "v1").trim() || "v1",
    examType: String(scheme?.examType ?? fallback.examType ?? "").trim() || fallback.examType,
    mcq: normalizeMarkingRule(scheme?.mcq, fallback.mcq),
    numerical: normalizeMarkingRule(scheme?.numerical, fallback.numerical),
    active: scheme?.active !== undefined ? Boolean(scheme.active) : Boolean(fallback.active ?? true),
  };
}

function normalizeMarkingSettingsDocument(doc) {
  const fallback = createDefaultMarkingSettingsPayload();
  return {
    predictionMinimumMockTests: Math.max(1, Math.min(50, Number(doc?.predictionMinimumMockTests ?? fallback.predictionMinimumMockTests))),
    neet: normalizeMarkingScheme(doc?.neet, fallback.neet),
    jeeMain: normalizeMarkingScheme(doc?.jeeMain, fallback.jeeMain),
    jeeAdvanced: normalizeMarkingScheme(doc?.jeeAdvanced, fallback.jeeAdvanced),
  };
}

function assertValidMarkingScheme(scheme, label = "Marking scheme") {
  const checks = [
    { key: "mcq.correct", value: Number(scheme?.mcq?.correct ?? 0), min: 0 },
    { key: "mcq.wrong", value: Number(scheme?.mcq?.wrong ?? 0), max: 0 },
    { key: "numerical.correct", value: Number(scheme?.numerical?.correct ?? 0), min: 0 },
    { key: "numerical.wrong", value: Number(scheme?.numerical?.wrong ?? 0), max: 0 },
    { key: "mcq.unanswered", value: Number(scheme?.mcq?.unanswered ?? 0) },
    { key: "numerical.unanswered", value: Number(scheme?.numerical?.unanswered ?? 0) },
  ];

  for (const check of checks) {
    if (!Number.isFinite(check.value)) {
      throw new AppError(`${label} ${check.key} must be a valid number`, 400);
    }
    if (check.min !== undefined && check.value < check.min) {
      throw new AppError(`${label} ${check.key} must be >= ${check.min}`, 400);
    }
    if (check.max !== undefined && check.value > check.max) {
      throw new AppError(`${label} ${check.key} must be <= ${check.max}`, 400);
    }
  }
}

function mapMarkingSettingsResponse(doc) {
  const normalized = normalizeMarkingSettingsDocument(doc);
  return {
    neet: normalized.neet,
    jeeMain: normalized.jeeMain,
    jeeAdvanced: normalized.jeeAdvanced,
    predictionMinimumMockTests: normalized.predictionMinimumMockTests,
    updated_at: doc?.updatedAt,
  };
}

async function getOrCreateExamMarkingSettings() {
  let settings = await ExamMarkingSettings.findOne({});
  if (!settings) {
    settings = await ExamMarkingSettings.create(createDefaultMarkingSettingsPayload());
  }
  return settings;
}

function getMarkingSchemeByExamType(markingSettings, examType) {
  if (examType === "NEET") return markingSettings.neet;
  if (examType === "JEE") return markingSettings.jeeMain;
  return markingSettings.neet;
}

function getQuestionTypeForMarking(questionLike) {
  const responseType = String(questionLike?.responseType || "").trim().toLowerCase();
  return responseType === "numeric" || responseType === "numerical" ? "NUMERICAL" : "MCQ";
}

function buildQuestionMarkingRules(questionIds, questionMap, markingScheme) {
  return questionIds.map((id) => {
    const question = questionMap.get(String(id));
    const questionType = getQuestionTypeForMarking(question);
    const rule = questionType === "NUMERICAL" ? markingScheme.numerical : markingScheme.mcq;
    return {
      questionId: String(id),
      examType: markingScheme.examType,
      questionType,
      positiveMarks: Number(rule.correct ?? 0),
      negativeMarks: Number(rule.wrong ?? 0),
      unansweredMarks: Number(rule.unanswered ?? 0),
      schemeVersion: markingScheme.version,
    };
  });
}

function calculateMaxScoreFromRules(questionMarkingRules, totalAttemptQuestions) {
  const attemptCount = Math.max(0, Number(totalAttemptQuestions || 0));
  if (!attemptCount) return 0;
  return questionMarkingRules
    .slice(0, attemptCount)
    .reduce((sum, item) => sum + Number(item?.positiveMarks ?? 0), 0);
}

async function getOrCreateDailyTestSettings() {
  let settings = await DailyTestSettings.findOne({});
  if (!settings) {
    settings = await DailyTestSettings.create({
      totalQuestions: 20,
      newQuestions: 10,
      weakQuestions: 5,
      revisionQuestions: 5,
      easyPercentage: 30,
      moderatePercentage: 40,
      hardPercentage: 30,
      enabled: true,
      examType: "BOTH",
      allowBothExamsSameDay: false,
      adaptiveModeEnabled: true,
      repeatLookbackSessions: 5,
      maxRepeatedQuestions: 2,
      lowPerformanceRatio: { easy: 70, moderate: 20, hard: 10 },
      mediumPerformanceRatio: { easy: 40, moderate: 40, hard: 20 },
      highPerformanceRatio: { easy: 15, moderate: 45, hard: 40 },
      mixedModeRatio: { easy: 34, moderate: 33, hard: 33 },
    });
  }
  return settings;
}

function mapDailyTestSettings(doc) {
  const lowRatio = doc.lowPerformanceRatio || { easy: 70, moderate: 20, hard: 10 };
  const mediumRatio = doc.mediumPerformanceRatio || { easy: 40, moderate: 40, hard: 20 };
  const highRatio = doc.highPerformanceRatio || { easy: 15, moderate: 45, hard: 40 };
  const mixedRatio = doc.mixedModeRatio || { easy: 34, moderate: 33, hard: 33 };
  return {
    totalQuestions: Number(doc.totalQuestions || 20),
    newQuestions: Number(doc.newQuestions || 10),
    weakQuestions: Number(doc.weakQuestions || 5),
    revisionQuestions: Number(doc.revisionQuestions || 5),
    easyPercentage: Number(doc.easyPercentage || 30),
    moderatePercentage: Number(doc.moderatePercentage || 40),
    hardPercentage: Number(doc.hardPercentage || 30),
    enabled: Boolean(doc.enabled),
    examType: doc.examType || "BOTH",
    allowBothExamsSameDay: Boolean(doc.allowBothExamsSameDay ?? false),
    adaptiveModeEnabled: doc.adaptiveModeEnabled !== false,
    repeatLookbackSessions: Number(doc.repeatLookbackSessions || 5),
    maxRepeatedQuestions: Number(doc.maxRepeatedQuestions || 2),
    lowPerformanceRatio: {
      easy: Number(lowRatio.easy || 0),
      moderate: Number(lowRatio.moderate || 0),
      hard: Number(lowRatio.hard || 0),
    },
    mediumPerformanceRatio: {
      easy: Number(mediumRatio.easy || 0),
      moderate: Number(mediumRatio.moderate || 0),
      hard: Number(mediumRatio.hard || 0),
    },
    highPerformanceRatio: {
      easy: Number(highRatio.easy || 0),
      moderate: Number(highRatio.moderate || 0),
      hard: Number(highRatio.hard || 0),
    },
    mixedModeRatio: {
      easy: Number(mixedRatio.easy || 0),
      moderate: Number(mixedRatio.moderate || 0),
      hard: Number(mixedRatio.hard || 0),
    },
    total_questions: Number(doc.totalQuestions || 20),
    new_questions: Number(doc.newQuestions || 10),
    weak_questions: Number(doc.weakQuestions || 5),
    revision_questions: Number(doc.revisionQuestions || 5),
    easy_percentage: Number(doc.easyPercentage || 30),
    moderate_percentage: Number(doc.moderatePercentage || 40),
    hard_percentage: Number(doc.hardPercentage || 30),
    exam_type: doc.examType || "BOTH",
    allow_both_exams_same_day: Boolean(doc.allowBothExamsSameDay ?? false),
    adaptive_mode_enabled: doc.adaptiveModeEnabled !== false,
    repeat_lookback_sessions: Number(doc.repeatLookbackSessions || 5),
    max_repeated_questions: Number(doc.maxRepeatedQuestions || 2),
    updated_at: doc.updatedAt,
  };
}

function normalizeSpacedDays(spacedDays) {
  const source = Array.isArray(spacedDays) ? spacedDays : [1, 2, 5, 10];
  return [...new Set(source.map((day) => Number(day)).filter((day) => Number.isFinite(day) && day > 0))]
    .sort((left, right) => left - right)
    .slice(0, 12);
}

async function getOrCreateRevisionSettings() {
  let settings = await RevisionSettings.findOne({});
  if (!settings) {
    settings = await RevisionSettings.create({
      wrongQuestionLimit: 10,
      oldQuestionLimit: 5,
      dailyRevisionLimit: 20,
      revisionEnabled: true,
      includeWrongQuestions: true,
      includeSkippedQuestions: true,
      includeLowAccuracyQuestions: true,
      includeWeakAreaQuestions: true,
      accuracyThreshold: 80,
      minimumCorrectAnswers: 1,
      completionAttemptCount: 1,
      difficultyMode: "mixed",
      scheduleMode: "daily",
      autoGeneratedRevisionTests: true,
      spacedDays: [1, 2, 5, 10],
    });
  }
  return settings;
}

function mapRevisionSettings(doc) {
  return {
    wrongQuestionLimit: Number(doc.wrongQuestionLimit || 10),
    oldQuestionLimit: Number(doc.oldQuestionLimit || 5),
    dailyRevisionLimit: Number(doc.dailyRevisionLimit || 20),
    revisionEnabled: Boolean(doc.revisionEnabled),
    includeWrongQuestions: doc.includeWrongQuestions !== false,
    includeSkippedQuestions: doc.includeSkippedQuestions !== false,
    includeLowAccuracyQuestions: doc.includeLowAccuracyQuestions !== false,
    includeWeakAreaQuestions: doc.includeWeakAreaQuestions !== false,
    accuracyThreshold: Number(doc.accuracyThreshold ?? 80),
    minimumCorrectAnswers: Number(doc.minimumCorrectAnswers ?? 1),
    completionAttemptCount: Number(doc.completionAttemptCount ?? 1),
    difficultyMode: doc.difficultyMode || "mixed",
    scheduleMode: doc.scheduleMode || "daily",
    autoGeneratedRevisionTests: doc.autoGeneratedRevisionTests !== false,
    customRevisionQuestionIds: doc.customRevisionQuestionIds || [],
    subjectSettings: doc.subjectSettings || {},
    chapterSettings: doc.chapterSettings || {},
    topicSettings: doc.topicSettings || {},
    spacedDays: normalizeSpacedDays(doc.spacedDays),
    wrong_question_limit: Number(doc.wrongQuestionLimit || 10),
    old_question_limit: Number(doc.oldQuestionLimit || 5),
    daily_revision_limit: Number(doc.dailyRevisionLimit || 20),
    revision_enabled: Boolean(doc.revisionEnabled),
    include_wrong_questions: doc.includeWrongQuestions !== false,
    include_skipped_questions: doc.includeSkippedQuestions !== false,
    include_low_accuracy_questions: doc.includeLowAccuracyQuestions !== false,
    include_weak_area_questions: doc.includeWeakAreaQuestions !== false,
    accuracy_threshold: Number(doc.accuracyThreshold ?? 80),
    minimum_correct_answers: Number(doc.minimumCorrectAnswers ?? 1),
    completion_attempt_count: Number(doc.completionAttemptCount ?? 1),
    difficulty_mode: doc.difficultyMode || "mixed",
    schedule_mode: doc.scheduleMode || "daily",
    auto_generated_revision_tests: doc.autoGeneratedRevisionTests !== false,
    custom_revision_question_ids: doc.customRevisionQuestionIds || [],
    spaced_days: normalizeSpacedDays(doc.spacedDays),
    updated_at: doc.updatedAt,
  };
}

router.get("/revision/settings", asyncHandler(async (_req, res) => {
  const settings = await getOrCreateRevisionSettings();
  res.json({ success: true, data: mapRevisionSettings(settings) });
}));

router.post("/revision/settings", asyncHandler(async (req, res) => {
  const payload = revisionConfigSchema.parse(req.body || {});
  const nextValues = {
    wrongQuestionLimit: payload.wrongQuestionLimit ?? payload.wrong_question_limit ?? 10,
    oldQuestionLimit: payload.oldQuestionLimit ?? payload.old_question_limit ?? 5,
    dailyRevisionLimit: payload.dailyRevisionLimit ?? payload.daily_revision_limit ?? 20,
    revisionEnabled: payload.revisionEnabled ?? payload.revision_enabled ?? true,
    includeWrongQuestions: payload.includeWrongQuestions ?? payload.include_wrong_questions ?? true,
    includeSkippedQuestions: payload.includeSkippedQuestions ?? payload.include_skipped_questions ?? true,
    includeLowAccuracyQuestions: payload.includeLowAccuracyQuestions ?? payload.include_low_accuracy_questions ?? true,
    includeWeakAreaQuestions: payload.includeWeakAreaQuestions ?? payload.include_weak_area_questions ?? true,
    accuracyThreshold: payload.accuracyThreshold ?? payload.accuracy_threshold ?? 80,
    minimumCorrectAnswers: payload.minimumCorrectAnswers ?? payload.minimum_correct_answers ?? 1,
    completionAttemptCount: payload.completionAttemptCount ?? payload.completion_attempt_count ?? 1,
    difficultyMode: payload.difficultyMode ?? payload.difficulty_mode ?? "mixed",
    scheduleMode: payload.scheduleMode ?? payload.schedule_mode ?? "daily",
    autoGeneratedRevisionTests: payload.autoGeneratedRevisionTests ?? payload.auto_generated_revision_tests ?? true,
    customRevisionQuestionIds: payload.customRevisionQuestionIds ?? payload.custom_revision_question_ids ?? [],
    subjectSettings: payload.subjectSettings ?? {},
    chapterSettings: payload.chapterSettings ?? {},
    topicSettings: payload.topicSettings ?? {},
    spacedDays: normalizeSpacedDays(payload.spacedDays ?? payload.spaced_days ?? [1, 2, 5, 10]),
  };

  const settings = await RevisionSettings.findOneAndUpdate({}, nextValues, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  res.json({ success: true, message: "Revision settings updated", data: mapRevisionSettings(settings) });
}));

router.get("/revision/analytics", asyncHandler(async (_req, res) => {
  const revisionSessions = await LearningSession.find({ type: "revision" }).select("_id");
  const revisionSessionIds = revisionSessions.map((item) => String(item._id));

  const [completedCount, pendingCount, topTopicRows] = await Promise.all([
    revisionSessionIds.length
      ? SessionAttempt.countDocuments({ sessionId: { $in: revisionSessionIds }, completedAt: { $ne: null } })
      : 0,
    Mistake.countDocuments({ status: { $in: ["new", "weak"] } }),
    revisionSessionIds.length
      ? QuestionAttempt.aggregate([
          { $match: { sessionId: { $in: revisionSessionIds } } },
          { $group: { _id: "$chapterId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ])
      : [],
  ]);

  const chapterIds = topTopicRows.map((item) => String(item._id)).filter(Boolean);
  const chapters = chapterIds.length ? await Chapter.find({ _id: { $in: chapterIds } }).select("_id name") : [];
  const chapterMap = new Map(chapters.map((item) => [String(item._id), item.name]));
  const topTopics = topTopicRows.map((item) => chapterMap.get(String(item._id)) || String(item._id));

  const analytics = await RevisionAnalytics.findOneAndUpdate(
    {},
    {
      totalAttempts: revisionSessionIds.length,
      completedCount,
      pendingCount,
      topTopics,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.json({
    success: true,
    data: {
      totalAttempts: Number(analytics.totalAttempts || 0),
      completedCount: Number(analytics.completedCount || 0),
      pendingCount: Number(analytics.pendingCount || 0),
      topTopics: Array.isArray(analytics.topTopics) ? analytics.topTopics : [],
      total_attempts: Number(analytics.totalAttempts || 0),
      completed_count: Number(analytics.completedCount || 0),
      pending_count: Number(analytics.pendingCount || 0),
      top_topics: Array.isArray(analytics.topTopics) ? analytics.topTopics : [],
      updated_at: analytics.updatedAt,
    },
  });
}));

router.post("/revision/generate", asyncHandler(async (req, res) => {
  const payload = revisionGenerateSchema.parse(req.body || {});
  const settings = await getOrCreateRevisionSettings();

  if (!settings.revisionEnabled) {
    throw new AppError("Revision module is disabled. Enable it in revision settings first.", 400);
  }

  const selectedUserId = payload.userId || payload.user_id;
  const selectedEmail = String(payload.email || payload.email_id || "").trim().toLowerCase();
  const selectedUser = selectedUserId
    ? await User.findById(selectedUserId)
    : selectedEmail
      ? await User.findOne({ email: new RegExp(`^${selectedEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), isAdmin: { $ne: true } })
      : await User.findOne({ isAdmin: { $ne: true } }).sort({ updatedAt: -1 });

  if (!selectedUser) {
    throw new AppError("No valid learner found to generate revision pool", 404);
  }

  const examMode = payload.examMode || payload.exam_mode || selectedUser.examMode || "NEET";
  const examModeFilter =
    examMode === "BOTH"
      ? { examMode: { $in: ["NEET", "JEE", "BOTH"] } }
      : { examMode: { $in: [examMode, "BOTH"] } };

  const wrongEntries = await Mistake.find({ userId: String(selectedUser._id) })
    .sort({ attempts: -1, lastAttemptDate: 1 })
    .limit(Math.max(1, Number(settings.wrongQuestionLimit || 10)));
  const wrongQuestionIds = wrongEntries.map((item) => String(item.questionId)).filter(Boolean);
  const wrongQuestionsRaw = wrongQuestionIds.length
    ? await Question.find({ _id: { $in: wrongQuestionIds }, ...examModeFilter }).select("_id question chapterId subjectId examMode")
    : [];
  const wrongMap = new Map(wrongQuestionsRaw.map((item) => [String(item._id), item]));
  const wrongQuestions = wrongQuestionIds.map((id) => wrongMap.get(id)).filter(Boolean);

  const attemptCandidates = await QuestionAttempt.find({ userId: String(selectedUser._id), isCorrect: true })
    .sort({ createdAt: 1 })
    .limit(Math.max(50, Number(settings.oldQuestionLimit || 5) * 10));

  const oldQuestionIds = [];
  const oldSeen = new Set();
  for (const attempt of attemptCandidates) {
    const questionId = String(attempt.questionId || "");
    if (!questionId || oldSeen.has(questionId)) continue;
    oldSeen.add(questionId);
    oldQuestionIds.push(questionId);
    if (oldQuestionIds.length >= Number(settings.oldQuestionLimit || 5)) break;
  }

  const oldQuestionsRaw = oldQuestionIds.length
    ? await Question.find({ _id: { $in: oldQuestionIds }, ...examModeFilter }).select("_id question chapterId subjectId examMode")
    : [];
  const oldMap = new Map(oldQuestionsRaw.map((item) => [String(item._id), item]));
  const oldQuestions = oldQuestionIds.map((id) => oldMap.get(id)).filter(Boolean);

  const deduped = new Map();
  [...wrongQuestions, ...oldQuestions].forEach((item) => {
    deduped.set(String(item._id), item);
  });

  const generatedPool = [...deduped.values()].slice(0, Number(settings.wrongQuestionLimit || 10) + Number(settings.oldQuestionLimit || 5));
  const chapterIds = [...new Set(generatedPool.map((item) => String(item.chapterId)).filter(Boolean))];
  const chapters = chapterIds.length ? await Chapter.find({ _id: { $in: chapterIds } }).select("_id name") : [];
  const chapterMap = new Map(chapters.map((item) => [String(item._id), item.name]));

  res.json({
    success: true,
    message: "Revision pool generated",
    data: {
      userId: String(selectedUser._id),
      examMode,
      wrongCount: wrongQuestions.length,
      oldCount: oldQuestions.length,
      totalCount: generatedPool.length,
      wrong_count: wrongQuestions.length,
      old_count: oldQuestions.length,
      total_count: generatedPool.length,
      questionIds: generatedPool.map((item) => String(item._id)),
      topTopics: [...new Set(generatedPool.map((item) => chapterMap.get(String(item.chapterId))).filter(Boolean))].slice(0, 5),
      questions: generatedPool.map((item) => ({
        id: String(item._id),
        question: item.question,
        chapterId: item.chapterId ? String(item.chapterId) : null,
        chapterName: chapterMap.get(String(item.chapterId)) || null,
        subjectId: item.subjectId ? String(item.subjectId) : null,
        examMode: item.examMode || null,
      })),
      settings: mapRevisionSettings(settings),
    },
  });
}));

router.get("/daily-test/settings", asyncHandler(async (_req, res) => {
  const settings = await getOrCreateDailyTestSettings();
  res.json({ success: true, data: mapDailyTestSettings(settings) });
}));

router.get("/free-question-configs", asyncHandler(async (_req, res) => {
  const configs = await FreeQuestionConfig.find({}).sort({ createdAt: -1 }).lean();
  const subjectIds = [...new Set(configs.map((item) => String(item.subjectId)).filter(Boolean))];
  const subjects = subjectIds.length ? await Subject.find({ _id: { $in: subjectIds } }).lean() : [];
  const subjectMap = new Map(subjects.map((item) => [String(item._id), item]));
  res.json({
    success: true,
    data: configs.map((item) => ({
      ...item,
      id: String(item._id),
      subjectName: subjectMap.get(String(item.subjectId))?.name || "-",
    })),
  });
}));

router.post("/free-question-configs", asyncHandler(async (req, res) => {
  const subjectId = String(req.body?.subjectId || "").trim();
  if (!subjectId) throw new AppError("Subject is required", 400);
  const payload = {
    subjectId,
    selectionMode: String(req.body?.selectionMode || "automatic") === "manual" ? "manual" : "automatic",
    questionCount: Math.max(1, Math.min(200, Number(req.body?.questionCount || 20))),
    manualQuestionIds: Array.isArray(req.body?.manualQuestionIds) ? req.body.manualQuestionIds.map(String).filter(Boolean) : [],
    isActive: req.body?.isActive === undefined ? true : Boolean(req.body.isActive),
  };
  const item = await FreeQuestionConfig.findOneAndUpdate({ subjectId }, payload, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.status(201).json({ success: true, message: "Free question configuration saved", data: item });
}));

router.delete("/free-question-configs/:id", asyncHandler(async (req, res) => {
  await FreeQuestionConfig.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: "Free question configuration deleted" });
}));

router.post("/daily-test/settings", asyncHandler(async (req, res) => {
  const payload = dailyTestSettingsSchema.parse(req.body || {});
  const nextValues = {
    examType: payload.examType ?? payload.exam_type ?? "BOTH",
    totalQuestions: payload.totalQuestions ?? payload.total_questions ?? 20,
    newQuestions: payload.newQuestions ?? payload.new_questions ?? 10,
    weakQuestions: payload.weakQuestions ?? payload.weak_questions ?? 5,
    revisionQuestions: payload.revisionQuestions ?? payload.revision_questions ?? 5,
    easyPercentage: payload.easyPercentage ?? payload.easy_percentage ?? 30,
    moderatePercentage: payload.moderatePercentage ?? payload.moderate_percentage ?? 40,
    hardPercentage: payload.hardPercentage ?? payload.hard_percentage ?? 30,
    enabled: payload.enabled ?? true,
    allowBothExamsSameDay: payload.allowBothExamsSameDay ?? payload.allow_both_exams_same_day ?? false,
    adaptiveModeEnabled: payload.adaptiveModeEnabled ?? payload.adaptive_mode_enabled ?? true,
    repeatLookbackSessions: payload.repeatLookbackSessions ?? payload.repeat_lookback_sessions ?? 5,
    maxRepeatedQuestions: payload.maxRepeatedQuestions ?? payload.max_repeated_questions ?? 2,
    lowPerformanceRatio: payload.lowPerformanceRatio ?? { easy: 70, moderate: 20, hard: 10 },
    mediumPerformanceRatio: payload.mediumPerformanceRatio ?? { easy: 40, moderate: 40, hard: 20 },
    highPerformanceRatio: payload.highPerformanceRatio ?? { easy: 15, moderate: 45, hard: 40 },
    mixedModeRatio: payload.mixedModeRatio ?? { easy: 34, moderate: 33, hard: 33 },
  };

  const countTotal = Number(nextValues.newQuestions) + Number(nextValues.weakQuestions) + Number(nextValues.revisionQuestions);
  if (countTotal !== Number(nextValues.totalQuestions)) {
    throw new AppError("New, weak, and revision counts must equal total daily test questions", 400);
  }

  const percentageTotal = Number(nextValues.easyPercentage) + Number(nextValues.moderatePercentage) + Number(nextValues.hardPercentage);
  if (percentageTotal !== 100) {
    throw new AppError("Easy, moderate, and hard percentages must total 100", 400);
  }
  const adaptiveGroups = [
    nextValues.lowPerformanceRatio,
    nextValues.mediumPerformanceRatio,
    nextValues.highPerformanceRatio,
    nextValues.mixedModeRatio,
  ];
  adaptiveGroups.forEach((ratio, index) => {
    const total = Number(ratio?.easy || 0) + Number(ratio?.moderate || 0) + Number(ratio?.hard || 0);
    if (total !== 100) {
      const labels = ["Low", "Medium", "High", "Mixed"];
      throw new AppError(`${labels[index]} adaptive ratio must total 100`, 400);
    }
  });

  const settings = await DailyTestSettings.findOneAndUpdate({}, nextValues, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  });

  res.json({ success: true, message: "Daily test settings updated", data: mapDailyTestSettings(settings) });
}));

router.get("/daily-test/analytics", asyncHandler(async (_req, res) => {
  const [totalAttempts, completedCount, averageScoreRows, topUsersRows] = await Promise.all([
    DailyTest.countDocuments({}),
    DailyTest.countDocuments({ completed: true }),
    DailyTest.aggregate([
      { $match: { completed: true } },
      { $group: { _id: null, averageScore: { $avg: "$score" } } },
    ]),
    DailyTest.aggregate([
      { $match: { completed: true } },
      {
        $group: {
          _id: "$userId",
          attempts: { $sum: 1 },
          avgScore: { $avg: "$score" },
          avgAccuracy: { $avg: "$accuracy" },
        },
      },
      { $sort: { avgScore: -1, avgAccuracy: -1, attempts: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const completionRate = totalAttempts > 0 ? Number(((completedCount / totalAttempts) * 100).toFixed(2)) : 0;
  const averageScore = Number((averageScoreRows?.[0]?.averageScore || 0).toFixed(2));
  const userIds = topUsersRows.map((item) => String(item._id)).filter(Boolean);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("_id name email").lean()
    : [];
  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const topPerformingUsers = topUsersRows.map((item) => {
    const userId = String(item._id);
    const user = userMap.get(userId);
    return {
      userId,
      name: user?.name || "Unknown User",
      email: user?.email || "",
      avgScore: Number((item.avgScore || 0).toFixed(2)),
      avgAccuracy: Number((item.avgAccuracy || 0).toFixed(2)),
      attempts: Number(item.attempts || 0),
    };
  });

  const analytics = await DailyTestAnalytics.findOneAndUpdate(
    {},
    { totalAttempts, averageScore, completionRate, topPerformingUsers },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.json({
    success: true,
    data: {
      totalAttempts: Number(analytics.totalAttempts || 0),
      averageScore: Number(analytics.averageScore || 0),
      completionRate: Number(analytics.completionRate || 0),
      topPerformingUsers: Array.isArray(analytics.topPerformingUsers) ? analytics.topPerformingUsers : [],
      total_attempts: Number(analytics.totalAttempts || 0),
      average_score: Number(analytics.averageScore || 0),
      completion_rate: Number(analytics.completionRate || 0),
      top_performing_users: Array.isArray(analytics.topPerformingUsers) ? analytics.topPerformingUsers : [],
      updated_at: analytics.updatedAt,
    },
  });
}));

router.post("/daily-test/reset", asyncHandler(async (req, res) => {
  const payload = dailyTestResetSchema.parse(req.body || {});
  const resetAll = Boolean(payload.resetAll ?? payload.reset_all ?? false);
  const email = String(payload.email || payload.email_id || "").trim().toLowerCase();
  let userId = payload.userId || payload.user_id;
  const dateRange = resetAll ? null : resolveDateRange(payload.date);

  if (email) {
    const user = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).select("_id email").lean();
    if (!user) throw new AppError("No user found for the provided email id", 404);
    userId = String(user._id);
  }

  const filter = {};
  if (userId) filter.userId = userId;
  if (dateRange) filter.testDate = { $gte: dateRange.start, $lte: dateRange.end };
  const examMode = payload.examMode || payload.exam_mode;
  if (examMode) filter.examMode = examMode;

  const result = await DailyTest.deleteMany(filter);

  res.json({
    success: true,
    message: "Daily tests reset completed",
    data: {
      deleted_count: Number(result.deletedCount || 0),
      deletedCount: Number(result.deletedCount || 0),
      user_id: userId || null,
      email: email || null,
      date: payload.date || null,
      examMode: examMode || null,
      exam_mode: examMode || null,
      reset_all: resetAll,
    },
  });
}));

const MOCK_TEST_PRESETS = {
  NEET_REAL: {
    examType: "NEET",
    durationMinutes: 180,
    maxScore: 720,
    marksPerQuestion: 4,
    negativeMarks: 1,
    predictionTitle: "Predicted NEET Score",
    predictionDescription: "This mock follows the real NEET marking pattern, so your final score is the closest estimate of your actual NEET score.",
    instructions: [
      "Biology has 90 MCQs, Physics has 45 MCQs, and Chemistry has 45 MCQs.",
      "Correct answer +4, wrong answer -1, unattempted 0.",
      "Total questions 180, total marks 720, duration 180 minutes.",
    ],
  },
  JEE_REAL: {
    examType: "JEE",
    durationMinutes: 180,
    maxScore: 300,
    marksPerQuestion: 4,
    negativeMarks: 1,
    predictionTitle: "Predicted JEE Score",
    predictionDescription: "This mock follows the real JEE structure, so your result is a direct prediction of your likely exam-day score.",
    instructions: [
      "Each subject has 20 MCQs and 5 numerical value questions.",
      "MCQ correct +4 and wrong -1.",
      "Numerical correct +4; wrong numerical marking follows the configured JEE Main pattern.",
      "Total questions 75, total marks 300, duration 180 minutes.",
      "Chemistry first, then Physics, then Maths is the recommended time strategy.",
    ],
  },
  CUSTOM: {
    examType: "NEET",
    durationMinutes: 60,
    maxScore: 240,
    marksPerQuestion: 4,
    negativeMarks: 1,
    predictionTitle: "Predicted Score",
    predictionDescription: "This mock test score is based on the configured paper pattern.",
    instructions: [],
  },
};

const WEEKDAY_OPTIONS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const AUTO_MOCK_HISTORY_LIMIT = 30;

const AUTO_MOCK_PRESET_BY_EXAM = {
  NEET: {
    patternPreset: "NEET_REAL",
    durationMinutes: 180,
    marksPerQuestion: 4,
    negativeMarks: 1,
    maxScore: 720,
    totalQuestions: 180,
    totalAttemptQuestions: 180,
    sectionGroups: [
      { key: "BIO", label: "Biology", subjectKey: "BIOLOGY", questionType: "MCQ", totalQuestions: 90, attemptQuestions: 90 },
      { key: "PHY", label: "Physics", subjectKey: "PHYSICS", questionType: "MCQ", totalQuestions: 45, attemptQuestions: 45 },
      { key: "CHEM", label: "Chemistry", subjectKey: "CHEMISTRY", questionType: "MCQ", totalQuestions: 45, attemptQuestions: 45 },
    ],
  },
  JEE: {
    patternPreset: "JEE_REAL",
    durationMinutes: 180,
    marksPerQuestion: 4,
    negativeMarks: 1,
    maxScore: 300,
    totalQuestions: 75,
    totalAttemptQuestions: 75,
    sectionGroups: [
      { key: "PHY_MCQ", label: "Physics - MCQ", subjectKey: "PHYSICS", questionType: "MCQ", totalQuestions: 20, attemptQuestions: 20 },
      { key: "PHY_NUM", label: "Physics - Numerical", subjectKey: "PHYSICS", questionType: "NUMERICAL", totalQuestions: 5, attemptQuestions: 5 },
      { key: "CHEM_MCQ", label: "Chemistry - MCQ", subjectKey: "CHEMISTRY", questionType: "MCQ", totalQuestions: 20, attemptQuestions: 20 },
      { key: "CHEM_NUM", label: "Chemistry - Numerical", subjectKey: "CHEMISTRY", questionType: "NUMERICAL", totalQuestions: 5, attemptQuestions: 5 },
      { key: "MATH_MCQ", label: "Mathematics - MCQ", subjectKey: "MATHEMATICS", questionType: "MCQ", totalQuestions: 20, attemptQuestions: 20 },
      { key: "MATH_NUM", label: "Mathematics - Numerical", subjectKey: "MATHEMATICS", questionType: "NUMERICAL", totalQuestions: 5, attemptQuestions: 5 },
    ],
  },
};

function createSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function shuffleList(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

function pickRandomFromList(list, count) {
  return shuffleList(list).slice(0, Math.max(0, Number(count) || 0));
}

function normalizeSubjectKey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized.includes("PHY")) return "PHYSICS";
  if (normalized.includes("CHEM")) return "CHEMISTRY";
  if (normalized.includes("MATH")) return "MATHEMATICS";
  if (normalized.includes("BOT") || normalized.includes("ZOO") || normalized.includes("BIO")) return "BIOLOGY";
  return normalized;
}

function normalizeQuestionDifficulty(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "other";
  if (normalized === "easy") return "easy";
  if (normalized === "hard") return "hard";
  if (normalized === "moderate" || normalized === "medium") return "medium";
  return "other";
}

function normalizeQuestionTypeBucket(question) {
  const responseType = String(question?.responseType || "").trim().toLowerCase();
  if (responseType === "numeric" || responseType === "numerical") return "NUMERICAL";
  return "MCQ";
}

function chooseBalancedQuestions(candidates, requiredCount, forcedDifficulty = "") {
  if (!requiredCount || requiredCount <= 0) return [];
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const difficultyFilter = String(forcedDifficulty || "").trim().toLowerCase();
  let source = candidates;
  if (difficultyFilter && difficultyFilter !== "mixed" && difficultyFilter !== "all") {
    source = candidates.filter((item) => normalizeQuestionDifficulty(item?.difficulty) === (difficultyFilter === "moderate" ? "medium" : difficultyFilter));
  }
  if (source.length <= requiredCount) return shuffleList(source);

  const byDifficulty = {
    easy: [],
    medium: [],
    hard: [],
    other: [],
  };
  source.forEach((item) => {
    byDifficulty[normalizeQuestionDifficulty(item?.difficulty)]?.push(item);
  });

  const targetEasy = Math.round(requiredCount * 0.3);
  const targetMedium = Math.round(requiredCount * 0.4);
  const targetHard = Math.max(0, requiredCount - targetEasy - targetMedium);

  const selectedMap = new Map();
  pickRandomFromList(byDifficulty.easy, targetEasy).forEach((item) => selectedMap.set(String(item._id), item));
  pickRandomFromList(byDifficulty.medium, targetMedium).forEach((item) => selectedMap.set(String(item._id), item));
  pickRandomFromList(byDifficulty.hard, targetHard).forEach((item) => selectedMap.set(String(item._id), item));

  if (selectedMap.size < requiredCount) {
    const remaining = source.filter((item) => !selectedMap.has(String(item._id)));
    pickRandomFromList(remaining, requiredCount - selectedMap.size).forEach((item) => selectedMap.set(String(item._id), item));
  }

  return shuffleList([...selectedMap.values()]).slice(0, requiredCount);
}

async function ensureUniqueMockTestSlug(title, currentId) {
  const baseSlug = createSlug(title) || `mock-test-${Date.now()}`;
  let candidate = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await MockTest.findOne({ slug: candidate }).select("_id");
    if (!existing || String(existing._id) === String(currentId || "")) {
      return candidate;
    }
    counter += 1;
    candidate = `${baseSlug}-${counter}`;
  }
}

async function buildMockTestPayload(payload, existing = null) {
  const title = String(payload.title || existing?.title || "").trim();
  const patternPreset = String(payload.patternPreset || existing?.patternPreset || "CUSTOM").toUpperCase();
  const preset = MOCK_TEST_PRESETS[patternPreset] || MOCK_TEST_PRESETS.CUSTOM;
  const examType = normalizeExamType(payload.examType || existing?.examType || preset.examType);
  const markingSettingsDoc = await getOrCreateExamMarkingSettings();
  const normalizedMarkingSettings = normalizeMarkingSettingsDocument(markingSettingsDoc);
  const defaultMarkingScheme = getMarkingSchemeByExamType(normalizedMarkingSettings, examType);
  const markingOverrideEnabled =
    payload.markingOverrideEnabled !== undefined
      ? Boolean(payload.markingOverrideEnabled)
      : existing
        ? Boolean(existing.markingOverrideEnabled)
        : false;
  const providedMarkingVersion = String(payload.markingSchemeVersion ?? existing?.markingSchemeVersion ?? defaultMarkingScheme.version).trim();
  const providedMarkingScheme = payload.markingScheme ?? existing?.markingScheme;
  const effectiveMarkingScheme = markingOverrideEnabled
    ? normalizeMarkingScheme(
        {
          version: providedMarkingVersion || defaultMarkingScheme.version,
          examType: defaultMarkingScheme.examType,
          mcq: {
            correct: payload.marksPerQuestion ?? providedMarkingScheme?.mcq?.correct ?? existing?.marksPerQuestion ?? defaultMarkingScheme.mcq.correct,
            wrong: payload.negativeMarks !== undefined ? -Math.abs(Number(payload.negativeMarks)) : providedMarkingScheme?.mcq?.wrong ?? existing?.markingScheme?.mcq?.wrong ?? defaultMarkingScheme.mcq.wrong,
            unanswered: providedMarkingScheme?.mcq?.unanswered ?? existing?.markingScheme?.mcq?.unanswered ?? 0,
          },
          numerical: {
            correct: providedMarkingScheme?.numerical?.correct ?? existing?.markingScheme?.numerical?.correct ?? defaultMarkingScheme.numerical.correct,
            wrong: providedMarkingScheme?.numerical?.wrong ?? existing?.markingScheme?.numerical?.wrong ?? defaultMarkingScheme.numerical.wrong,
            unanswered: providedMarkingScheme?.numerical?.unanswered ?? existing?.markingScheme?.numerical?.unanswered ?? 0,
          },
          active: true,
        },
        defaultMarkingScheme,
      )
    : defaultMarkingScheme;
  assertValidMarkingScheme(effectiveMarkingScheme, "Applied marking scheme");
  const durationMinutes = Number(payload.durationMinutes ?? existing?.durationMinutes ?? preset.durationMinutes);
  const marksPerQuestion = Number(effectiveMarkingScheme?.mcq?.correct ?? payload.marksPerQuestion ?? existing?.marksPerQuestion ?? preset.marksPerQuestion);
  const negativeMarks = Math.abs(Number(effectiveMarkingScheme?.mcq?.wrong ?? -(payload.negativeMarks ?? existing?.negativeMarks ?? preset.negativeMarks)));
  const availabilityMode = String(payload.availabilityMode ?? existing?.availabilityMode ?? "all").toLowerCase();
  const questionIds = [...new Set((Array.isArray(payload.questionIds) ? payload.questionIds : existing?.questionIds || []).map(String).filter(Boolean))];
  const availableDaysOfMonth = [...new Set((Array.isArray(payload.availableDaysOfMonth) ? payload.availableDaysOfMonth : existing?.availableDaysOfMonth || []).map(Number).filter((value) => value >= 1 && value <= 31))];
  const availableWeekdays = [...new Set((Array.isArray(payload.availableWeekdays) ? payload.availableWeekdays : existing?.availableWeekdays || []).map((value) => String(value).toUpperCase()).filter((value) => WEEKDAY_OPTIONS.includes(value)))];

  if (!title) throw new AppError("Title is required", 400);
  if (questionIds.length < 2) throw new AppError("Select at least two questions", 400);
  const requiredPresetQuestions = patternPreset === "NEET_REAL"
    ? AUTO_MOCK_PRESET_BY_EXAM.NEET.totalQuestions
    : patternPreset === "JEE_REAL"
      ? AUTO_MOCK_PRESET_BY_EXAM.JEE.totalQuestions
      : 0;
  if (requiredPresetQuestions && questionIds.length !== requiredPresetQuestions) {
    throw new AppError(
      `The mock test requires ${requiredPresetQuestions} questions based on the selected ${examType} pattern, but only ${questionIds.length} questions are currently selected.`,
      400,
    );
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1) throw new AppError("Duration must be at least 1 minute", 400);
  if (!["all", "day_wise", "week_wise"].includes(availabilityMode)) throw new AppError("Availability mode is invalid", 400);
  if (availabilityMode === "day_wise" && !availableDaysOfMonth.length) throw new AppError("Select at least one day of month", 400);
  if (availabilityMode === "week_wise" && !availableWeekdays.length) throw new AppError("Select at least one weekday", 400);

  const questions = await Question.find({ _id: { $in: questionIds } }).select("_id subjectId chapterId examMode exam responseType");
  if (questions.length !== questionIds.length) {
    throw new AppError("One or more selected questions were not found", 400);
  }
  const questionMap = new Map(questions.map((item) => [String(item._id), item]));

  const subjects = await Subject.find({ _id: { $in: [...new Set(questions.map((item) => String(item.subjectId)).filter(Boolean))] } }).select("_id examType");
  const subjectMap = new Map(subjects.map((item) => [String(item._id), item]));

  questions.forEach((question) => {
    const subject = subjectMap.get(String(question.subjectId));
    if (!subject) throw new AppError("Mock test includes a question with an invalid subject", 400);
    if (examType !== "BOTH" && subject.examType !== examType) {
      throw new AppError("All selected questions must match the mock test exam type", 400);
    }
  });
  const questionMarkingRules = buildQuestionMarkingRules(questionIds, questionMap, effectiveMarkingScheme);
  const totalAttemptQuestions = Number(payload.totalAttemptQuestions ?? existing?.totalAttemptQuestions ?? questionIds.length);
  const computedMaxScore = calculateMaxScoreFromRules(questionMarkingRules, totalAttemptQuestions);
  const maxScore = Number(payload.maxScore ?? existing?.maxScore ?? computedMaxScore ?? preset.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    throw new AppError("Max score must be greater than 0", 400);
  }

  return {
    title,
    slug: await ensureUniqueMockTestSlug(title, existing?._id),
    description: String(payload.description ?? existing?.description ?? "").trim() || undefined,
    examType,
    patternPreset,
    durationMinutes,
    totalQuestions: questionIds.length,
    maxScore,
    questionIds,
    subjectIds: [...new Set(questions.map((item) => String(item.subjectId)).filter(Boolean))],
    chapterIds: [...new Set(questions.map((item) => String(item.chapterId)).filter(Boolean))],
    instructions: (Array.isArray(payload.instructions) ? payload.instructions : String(payload.instructions ?? existing?.instructions ?? "").split("\n"))
      .map((item) => String(item).trim())
      .filter(Boolean).length
      ? (Array.isArray(payload.instructions) ? payload.instructions : String(payload.instructions ?? existing?.instructions ?? "").split("\n"))
          .map((item) => String(item).trim())
          .filter(Boolean)
      : preset.instructions,
    marksPerQuestion,
    negativeMarks,
    markingSchemeVersion: effectiveMarkingScheme.version,
    markingScheme: effectiveMarkingScheme,
    questionMarkingRules,
    markingOverrideEnabled,
    predictionTitle: String(payload.predictionTitle ?? existing?.predictionTitle ?? preset.predictionTitle).trim(),
    predictionDescription: String(payload.predictionDescription ?? existing?.predictionDescription ?? preset.predictionDescription).trim(),
    availabilityMode,
    availableDaysOfMonth: availabilityMode === "day_wise" ? availableDaysOfMonth : [],
    availableWeekdays: availabilityMode === "week_wise" ? availableWeekdays : [],
    totalAttemptQuestions,
    sectionGroups: Array.isArray(payload.sectionGroups) ? payload.sectionGroups : existing?.sectionGroups || [],
    generationSource: existing?.generationSource || "manual",
    generationConfig: existing?.generationConfig || undefined,
    generationHistory: Array.isArray(existing?.generationHistory) ? existing.generationHistory : [],
    randomizeQuestionOrder: payload.randomizeQuestionOrder !== undefined ? Boolean(payload.randomizeQuestionOrder) : existing ? Boolean(existing.randomizeQuestionOrder ?? true) : true,
    freeAccessDurationValue: Math.max(1, Number(payload.freeAccessDurationValue ?? existing?.freeAccessDurationValue ?? 1)),
    freeAccessDurationUnit: ["days", "weeks", "months"].includes(String(payload.freeAccessDurationUnit || existing?.freeAccessDurationUnit || "days"))
      ? String(payload.freeAccessDurationUnit || existing?.freeAccessDurationUnit || "days")
      : "days",
    premiumDurationType: ["daily", "weekly", "monthly"].includes(String(payload.premiumDurationType || existing?.premiumDurationType || "daily"))
      ? String(payload.premiumDurationType || existing?.premiumDurationType || "daily")
      : "daily",
    premiumValidityDays: Math.max(1, Number(payload.premiumValidityDays ?? existing?.premiumValidityDays ?? 1)),
    autoDailyQuestionRearrangement: payload.autoDailyQuestionRearrangement !== undefined ? Boolean(payload.autoDailyQuestionRearrangement) : Boolean(existing?.autoDailyQuestionRearrangement),
    autoDailyQuestionGeneration: payload.autoDailyQuestionGeneration !== undefined ? Boolean(payload.autoDailyQuestionGeneration) : Boolean(existing?.autoDailyQuestionGeneration),
    isPremiumOnly: payload.isPremiumOnly !== undefined ? Boolean(payload.isPremiumOnly) : Boolean(existing?.isPremiumOnly),
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : existing ? Boolean(existing.isActive) : true,
  };
}

async function serializeMockTests(items) {
  const subjectIds = [...new Set(items.flatMap((item) => item.subjectIds || []).map(String).filter(Boolean))];
  const chapterIds = [...new Set(items.flatMap((item) => item.chapterIds || []).map(String).filter(Boolean))];
  const questionIds = [...new Set(items.flatMap((item) => item.questionIds || []).map(String).filter(Boolean))];
  const mockTestIds = [...new Set(items.map((item) => String(item.id ?? item._id)).filter(Boolean))];
  const [subjects, chapters, questions, attemptStats] = await Promise.all([
    subjectIds.length ? Subject.find({ _id: { $in: subjectIds } }).select("name") : [],
    chapterIds.length ? Chapter.find({ _id: { $in: chapterIds } }).select("name") : [],
    questionIds.length
      ? Question.find({ _id: { $in: questionIds } })
        .select("_id question questionImageUrl optionA optionAImageUrl optionB optionBImageUrl optionC optionCImageUrl optionD optionDImageUrl subjectId chapterId difficulty difficultyId hasDiagram")
        .populate("subjectId", "name")
        .populate("chapterId", "name")
        .populate("difficultyId", "name")
      : [],
    mockTestIds.length
      ? SessionAttempt.aggregate([
          { $match: { sourceSessionId: { $in: mockTestIds }, completedAt: { $ne: null } } },
          {
            $group: {
              _id: "$sourceSessionId",
              completedAttemptCount: { $sum: 1 },
              completedUserIds: { $addToSet: "$userId" },
              lastCompletedAt: { $max: "$completedAt" },
            },
          },
        ])
      : [],
  ]);
  const subjectMap = new Map(subjects.map((item) => [String(item._id), item.name]));
  const chapterMap = new Map(chapters.map((item) => [String(item._id), item.name]));
  const questionMap = new Map(questions.map((item) => [String(item._id), item]));
  const statsByMockId = new Map(attemptStats.map((item) => [String(item._id), item]));
  const completedUserIds = [...new Set(attemptStats.flatMap((item) => item.completedUserIds || []).map(String).filter(Boolean))];
  const completedUsers = completedUserIds.length
    ? await User.find({ _id: { $in: completedUserIds.filter((id) => mongoose.isValidObjectId(id)) } }).select("_id isPremium")
    : [];
  const premiumUserIds = new Set(completedUsers.filter((user) => Boolean(user.isPremium)).map((user) => String(user._id)));

  return items.map((item) => {
    const raw = typeof item?.toJSON === "function" ? item.toJSON() : item;
    const mockStats = statsByMockId.get(String(raw.id ?? raw._id)) || {};
    const mockCompletedUserIds = (mockStats.completedUserIds || []).map(String).filter(Boolean);
    const currentPremiumLearnerCount = mockCompletedUserIds.filter((id) => premiumUserIds.has(id)).length;
    const completedLearnerCount = mockCompletedUserIds.length;
    return {
      id: String(raw.id ?? raw._id),
      title: raw.title,
      slug: raw.slug,
      description: raw.description || "",
      examType: raw.examType,
      patternPreset: raw.patternPreset || "CUSTOM",
      durationMinutes: Number(raw.durationMinutes || 0),
      totalQuestions: Number(raw.totalQuestions || raw.questionIds?.length || 0),
      maxScore: Number(raw.maxScore || 0),
      questionIds: (raw.questionIds || []).map(String),
      manualQuestions: (raw.questionIds || [])
        .map((id) => questionMap.get(String(id)))
        .filter(Boolean)
        .map((question) => ({
          id: String(question._id),
          question: question.question || "[Image Question]",
          questionImageUrl: question.questionImageUrl || "",
          hasDiagram: Boolean(question.hasDiagram || question.questionImageUrl),
          subjectName: question.subjectId?.name || "-",
          chapterName: question.chapterId?.name || "-",
          difficulty: question.difficultyId?.name || question.difficulty || "-",
        })),
      subjectIds: (raw.subjectIds || []).map(String),
      chapterIds: (raw.chapterIds || []).map(String),
      subjectNames: (raw.subjectIds || []).map((id) => subjectMap.get(String(id))).filter(Boolean),
      chapterNames: (raw.chapterIds || []).map((id) => chapterMap.get(String(id))).filter(Boolean),
      instructions: Array.isArray(raw.instructions) ? raw.instructions : [],
      marksPerQuestion: Number(raw.marksPerQuestion || 4),
      negativeMarks: Number(raw.negativeMarks || 1),
      markingSchemeVersion: String(raw.markingSchemeVersion || "v1"),
      markingScheme: raw.markingScheme || null,
      questionMarkingRules: Array.isArray(raw.questionMarkingRules) ? raw.questionMarkingRules : [],
      markingOverrideEnabled: Boolean(raw.markingOverrideEnabled),
      predictionTitle: raw.predictionTitle || "",
      predictionDescription: raw.predictionDescription || "",
      availabilityMode: raw.availabilityMode || "all",
      availableDaysOfMonth: Array.isArray(raw.availableDaysOfMonth) ? raw.availableDaysOfMonth : [],
      availableWeekdays: Array.isArray(raw.availableWeekdays) ? raw.availableWeekdays : [],
      totalAttemptQuestions: Number(raw.totalAttemptQuestions || raw.totalQuestions || raw.questionIds?.length || 0),
      sectionGroups: Array.isArray(raw.sectionGroups) ? raw.sectionGroups : [],
      generationSource: raw.generationSource || "manual",
      generationConfig: raw.generationConfig || null,
      generationHistory: Array.isArray(raw.generationHistory) ? raw.generationHistory : [],
      randomizeQuestionOrder: raw.randomizeQuestionOrder !== false,
      freeAccessDurationValue: Number(raw.freeAccessDurationValue || 1),
      freeAccessDurationUnit: raw.freeAccessDurationUnit || "days",
      premiumDurationType: raw.premiumDurationType || "daily",
      premiumValidityDays: Number(raw.premiumValidityDays || 1),
      autoDailyQuestionRearrangement: Boolean(raw.autoDailyQuestionRearrangement),
      autoDailyQuestionGeneration: Boolean(raw.autoDailyQuestionGeneration),
      accessRule: "free_once_then_premium_per_user",
      completedLearnerCount,
      completedAttemptCount: Number(mockStats.completedAttemptCount || 0),
      currentPremiumLearnerCount,
      freeConvertedLearnerCount: Math.max(0, completedLearnerCount - currentPremiumLearnerCount),
      lastCompletedAt: mockStats.lastCompletedAt || null,
      isPremiumOnly: Boolean(raw.isPremiumOnly),
      isActive: Boolean(raw.isActive),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
}

async function resolveAutoMockSubjects(examType, requestedSubjectIds = []) {
  const normalizedRequested = [...new Set((Array.isArray(requestedSubjectIds) ? requestedSubjectIds : []).map(String).filter(Boolean))];
  const subjectFilter = examType === "BOTH" ? {} : { examType };
  const subjects = normalizedRequested.length
    ? await Subject.find({ _id: { $in: normalizedRequested }, ...subjectFilter }).select("_id name examType")
    : await Subject.find(subjectFilter).select("_id name examType");

  if (!subjects.length) {
    throw new AppError("No matching subjects found for auto mock generation", 400);
  }

  if (normalizedRequested.length && subjects.length !== normalizedRequested.length) {
    throw new AppError("One or more selected subjects are invalid for this exam type", 400);
  }

  const subjectKeyMap = new Map(subjects.map((item) => [String(item._id), normalizeSubjectKey(item.name)]));
  const groupedSubjectIds = {
    PHYSICS: [],
    CHEMISTRY: [],
    BIOLOGY: [],
    MATHEMATICS: [],
  };

  subjects.forEach((subject) => {
    const subjectKey = subjectKeyMap.get(String(subject._id));
    if (subjectKey && groupedSubjectIds[subjectKey]) {
      groupedSubjectIds[subjectKey].push(String(subject._id));
    }
  });

  return { subjects, groupedSubjectIds };
}

async function buildAutoMockTestPayload(payload, actorId, existing = null) {
  const examType = normalizeExamType(payload.examType || existing?.generationConfig?.examType || existing?.examType || "NEET");
  if (!["NEET", "JEE"].includes(examType)) {
    throw new AppError("Auto-generation currently supports NEET and JEE only", 400);
  }

  const preset = AUTO_MOCK_PRESET_BY_EXAM[examType];
  const markingSettingsDoc = await getOrCreateExamMarkingSettings();
  const normalizedMarkingSettings = normalizeMarkingSettingsDocument(markingSettingsDoc);
  const defaultMarkingScheme = getMarkingSchemeByExamType(normalizedMarkingSettings, examType);
  const markingOverrideEnabled =
    payload.markingOverrideEnabled !== undefined
      ? Boolean(payload.markingOverrideEnabled)
      : existing
        ? Boolean(existing.markingOverrideEnabled)
        : false;
  const providedMarkingVersion = String(payload.markingSchemeVersion ?? existing?.markingSchemeVersion ?? defaultMarkingScheme.version).trim();
  const providedMarkingScheme = payload.markingScheme ?? existing?.markingScheme;
  const effectiveMarkingScheme = markingOverrideEnabled
    ? normalizeMarkingScheme(
        {
          version: providedMarkingVersion || defaultMarkingScheme.version,
          examType: defaultMarkingScheme.examType,
          mcq: {
            correct: payload.marksPerQuestion ?? providedMarkingScheme?.mcq?.correct ?? existing?.marksPerQuestion ?? defaultMarkingScheme.mcq.correct,
            wrong: payload.negativeMarks !== undefined ? -Math.abs(Number(payload.negativeMarks)) : providedMarkingScheme?.mcq?.wrong ?? existing?.markingScheme?.mcq?.wrong ?? defaultMarkingScheme.mcq.wrong,
            unanswered: providedMarkingScheme?.mcq?.unanswered ?? existing?.markingScheme?.mcq?.unanswered ?? 0,
          },
          numerical: {
            correct: providedMarkingScheme?.numerical?.correct ?? existing?.markingScheme?.numerical?.correct ?? defaultMarkingScheme.numerical.correct,
            wrong: providedMarkingScheme?.numerical?.wrong ?? existing?.markingScheme?.numerical?.wrong ?? defaultMarkingScheme.numerical.wrong,
            unanswered: providedMarkingScheme?.numerical?.unanswered ?? existing?.markingScheme?.numerical?.unanswered ?? 0,
          },
          active: true,
        },
        defaultMarkingScheme,
      )
    : defaultMarkingScheme;
  assertValidMarkingScheme(effectiveMarkingScheme, "Applied marking scheme");
  const requestedDifficulty = String(payload.difficulty || existing?.generationConfig?.difficulty || "").trim().toLowerCase();
  const title = String(payload.title || existing?.title || `${examType} Auto Mock ${new Date().toISOString().slice(0, 10)}`).trim();
  const randomizeQuestionOrder =
    payload.randomizeQuestionOrder !== undefined
      ? Boolean(payload.randomizeQuestionOrder)
      : existing
        ? Boolean(existing.randomizeQuestionOrder ?? true)
        : true;

  const sourceSubjectIds = payload.subjectIds ?? existing?.generationConfig?.subjectIds ?? existing?.subjectIds ?? [];
  const { subjects, groupedSubjectIds } = await resolveAutoMockSubjects(examType, sourceSubjectIds);

  const baseFilter = {
    subjectId: { $in: subjects.map((item) => String(item._id)) },
    ...(examType === "NEET" || examType === "JEE"
      ? { $or: [{ examMode: examType }, { examMode: "BOTH" }] }
      : {}),
  };

  const allCandidates = await Question.find(baseFilter)
    .select("_id subjectId chapterId difficulty responseType examMode")
    .limit(20000);

  if (!allCandidates.length) {
    throw new AppError("No questions found for selected exam/subjects", 400);
  }

  const chosenQuestionIds = [];
  const chosenSet = new Set();
  const sectionGroups = [];
  const sectionShortages = [];

  for (const section of preset.sectionGroups) {
    const sectionSubjectIds = groupedSubjectIds[section.subjectKey] || [];
    if (!sectionSubjectIds.length) {
      throw new AppError(`Missing required subject pool for section ${section.label}`, 400);
    }

    const primaryPool = allCandidates.filter((question) => {
      if (!sectionSubjectIds.includes(String(question.subjectId))) return false;
      if (chosenSet.has(String(question._id))) return false;
      if (section.questionType === "NUMERICAL") return normalizeQuestionTypeBucket(question) === "NUMERICAL";
      if (section.questionType === "MCQ") return normalizeQuestionTypeBucket(question) === "MCQ";
      return true;
    });

    let selected = chooseBalancedQuestions(primaryPool, section.totalQuestions, requestedDifficulty);
    if (selected.length < section.totalQuestions) {
      const fallbackPool = allCandidates.filter((question) => {
        if (!sectionSubjectIds.includes(String(question.subjectId))) return false;
        if (chosenSet.has(String(question._id))) return false;
        return true;
      });
      const fallbackSelected = chooseBalancedQuestions(fallbackPool, section.totalQuestions, requestedDifficulty);
      selected = fallbackSelected;
    }

    const requiredQuestions = Number(section.totalQuestions || 0);
    const availableQuestions = selected.length;
    if (availableQuestions < requiredQuestions) {
      sectionShortages.push({
        sectionKey: section.key,
        sectionLabel: section.label,
        requiredQuestions,
        availableQuestions,
      });
    }
    if (availableQuestions <= 0) {
      continue;
    }

    selected.forEach((question) => {
      const id = String(question._id);
      if (!chosenSet.has(id)) {
        chosenSet.add(id);
        chosenQuestionIds.push(id);
      }
    });

    const sectionAttemptQuestions = Math.min(
      Number(section.attemptQuestions || availableQuestions),
      availableQuestions,
    );

    sectionGroups.push({
      key: section.key,
      label: section.label,
      subjectKey: section.subjectKey,
      questionType: section.questionType,
      totalQuestions: availableQuestions,
      attemptQuestions: sectionAttemptQuestions,
      requestedTotalQuestions: requiredQuestions,
      requestedAttemptQuestions: Number(section.attemptQuestions || sectionAttemptQuestions),
      questionIds: selected.map((question) => String(question._id)),
    });
  }

  if (chosenQuestionIds.length === 0) {
    throw new AppError("No questions available to generate mock test for selected filters", 400);
  }

  const selectedQuestions = allCandidates.filter((question) => chosenSet.has(String(question._id)));
  const subjectIds = [...new Set(selectedQuestions.map((item) => String(item.subjectId)).filter(Boolean))];
  const chapterIds = [...new Set(selectedQuestions.map((item) => String(item.chapterId)).filter(Boolean))];
  const marksPerQuestion = Number(effectiveMarkingScheme?.mcq?.correct ?? payload.marksPerQuestion ?? existing?.marksPerQuestion ?? preset.marksPerQuestion);
  const negativeMarks = Math.abs(Number(effectiveMarkingScheme?.mcq?.wrong ?? -(payload.negativeMarks ?? existing?.negativeMarks ?? preset.negativeMarks)));
  const computedAttemptQuestions = sectionGroups.reduce((sum, item) => sum + Number(item.attemptQuestions || 0), 0);
  const requestedAttemptQuestions = Number(payload.totalAttemptQuestions ?? preset.totalAttemptQuestions);
  const totalAttemptQuestions = Math.max(
    1,
    Math.min(
      chosenQuestionIds.length,
      computedAttemptQuestions || requestedAttemptQuestions,
      sectionShortages.length ? computedAttemptQuestions || requestedAttemptQuestions : requestedAttemptQuestions,
    ),
  );
  const selectedQuestionMap = new Map(selectedQuestions.map((item) => [String(item._id), item]));
  const questionMarkingRules = buildQuestionMarkingRules(chosenQuestionIds, selectedQuestionMap, effectiveMarkingScheme);
  const computedMaxScore = calculateMaxScoreFromRules(questionMarkingRules, totalAttemptQuestions);
  const maxScore = Number(
    payload.maxScore
      ?? (sectionShortages.length ? computedMaxScore : existing?.maxScore)
      ?? computedMaxScore,
  );
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    throw new AppError("Generated max score is invalid. Check marking settings.", 400);
  }

  const historyEntry = {
    id: new mongoose.Types.ObjectId().toString(),
    generatedAt: new Date().toISOString(),
    generatedBy: actorId ? String(actorId) : null,
    mode: existing ? "regenerate" : "generate",
      examType,
      difficulty: requestedDifficulty || "mixed",
      subjectIds,
      totalQuestions: chosenQuestionIds.length,
      totalAttemptQuestions,
      markingSchemeVersion: effectiveMarkingScheme.version,
      markingOverrideEnabled,
      shortages: sectionShortages,
    };

  const previousHistory = Array.isArray(existing?.generationHistory) ? existing.generationHistory : [];
  const nextHistory = [...previousHistory, historyEntry].slice(-AUTO_MOCK_HISTORY_LIMIT);
  const availabilityMode = String(payload.availabilityMode ?? existing?.availabilityMode ?? "all").toLowerCase();
  const availableDaysOfMonth = Array.isArray(payload.availableDaysOfMonth)
    ? payload.availableDaysOfMonth.map(Number).filter((value) => value >= 1 && value <= 31)
    : (Array.isArray(existing?.availableDaysOfMonth) ? existing.availableDaysOfMonth : []);
  const availableWeekdays = Array.isArray(payload.availableWeekdays)
    ? payload.availableWeekdays.map((value) => String(value).toUpperCase()).filter((value) => WEEKDAY_OPTIONS.includes(value))
    : (Array.isArray(existing?.availableWeekdays) ? existing.availableWeekdays : []);

  if (!["all", "day_wise", "week_wise"].includes(availabilityMode)) {
    throw new AppError("Availability mode is invalid", 400);
  }
  if (availabilityMode === "day_wise" && !availableDaysOfMonth.length) {
    throw new AppError("Select at least one day of month for day-wise availability", 400);
  }
  if (availabilityMode === "week_wise" && !availableWeekdays.length) {
    throw new AppError("Select at least one weekday for week-wise availability", 400);
  }

  return {
    title,
    slug: await ensureUniqueMockTestSlug(title, existing?._id),
    description: String(payload.description ?? existing?.description ?? `${examType} auto-generated mock test`).trim() || undefined,
    examType,
    patternPreset: preset.patternPreset,
    durationMinutes: Number(payload.durationMinutes ?? existing?.durationMinutes ?? preset.durationMinutes),
    totalQuestions: chosenQuestionIds.length,
    totalAttemptQuestions,
    maxScore,
    questionIds: chosenQuestionIds,
    subjectIds,
    chapterIds,
    instructions: Array.isArray(payload.instructions)
      ? payload.instructions.map((item) => String(item).trim()).filter(Boolean)
      : (Array.isArray(existing?.instructions) && existing.instructions.length ? existing.instructions : MOCK_TEST_PRESETS[preset.patternPreset]?.instructions || []),
    marksPerQuestion,
    negativeMarks,
    markingSchemeVersion: effectiveMarkingScheme.version,
    markingScheme: effectiveMarkingScheme,
    questionMarkingRules,
    markingOverrideEnabled,
    predictionTitle: String(payload.predictionTitle ?? existing?.predictionTitle ?? MOCK_TEST_PRESETS[preset.patternPreset]?.predictionTitle ?? `Predicted ${examType} Score`).trim(),
    predictionDescription: String(payload.predictionDescription ?? existing?.predictionDescription ?? MOCK_TEST_PRESETS[preset.patternPreset]?.predictionDescription ?? "").trim(),
    availabilityMode,
    availableDaysOfMonth: availabilityMode === "day_wise" ? availableDaysOfMonth : [],
    availableWeekdays: availabilityMode === "week_wise" ? availableWeekdays : [],
    sectionGroups,
    generationSource: "auto",
    generationConfig: {
      examType,
      subjectIds,
      difficulty: requestedDifficulty || "mixed",
      markingSchemeVersion: effectiveMarkingScheme.version,
      markingOverrideEnabled,
      strictPattern: sectionShortages.length === 0,
      shortages: sectionShortages,
    },
    generationHistory: nextHistory,
    randomizeQuestionOrder,
    freeAccessDurationValue: Math.max(1, Number(payload.freeAccessDurationValue ?? existing?.freeAccessDurationValue ?? 1)),
    freeAccessDurationUnit: ["days", "weeks", "months"].includes(String(payload.freeAccessDurationUnit || existing?.freeAccessDurationUnit || "days"))
      ? String(payload.freeAccessDurationUnit || existing?.freeAccessDurationUnit || "days")
      : "days",
    premiumDurationType: ["daily", "weekly", "monthly"].includes(String(payload.premiumDurationType || existing?.premiumDurationType || "daily"))
      ? String(payload.premiumDurationType || existing?.premiumDurationType || "daily")
      : "daily",
    premiumValidityDays: Math.max(1, Number(payload.premiumValidityDays ?? existing?.premiumValidityDays ?? 1)),
    autoDailyQuestionRearrangement: payload.autoDailyQuestionRearrangement !== undefined ? Boolean(payload.autoDailyQuestionRearrangement) : Boolean(existing?.autoDailyQuestionRearrangement),
    autoDailyQuestionGeneration: payload.autoDailyQuestionGeneration !== undefined ? Boolean(payload.autoDailyQuestionGeneration) : Boolean(existing?.autoDailyQuestionGeneration),
    isPremiumOnly: payload.isPremiumOnly !== undefined ? Boolean(payload.isPremiumOnly) : existing ? Boolean(existing.isPremiumOnly) : false,
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : existing ? Boolean(existing.isActive) : true,
  };
}

function normalizeModeKey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "NEET" || normalized === "JEE" || normalized === "BOTH") return normalized;
  throw new AppError("Invalid mode key. Use NEET, JEE, or BOTH.", 400);
}

async function buildDailyPlanPayload(payload, existing = null) {
  const modeKey = normalizeModeKey(payload.modeKey ?? existing?.modeKey ?? "NEET");
  const selectionMode = String(payload.selectionMode ?? existing?.selectionMode ?? "random").toLowerCase();
  const questionCount = Number(payload.questionCount ?? existing?.questionCount ?? 20);
  const manualQuestionIds = [...new Set((Array.isArray(payload.manualQuestionIds) ? payload.manualQuestionIds : existing?.manualQuestionIds || []).map(String).filter(Boolean))];
  const autoFillRemaining =
    payload.autoFillRemaining !== undefined
      ? Boolean(payload.autoFillRemaining)
      : existing
        ? Boolean(existing.autoFillRemaining)
        : true;
  const isActive =
    payload.isActive !== undefined
      ? Boolean(payload.isActive)
      : existing
        ? Boolean(existing.isActive)
        : true;

  if (!["random", "manual"].includes(selectionMode)) {
    throw new AppError("Selection mode must be random or manual", 400);
  }
  if (!Number.isFinite(questionCount) || questionCount < 1 || questionCount > 200) {
    throw new AppError("Question count must be between 1 and 200", 400);
  }

  if (selectionMode === "manual" && manualQuestionIds.length) {
    const questions = await Question.find({ _id: { $in: manualQuestionIds } })
      .select("_id examMode subjectId")
      .populate("subjectId", "examType");
    if (questions.length !== manualQuestionIds.length) {
      throw new AppError("One or more selected manual questions were not found", 400);
    }

    questions.forEach((question) => {
      const questionMode = String(question.examMode || "").toUpperCase();
      const subjectExam = String(question.subjectId?.examType || "").toUpperCase();
      const normalizedQuestionExam = questionMode === "BOTH" ? subjectExam : (questionMode || subjectExam);
      if (modeKey !== "BOTH" && normalizedQuestionExam && normalizedQuestionExam !== modeKey && normalizedQuestionExam !== "BOTH") {
        throw new AppError(`Manual question set contains a question outside ${modeKey} mode`, 400);
      }
    });
  }

  return {
    modeKey,
    selectionMode,
    questionCount,
    manualQuestionIds,
    autoFillRemaining,
    isActive,
    title: String(payload.title ?? existing?.title ?? "").trim() || undefined,
    description: String(payload.description ?? existing?.description ?? "").trim() || undefined,
  };
}

async function serializeDailyPlans(items) {
  const questionIds = [...new Set(items.flatMap((item) => item.manualQuestionIds || []).map(String).filter(Boolean))];
  const questions = questionIds.length
    ? await Question.find({ _id: { $in: questionIds } })
      .select("_id question subjectId chapterId examMode difficulty")
      .populate("subjectId", "name examType")
      .populate("chapterId", "name")
    : [];
  const questionMap = new Map(questions.map((item) => [String(item._id), item]));

  return items.map((item) => {
    const raw = typeof item?.toJSON === "function" ? item.toJSON() : item;
    const manualQuestions = (raw.manualQuestionIds || [])
      .map((questionId) => {
        const question = questionMap.get(String(questionId));
        if (!question) return null;
        return {
          id: String(question._id),
          question: question.question,
          examMode: question.examMode,
          difficulty: question.difficulty,
          subjectName: question.subjectId?.name || "-",
          chapterName: question.chapterId?.name || "-",
        };
      })
      .filter(Boolean);
    return {
      id: String(raw.id ?? raw._id),
      modeKey: raw.modeKey,
      selectionMode: raw.selectionMode,
      questionCount: Number(raw.questionCount || 20),
      manualQuestionIds: (raw.manualQuestionIds || []).map(String),
      manualQuestions,
      autoFillRemaining: Boolean(raw.autoFillRemaining),
      isActive: Boolean(raw.isActive),
      title: raw.title || "",
      description: raw.description || "",
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
}

function mapSubscriptionPlan(plan) {
  if (!plan) return null;
  return {
    id: plan.planId,
    name: plan.name,
    price: Number(plan.price || 0),
    durationMonths: Number(plan.durationMonths || 0),
    savings: plan.savings || "",
    features: Array.isArray(plan.features) ? plan.features.filter(Boolean) : [],
    active: Boolean(plan.active),
    sortOrder: Number(plan.sortOrder || 0),
    recordId: String(plan._id),
  };
}

async function getSubscriptionPlanByPlanId(planId) {
  const normalizedPlanId = String(planId || "").trim();
  if (!normalizedPlanId) throw new AppError("Plan id is required", 400);
  const plan = await SubscriptionPlan.findOne({ planId: normalizedPlanId });
  if (!plan) throw new AppError("Selected plan was not found", 400);
  return plan;
}

const subscriptionListQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    status: z.string().optional(),
    planId: z.string().optional(),
    sortBy: z.enum(["createdAt", "updatedAt", "amount", "endDate", "startDate"]).optional().default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  }),
});

const manualSubscriptionSchema = z.object({
  body: z.object({
    userId: z.string().min(1),
    planId: z.string().min(1),
    status: z.enum(["active", "completed", "manual"]).optional().default("active"),
    startDate: z.string().datetime().optional().or(z.literal("")),
    endDate: z.string().datetime().optional().or(z.literal("")),
    paymentId: z.string().optional().or(z.literal("")),
    orderId: z.string().optional().or(z.literal("")),
    couponCode: z.string().optional().or(z.literal("")),
  }),
});

const couponPreviewSchema = z.object({
  body: z.object({
    planId: z.string().min(1),
    couponCode: z.string().optional().or(z.literal("")),
  }),
});

const cancelSubscriptionSchema = z.object({
  body: z.object({
    status: z.enum(["cancelled", "expired"]).optional().default("cancelled"),
  }),
});

const paymentGatewaySettingsSchema = z.object({
  body: z.object({
    provider: z.literal("razorpay").default("razorpay"),
    razorpayKeyId: z.string().trim().min(1, "Razorpay Key ID is required"),
    razorpayKeySecret: z.string().trim().optional().or(z.literal("")),
    enabled: z.coerce.boolean().optional().default(true),
  }),
});

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function mapPaymentGatewaySettings(settings) {
  return {
    provider: settings?.provider || "razorpay",
    razorpayKeyId: settings?.razorpayKeyId || "",
    razorpayKeySecretMasked: maskSecret(settings?.razorpayKeySecret),
    hasRazorpayKeySecret: Boolean(settings?.razorpayKeySecret),
    enabled: Boolean(settings?.enabled),
    connectionStatus: settings?.connectionStatus || "not_configured",
    connectionMessage: settings?.connectionMessage || "",
    connectedAt: settings?.connectedAt,
    updatedAt: settings?.updatedAt,
  };
}

async function testRazorpayCredentials(keyId, keySecret) {
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments?count=1", {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    let detail = "Razorpay rejected the configured credentials";
    try {
      const payload = await response.json();
      detail = payload?.error?.description || payload?.error?.reason || detail;
    } catch (_error) {
      detail = `${detail} (${response.status})`;
    }
    throw new AppError(detail, 400);
  }
}

router.get(
  "/subscription-plans",
  asyncHandler(async (_req, res) => {
    const plans = await SubscriptionPlan.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean();
    res.json({ success: true, data: plans.map(mapSubscriptionPlan) });
  }),
);

router.get(
  "/payment-gateway-settings",
  asyncHandler(async (_req, res) => {
    const settings = await PaymentGatewaySettings.findOne({ provider: "razorpay" });
    res.json({ success: true, data: mapPaymentGatewaySettings(settings) });
  }),
);

router.post(
  "/payment-gateway-settings",
  validate(paymentGatewaySettingsSchema),
  asyncHandler(async (req, res) => {
    const { razorpayKeyId, razorpayKeySecret, enabled } = req.validated.body;
    const existing = await PaymentGatewaySettings.findOne({ provider: "razorpay" });
    const nextSecret = razorpayKeySecret || existing?.razorpayKeySecret;

    if (!nextSecret) {
      throw new AppError("Razorpay Key Secret is required", 400);
    }

    await testRazorpayCredentials(razorpayKeyId, nextSecret);

    const settings = await PaymentGatewaySettings.findOneAndUpdate(
      { provider: "razorpay" },
      {
        provider: "razorpay",
        razorpayKeyId,
        razorpayKeySecret: nextSecret,
        enabled: Boolean(enabled),
        connectionStatus: "connected",
        connectionMessage: "Razorpay connection established successfully.",
        connectedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json({
      success: true,
      message: "Razorpay connection established successfully",
      data: mapPaymentGatewaySettings(settings),
    });
  }),
);

async function resolveCoupon(plan, couponCode) {
  const normalizedCode = String(couponCode || "").trim().toUpperCase();
  const mappedPlan = mapSubscriptionPlan(plan);
  const baseAmount = Number(mappedPlan?.price || 0);
  if (!normalizedCode) {
    return {
      coupon: null,
      pricing: {
        baseAmount,
        discountAmount: 0,
        finalAmount: baseAmount,
        coupon: null,
      },
    };
  }

  const coupon = await Coupon.findOne({ code: normalizedCode });
  if (!coupon) throw new AppError("Coupon not found", 404);
  if (!coupon.active) throw new AppError("Coupon is inactive", 400);
  if (coupon.validFrom && new Date(coupon.validFrom) > new Date()) throw new AppError("Coupon is not active yet", 400);
  if (coupon.validUntil && new Date(coupon.validUntil) < new Date()) throw new AppError("Coupon has expired", 400);
  if (coupon.usageLimit && Number(coupon.usedCount || 0) >= Number(coupon.usageLimit)) {
    throw new AppError("Coupon usage limit reached", 400);
  }

  const rawDiscount = coupon.type === "percent" ? (baseAmount * Number(coupon.value)) / 100 : Number(coupon.value);
  const discountAmount = Math.min(baseAmount, Math.max(0, Math.round(rawDiscount)));
  const finalAmount = Math.max(0, baseAmount - discountAmount);

  return {
    coupon,
    pricing: {
      baseAmount,
      discountAmount,
      finalAmount,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
      },
    },
  };
}

async function refreshUserPremiumState(userId) {
  const activeSubscription = await Subscription.findOne({
    userId,
    status: { $in: ["active", "manual", "completed"] },
    endDate: { $gt: new Date() },
  }).sort({ endDate: -1 });

  await User.findByIdAndUpdate(userId, {
    isPremium: Boolean(activeSubscription),
    premiumExpiresAt: activeSubscription?.endDate,
  });
}

router.post(
  "/subscriptions/coupon-preview",
  validate(couponPreviewSchema),
  asyncHandler(async (req, res) => {
    const { planId, couponCode } = req.validated.body;
    const plan = await getSubscriptionPlanByPlanId(planId);

    const { pricing } = await resolveCoupon(plan, couponCode);
    res.json({ success: true, data: { plan: mapSubscriptionPlan(plan), ...pricing } });
  }),
);

router.get(
  "/subscriptions",
  validate(subscriptionListQuerySchema),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search = "", status, planId, sortBy = "createdAt", sortOrder = "desc" } = req.validated.query;
    const filters = {};

    if (status) filters.status = status;
    if (planId) filters.planId = planId;

    let userMap = new Map();
    if (search) {
      const users = await User.find({
        $or: [
          { name: new RegExp(search, "i") },
          { email: new RegExp(search, "i") },
          { mobile: new RegExp(search, "i") },
        ],
      })
        .select("_id name email mobile")
        .lean();

      const matchingUserIds = users.map((item) => String(item._id));
      if (matchingUserIds.length) {
        filters.$or = [
          { userId: { $in: matchingUserIds } },
          { planId: new RegExp(search, "i") },
          { couponCode: new RegExp(search, "i") },
          { status: new RegExp(search, "i") },
          { razorpayOrderId: new RegExp(search, "i") },
          { razorpayPaymentId: new RegExp(search, "i") },
        ];
      } else {
        filters.$or = [
          { planId: new RegExp(search, "i") },
          { couponCode: new RegExp(search, "i") },
          { status: new RegExp(search, "i") },
          { razorpayOrderId: new RegExp(search, "i") },
          { razorpayPaymentId: new RegExp(search, "i") },
        ];
      }
      userMap = new Map(users.map((item) => [String(item._id), item]));
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Subscription.find(filters)
        .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Subscription.countDocuments(filters),
    ]);

    const missingUserIds = [...new Set(items.map((item) => String(item.userId)).filter((id) => !userMap.has(id)))];
    if (missingUserIds.length) {
      const extraUsers = await User.find({ _id: { $in: missingUserIds } }).select("_id name email mobile isPremium premiumExpiresAt").lean();
      extraUsers.forEach((item) => userMap.set(String(item._id), item));
    }

    const subscriptionPlanIds = [...new Set(items.map((item) => String(item.planId)).filter(Boolean))];
    const plans = subscriptionPlanIds.length
      ? await SubscriptionPlan.find({ planId: { $in: subscriptionPlanIds } }).select("planId name price durationMonths active savings features sortOrder").lean()
      : [];
    const planMap = new Map(plans.map((item) => [String(item.planId), item]));

    const data = items.map((item) => {
      const user = userMap.get(String(item.userId));
      const plan = planMap.get(String(item.planId));
      return {
        id: String(item._id),
        ...item,
        plan: plan ? mapSubscriptionPlan(plan) : null,
        user: user
          ? {
              id: String(user._id),
              name: user.name,
              email: user.email,
              mobile: user.mobile,
              isPremium: Boolean(user.isPremium),
              premiumExpiresAt: user.premiumExpiresAt,
            }
          : null,
      };
    });

    res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }),
);

router.post(
  "/subscriptions/manual",
  validate(manualSubscriptionSchema),
  asyncHandler(async (req, res) => {
    throw new AppError("Manual premium activation is disabled. Premium access is activated only after a successful Razorpay payment.", 400);
    const { userId, planId, status, startDate, endDate, paymentId, orderId, couponCode } = req.validated.body;
    const user = await User.findById(userId);
    if (!user) throw new AppError("Selected user was not found", 404);

    const plan = await getSubscriptionPlanByPlanId(planId);

    const { coupon, pricing } = await resolveCoupon(plan, couponCode);

    const start = startDate ? new Date(startDate) : new Date();
    const expiresAt = endDate
      ? new Date(endDate)
      : new Date(new Date(start).setMonth(new Date(start).getMonth() + Number(plan.durationMonths || 0)));

    const subscription = await Subscription.create({
      userId: String(user._id),
      planId,
      baseAmount: pricing.baseAmount,
      discountAmount: pricing.discountAmount,
      amount: pricing.finalAmount,
      status,
      startDate: start,
      endDate: expiresAt,
      razorpayPaymentId: paymentId || `manual_${Date.now()}`,
      razorpayOrderId: orderId || `admin_manual_${Date.now()}`,
      couponCode: coupon?.code,
      couponType: coupon?.type,
      couponValue: coupon?.value,
    });

    user.isPremium = true;
    user.premiumExpiresAt = expiresAt;
    await user.save();
    if (coupon) {
      coupon.usedCount = Number(coupon.usedCount || 0) + 1;
      await coupon.save();
    }

    res.status(201).json({
      success: true,
      message: "Manual subscription activated",
      data: {
        ...(typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription),
        pricing,
      },
    });
  }),
);

router.post(
  "/subscriptions/:id/cancel",
  validate(cancelSubscriptionSchema),
  asyncHandler(async (req, res) => {
    const subscription = await Subscription.findById(req.params.id);
    if (!subscription) throw new AppError("Subscription not found", 404);

    subscription.status = req.validated.body.status;
    subscription.endDate = new Date();
    await subscription.save();
    await refreshUserPremiumState(subscription.userId);

    res.json({
      success: true,
      message: "Subscription updated",
      data: subscription,
    });
  }),
);

router.get(
  "/invoice-settings",
  asyncHandler(async (_req, res) => {
    const settings = await getInvoiceSettingsDoc();
    res.json({ success: true, data: settings.toJSON() });
  }),
);

router.get(
  "/app-settings",
  asyncHandler(async (_req, res) => {
    const settings = await getInvoiceSettingsDoc();
    res.json({
      success: true,
      data: {
        appName: settings.companyName || "Krita NEET JEE",
        logoUrl: settings.logoUrl || "",
        updatedAt: settings.updatedAt,
      },
    });
  }),
);

router.post(
  "/app-settings/logo",
  upload.single("logo"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError("Logo file is required", 400);
    const invoiceUploadsRoot = path.join(uploadsRoot, "invoice-assets");
    ensureDir(invoiceUploadsRoot);
    const fileName = `app-logo-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${path.extname(invoiceAssetFileName(req.file)) || ".png"}`;
    await fs.writeFile(path.join(invoiceUploadsRoot, fileName), req.file.buffer);
    const logoUrl = `/uploads/invoice-assets/${fileName}`;
    const settings = await getInvoiceSettingsDoc();
    settings.logoUrl = logoUrl;
    await settings.save();
    res.status(201).json({
      success: true,
      message: "App logo uploaded",
      data: {
        appName: settings.companyName || "Krita NEET JEE",
        logoUrl,
        updatedAt: settings.updatedAt,
      },
    });
  }),
);

router.post(
  "/invoice-settings/logo",
  upload.single("logo"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError("Logo file is required", 400);
    const baseName = sanitizeFileName(req.file.originalname || "invoice-logo.png");
    const dotIndex = baseName.lastIndexOf(".");
    const ext = dotIndex > 0 ? baseName.slice(dotIndex) : ".png";
    const fileName = `invoice-logo-${Date.now()}${ext}`;
    const invoiceUploadsRoot = `${questionUploadsRoot}/../invoice-assets`;
    ensureDir(invoiceUploadsRoot);
    await fs.writeFile(`${invoiceUploadsRoot}/${fileName}`, req.file.buffer);
    const logoUrl = `/uploads/invoice-assets/${fileName}`;
    const settings = await getInvoiceSettingsDoc();
    settings.logoUrl = logoUrl;
    await settings.save();
    res.status(201).json({ success: true, message: "Invoice logo uploaded", data: { logoUrl } });
  }),
);

router.post(
  "/invoice-settings/assets",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError("Image file is required", 400);
    const allowed = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]);
    if (!allowed.has(req.file.mimetype)) {
      throw new AppError("Only image files are allowed (jpg, png, gif, webp, svg)", 400);
    }
    const invoiceUploadsRoot = path.join(uploadsRoot, "invoice-assets");
    ensureDir(invoiceUploadsRoot);
    const fileName = invoiceAssetFileName(req.file);
    await fs.writeFile(path.join(invoiceUploadsRoot, fileName), req.file.buffer);
    const url = `/uploads/invoice-assets/${fileName}`;
    res.status(201).json({
      success: true,
      message: "Invoice image uploaded",
      data: {
        fileName,
        url,
        publicUrl: absoluteRequestUrl(req, url),
        html: `<img src="${absoluteRequestUrl(req, url)}" alt="${escapeHtml(req.file.originalname || "Invoice image")}" />`,
      },
    });
  }),
);

router.post(
  "/invoice-settings",
  asyncHandler(async (req, res) => {
    const settings = await getInvoiceSettingsDoc();
    const body = req.body || {};
    settings.enabled = body.enabled === undefined ? settings.enabled : Boolean(body.enabled);
    settings.emailEnabled = body.emailEnabled === undefined ? settings.emailEnabled : Boolean(body.emailEnabled);
    settings.companyName = String(body.companyName || "Krita NEET JEE").trim();
    settings.companyAddress = String(body.companyAddress || "");
    settings.companyEmail = String(body.companyEmail || "");
    settings.companyPhone = String(body.companyPhone || "");
    settings.logoUrl = String(body.logoUrl || settings.logoUrl || "");
    settings.templateTitle = String(body.templateTitle || "Tax Invoice");
    settings.templateIntro = String(body.templateIntro || "");
    settings.footerText = String(body.footerText || "");
    settings.productDetailsTitle = String(body.productDetailsTitle || "Product Details");
    settings.paidStampText = String(body.paidStampText || "PAID");
    settings.defaultTaxPercent = Math.max(0, Math.min(100, Number(body.defaultTaxPercent ?? settings.defaultTaxPercent ?? 0)));
    settings.defaultConvenienceChargePercent = Math.max(0, Math.min(100, Number(body.defaultConvenienceChargePercent ?? settings.defaultConvenienceChargePercent ?? 0)));
    settings.defaultConvenienceChargeGstPercent = Math.max(0, Math.min(100, Number(body.defaultConvenienceChargeGstPercent ?? settings.defaultConvenienceChargeGstPercent ?? 0)));
    const normalizeFields = (fields = []) => fields.map((field) => ({
        ...field,
        id: String(field.id || `field-${Date.now()}`),
        type: String(field.type || "text"),
        label: String(field.label || field.content || ""),
        content: String(field.content || field.label || ""),
        src: String(field.src || ""),
        x: Math.max(0, Math.min(560, Number(field.x || 48))),
        y: Math.max(0, Math.min(820, Number(field.y || 120))),
        width: Math.max(10, Math.min(595, Number(field.width || 120))),
        height: Math.max(10, Math.min(842, Number(field.height || 80))),
        size: Math.max(6, Math.min(96, Number(field.size || field.style?.fontSize || 10))),
        rotation: Number(field.rotation || 0),
        opacity: Math.max(0, Math.min(1, Number(field.opacity ?? 1))),
        zIndex: Number(field.zIndex || 1),
        enabled: field.enabled !== false,
      }));
    if (Array.isArray(body.fields)) {
      settings.fields = normalizeFields(body.fields);
    }
    settings.page = body.page || settings.page || {};
    if (Array.isArray(body.reusableBlocks)) {
      const blocks = body.reusableBlocks.map((block) => ({
        ...block,
        id: String(block.id || `template-${Date.now()}-${Math.floor(Math.random() * 1000)}`),
        name: String(block.name || "Invoice Template"),
        type: String(block.type || "fabric-template"),
        fields: Array.isArray(block.fields) ? normalizeFields(block.fields) : block.fields,
      }));
      const activeIndex = blocks.findIndex((block) => block.type === "fabric-template" && block.active);
      settings.reusableBlocks = blocks.map((block, index) => block.type === "fabric-template" ? { ...block, active: activeIndex >= 0 ? index === activeIndex : index === 0 } : block);
      const active = getActiveInvoiceTemplate(settings);
      settings.activeTemplateId = active?.id || "";
      settings.activeTemplateName = active?.name || "";
      const requestedConnectedId = String(body.connectedTemplateId ?? settings.connectedTemplateId ?? "");
      const connected = requestedConnectedId
        ? blocks.find((block) => block.type === "fabric-template" && String(block.id) === requestedConnectedId)
        : null;
      settings.connectedTemplateId = connected?.id || "";
      settings.connectedTemplateName = connected?.name || "";
      settings.connectedTemplateAt = connected ? (settings.connectedTemplateAt || new Date()) : undefined;
      settings.connectionStatus = connected ? "connected" : "not_connected";
      settings.reusableBlocks = settings.reusableBlocks.map((block) => block.type === "fabric-template" ? { ...block, connected: connected ? String(block.id) === String(connected.id) : false } : block);
      if (Array.isArray(active?.fields) && active.fields.length) settings.fields = normalizeFields(active.fields);
    }
    settings.defaultTemplate = body.defaultTemplate === undefined ? settings.defaultTemplate : Boolean(body.defaultTemplate);
    settings.versions = [
      {
        savedAt: new Date(),
        label: `Version ${new Date().toLocaleString("en-IN")}`,
        fields: settings.fields,
        page: settings.page,
      },
      ...(Array.isArray(settings.versions) ? settings.versions.slice(0, 9) : []),
    ];
    const smtp = body.smtp || {};
    settings.smtp = {
      host: String(smtp.host || settings.smtp?.host || ""),
      port: Number(smtp.port || settings.smtp?.port || 587),
      secure: Boolean(smtp.secure),
      user: String(smtp.user || settings.smtp?.user || ""),
      pass: smtp.pass ? String(smtp.pass) : String(settings.smtp?.pass || ""),
      fromName: String(smtp.fromName || settings.smtp?.fromName || "Krita Admin"),
      fromEmail: String(smtp.fromEmail || settings.smtp?.fromEmail || ""),
    };
    await settings.save();
    res.json({ success: true, message: "Invoice settings saved", data: settings.toJSON() });
  }),
);

router.post(
  "/invoice-settings/test-email",
  asyncHandler(async (req, res) => {
    const settings = await getInvoiceSettingsDoc();
    const to = String(req.body?.to || settings.companyEmail || settings.smtp?.fromEmail || "").trim();
    if (!to) throw new AppError("Test recipient email is required", 400);

    const result = await sendTemplatedEmail(EMAIL_TEMPLATE_KEYS.SMTP_TEST, to, {
      user_name: "Test User",
      email: to,
      app_name: settings.companyName || "Krita",
      company_name: settings.companyName || "Krita",
      support_email: settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com",
    });

    res.json({
      success: true,
      message: result.skipped ? "SMTP test skipped" : "SMTP test email sent",
      data: result,
    });
  }),
);

router.post(
  "/invoice-settings/connect-template",
  asyncHandler(async (req, res) => {
    const settings = await getInvoiceSettingsDoc();
    const templateId = String(req.body?.templateId || "").trim();
    if (!templateId) throw new AppError("Select an invoice template to connect", 400);
    const blocks = Array.isArray(settings.reusableBlocks) ? settings.reusableBlocks : [];
    const template = blocks.find((block) => block?.type === "fabric-template" && String(block.id) === templateId);
    if (!template) throw new AppError("Invoice template not found", 404);
    if (!String(template.htmlCode || "").trim() || !String(template.cssCode || "").trim()) {
      throw new AppError("Only Invoice Editor HTML/CSS templates can be connected to email", 400);
    }
    settings.reusableBlocks = blocks.map((block) => block?.type === "fabric-template"
      ? { ...block, active: String(block.id) === templateId, connected: String(block.id) === templateId, connectedAt: String(block.id) === templateId ? new Date().toISOString() : undefined }
      : block);
    settings.activeTemplateId = template.id || "";
    settings.activeTemplateName = template.name || "Invoice Template";
    settings.connectedTemplateId = template.id || "";
    settings.connectedTemplateName = template.name || "Invoice Template";
    settings.connectedTemplateAt = new Date();
    settings.connectionStatus = "connected";
    await settings.save();
    res.json({ success: true, message: "Invoice template successfully connected to email", data: settings.toJSON() });
  }),
);

router.post(
  "/invoice-settings/test-invoice",
  asyncHandler(async (req, res) => {
    const settings = await getInvoiceSettingsDoc();
    requireConnectedInvoiceTemplate(settings);
    const to = String(req.body?.to || settings.companyEmail || settings.smtp?.fromEmail || "").trim();
    if (!to) throw new AppError("Test recipient email is required", 400);
    const now = new Date();
    const testSubtotal = 1000;
    const testDiscount = 100;
    const testTaxPercent = Number(settings.defaultTaxPercent ?? 0);
    const testConveniencePercent = Number(settings.defaultConvenienceChargePercent ?? 0);
    const testConvenienceGstPercent = Number(settings.defaultConvenienceChargeGstPercent ?? 0);
    const testTaxable = Math.max(0, testSubtotal - testDiscount);
    const testTax = Math.round(((testTaxable * testTaxPercent) / 100) * 100) / 100;
    const testAmountBeforeCharges = Math.round((testTaxable + testTax) * 100) / 100;
    const testConvenience = Math.round(((testAmountBeforeCharges * testConveniencePercent) / 100) * 100) / 100;
    const testConvenienceGst = Math.floor(((testConvenience * testConvenienceGstPercent) / 100) * 100) / 100;
    const testGrandTotal = Math.round((testAmountBeforeCharges + testConvenience + testConvenienceGst) * 100) / 100;
    const sampleInvoice = {
      invoiceNumber: `TEST-${now.toISOString().slice(0, 10).replace(/-/g, "")}`,
      userName: "Test Customer",
      userEmail: to,
      userMobile: "8000000001",
      customerCompany: { name: "Test Customer", email: to, phone: "8000000001", address: "Sample billing address" },
      planId: "test-plan",
      planName: "Premium Plan",
      currency: "INR",
      status: "paid",
      invoiceDate: now,
      dueDate: now,
      transactionId: "test_txn_123456",
      subtotal: testSubtotal,
      discountTotal: testDiscount,
      taxTotal: testTax,
      convenienceCharge: testConvenience,
      convenienceChargeGst: testConvenienceGst,
      grandTotal: testGrandTotal,
      amount: testGrandTotal,
      notes: "This is a test invoice generated for template and email verification.",
      terms: "No payment is required for this test invoice.",
      items: [{ product: "Premium Subscription", description: "Template test item", quantity: 1, price: testSubtotal, discount: testDiscount, tax: testTaxPercent, total: testAmountBeforeCharges }],
    };
    const pdf = await renderInvoicePdf(sampleInvoice, settings, { planName: "Premium Plan" }, { requireConnectedTemplate: true });
    const result = await sendTemplatedEmail(EMAIL_TEMPLATE_KEYS.INVOICE_TEST, to, {
      user_name: sampleInvoice.userName,
      customer_name: sampleInvoice.userName,
      email: to,
      invoice_number: sampleInvoice.invoiceNumber,
      invoice_amount: `${sampleInvoice.currency} ${Number(sampleInvoice.amount || 0).toFixed(2)}`,
      company_name: settings.companyName || "Krita",
      support_email: settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com",
    }, [{ filename: `${sampleInvoice.invoiceNumber}.pdf`, contentType: "application/pdf", content: pdf }], {
      smtp: settings.smtp || {},
      logger: req.logger || console,
    });
    res.json({ success: true, message: result.skipped ? "Test invoice email skipped" : "Test invoice email sent", data: result });
  }),
);

function calculateInvoiceTotals(items = []) {
  return items.reduce(
    (acc, item) => {
      const quantity = Math.max(0, Number(item.quantity || 0));
      const price = Math.max(0, Number(item.price || 0));
      const discount = Math.max(0, Number(item.discount || 0));
      const tax = Math.max(0, Number(item.tax || 0));
      const lineBase = quantity * price;
      const lineDiscount = Math.min(lineBase, discount);
      const taxable = Math.max(0, lineBase - lineDiscount);
      const lineTax = (taxable * tax) / 100;
      const total = taxable + lineTax;
      acc.subtotal += lineBase;
      acc.discountTotal += lineDiscount;
      acc.taxTotal += lineTax;
      acc.grandTotal += total;
      acc.items.push({ ...item, quantity, price, discount: lineDiscount, tax, total });
      return acc;
    },
    { subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0, items: [] },
  );
}

function normalizeInvoicePayload(body = {}, existing = {}) {
  const totals = calculateInvoiceTotals(Array.isArray(body.items) ? body.items : existing.items || []);
  const now = new Date();
  const allowedStatuses = new Set(["draft", "sent", "paid", "pending", "overdue", "cancelled", "void", "failed"]);
  const status = String(body.status || existing.status || "draft").toLowerCase();
  return {
    invoiceNumber: String(body.invoiceNumber || existing.invoiceNumber || `INV-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`).trim(),
    userId: String(body.userId || existing.userId || "manual"),
    subscriptionId: String(body.subscriptionId || existing.subscriptionId || `manual-${Date.now()}`),
    planId: String(body.planId || existing.planId || "manual"),
    userName: String(body.userName || body.customerCompany?.name || existing.userName || ""),
    userEmail: String(body.userEmail || body.customerCompany?.email || existing.userEmail || ""),
    userMobile: String(body.userMobile || body.customerCompany?.phone || existing.userMobile || ""),
    amount: Number(totals.grandTotal || body.amount || existing.amount || 0),
    currency: String(body.currency || existing.currency || "INR"),
    status: allowedStatuses.has(status) ? status : "draft",
    transactionId: String(body.transactionId || existing.transactionId || ""),
    invoiceDate: body.invoiceDate ? new Date(String(body.invoiceDate)) : existing.invoiceDate || now,
    dueDate: body.dueDate ? new Date(String(body.dueDate)) : existing.dueDate,
    billingCompany: body.billingCompany || existing.billingCompany || {},
    customerCompany: body.customerCompany || existing.customerCompany || {},
    taxDetails: body.taxDetails || existing.taxDetails || {},
    items: totals.items,
    subtotal: Math.round(totals.subtotal * 100) / 100,
    taxTotal: Math.round(totals.taxTotal * 100) / 100,
    discountTotal: Math.round(totals.discountTotal * 100) / 100,
    grandTotal: Math.round(totals.grandTotal * 100) / 100,
    notes: String(body.notes || existing.notes || ""),
    terms: String(body.terms || existing.terms || ""),
    signatureUrl: String(body.signatureUrl || existing.signatureUrl || ""),
    logoUrl: String(body.logoUrl || existing.logoUrl || ""),
    qrCode: String(body.qrCode || existing.qrCode || ""),
    templateId: String(body.templateId || existing.templateId || ""),
    templateName: String(body.templateName || existing.templateName || ""),
    shareToken: String(body.shareToken || existing.shareToken || crypto.randomBytes(12).toString("hex")),
    paymentHistory: Array.isArray(body.paymentHistory) ? body.paymentHistory : existing.paymentHistory || [],
  };
}

router.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 200);
    const search = String(req.query.search || req.query.q || "").trim();
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.emailStatus) filters.emailStatus = req.query.emailStatus;
    if (req.query.templateId) filters.templateId = req.query.templateId;
    if (req.query.dateFrom || req.query.dateTo) {
      filters.createdAt = {};
      if (req.query.dateFrom) filters.createdAt.$gte = new Date(String(req.query.dateFrom));
      if (req.query.dateTo) {
        const end = new Date(String(req.query.dateTo));
        end.setHours(23, 59, 59, 999);
        filters.createdAt.$lte = end;
      }
    }
    if (search) {
      filters.$or = [
        { invoiceNumber: new RegExp(search, "i") },
        { userName: new RegExp(search, "i") },
        { userEmail: new RegExp(search, "i") },
        { planId: new RegExp(search, "i") },
        { transactionId: new RegExp(search, "i") },
      ];
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Invoice.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filters),
    ]);
    res.json({
      success: true,
      data: items.map((item) => ({ id: String(item._id), ...item })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.get(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid invoice id", 400);
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError("Invoice not found", 404);
    res.json({ success: true, data: invoice.toJSON() });
  }),
);

router.post(
  "/invoices",
  asyncHandler(async (req, res) => {
    const settings = await getInvoiceSettingsDoc();
    const connected = requireConnectedInvoiceTemplate(settings);
    const payload = normalizeInvoicePayload({
      ...(req.body || {}),
      templateId: connected.id || "",
      templateName: connected.name || settings.connectedTemplateName || "",
    });
    const invoice = await Invoice.create({
      ...payload,
      emailStatus: "pending",
      issuedAt: payload.invoiceDate || new Date(),
      activityLogs: [{ action: "created", message: "Manual invoice created", at: new Date() }],
    });
    await regenerateInvoicePdf(invoice, settings, {}, { requireConnectedTemplate: true });
    await invoice.save();
    res.status(201).json({ success: true, message: "Invoice created", data: invoice.toJSON() });
  }),
);

router.put(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid invoice id", 400);
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError("Invoice not found", 404);
    Object.assign(invoice, normalizeInvoicePayload(req.body || {}, invoice.toJSON()));
    invoice.activityLogs = [...(invoice.activityLogs || []), { action: "updated", message: "Invoice edited", at: new Date() }];
    await regenerateInvoicePdf(invoice, null, {}, { requireConnectedTemplate: true });
    await invoice.save();
    res.json({ success: true, message: "Invoice updated", data: invoice.toJSON() });
  }),
);

router.post(
  "/invoices/:id/duplicate",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid invoice id", 400);
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError("Invoice not found", 404);
    const raw = invoice.toJSON();
    delete raw.id;
    delete raw._id;
    const copy = await Invoice.create({
      ...raw,
      invoiceNumber: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`,
      status: "draft",
      emailStatus: "pending",
      shareToken: crypto.randomBytes(12).toString("hex"),
      activityLogs: [{ action: "duplicated", message: `Duplicated from ${invoice.invoiceNumber}`, at: new Date() }],
    });
    await regenerateInvoicePdf(copy, null, {}, { requireConnectedTemplate: true });
    await copy.save();
    res.status(201).json({ success: true, message: "Invoice duplicated", data: copy.toJSON() });
  }),
);

router.post(
  "/invoices/:id/send",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid invoice id", 400);
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError("Invoice not found", 404);
    const settings = await getInvoiceSettingsDoc();
    const connected = requireConnectedInvoiceTemplate(settings);
    if (!invoice.userEmail) throw new AppError("Invoice customer email is missing", 400);
    invoice.templateId = connected.id || invoice.templateId;
    invoice.templateName = connected.name || invoice.templateName;
    const pdf = await regenerateInvoicePdf(invoice, settings, {}, { requireConnectedTemplate: true });
    const result = await sendTemplatedEmail(EMAIL_TEMPLATE_KEYS.INVOICE_GENERATED, invoice.userEmail, {
      user_name: invoice.userName || "Customer",
      customer_name: invoice.userName || "Customer",
      email: invoice.userEmail,
      invoice_number: invoice.invoiceNumber,
      invoice_amount: `${invoice.currency} ${Number(invoice.amount || 0).toFixed(2)}`,
      payment_amount: `${invoice.currency} ${Number(invoice.amount || 0).toFixed(2)}`,
      due_date: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-IN") : "",
      payment_status: invoice.status || "sent",
      transaction_id: invoice.transactionId || "-",
      company_name: settings.companyName || "Krita",
      support_email: settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com",
    }, [{ filename: `${invoice.invoiceNumber}.pdf`, contentType: "application/pdf", content: pdf }], {
      smtp: settings.smtp || {},
      logger: req.logger || console,
    });
    invoice.emailStatus = result.skipped ? "skipped" : "sent";
    invoice.status = invoice.status === "draft" ? "sent" : invoice.status;
    invoice.sentAt = result.skipped ? undefined : new Date();
    invoice.emailError = result.skipped ? result.reason : "";
    invoice.activityLogs = [...(invoice.activityLogs || []), { action: "email", message: result.skipped ? "Email skipped" : "Invoice email sent", at: new Date() }];
    await invoice.save();
    res.json({ success: true, message: result.skipped ? "Invoice email skipped" : "Invoice email sent", data: invoice.toJSON() });
  }),
);

router.get(
  "/invoices/:id/pdf",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid invoice id", 400);
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw new AppError("Invoice not found", 404);
    const pdf = await regenerateInvoicePdf(invoice, null, {}, { requireConnectedTemplate: true });
    await invoice.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdf);
  }),
);

router.delete(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid invoice id", 400);
    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Invoice deleted", data: null });
  }),
);

router.post(
  "/invoices/subscriptions/:subscriptionId/generate",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.subscriptionId)) throw new AppError("Invalid subscription id", 400);
    const existing = await Invoice.findOne({ subscriptionId: req.params.subscriptionId });
    if (existing) return res.status(201).json({ success: true, message: "Invoice already exists", data: existing.toJSON() });
    const [subscription, settings] = await Promise.all([
      Subscription.findById(req.params.subscriptionId),
      getInvoiceSettingsDoc(),
    ]);
    if (!subscription) throw new AppError("Subscription not found", 404);
    const [user, plan] = await Promise.all([
      User.findById(subscription.userId),
      SubscriptionPlan.findOne({ planId: subscription.planId }),
    ]);
    const connected = requireConnectedInvoiceTemplate(settings);
    const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`;
    const invoice = await Invoice.create({
      invoiceNumber,
      userId: String(subscription.userId || ""),
      subscriptionId: String(subscription._id),
      planId: String(subscription.planId || ""),
      userName: user?.name || user?.mobile || "Learner",
      userEmail: user?.email || "",
      userMobile: user?.mobile || "",
      customerCompany: { name: user?.name || user?.mobile || "Learner", email: user?.email || "", phone: user?.mobile || "", address: user?.address || "" },
      amount: Number(subscription.finalAmount || subscription.amount || 0),
      subtotal: Number(subscription.baseAmount || subscription.amount || 0),
      discountTotal: Number(subscription.discountAmount || 0),
      taxTotal: Number(subscription.taxAmount || 0),
      convenienceCharge: Number(subscription.convenienceCharge || 0),
      convenienceChargeGst: Number(subscription.convenienceChargeGst || 0),
      grandTotal: Number(subscription.finalAmount || subscription.amount || 0),
      currency: subscription.currency || "INR",
      status: subscription.status === "active" ? "paid" : "pending",
      taxDetails: {
        type: "GST",
        taxPercent: Number(subscription.taxPercent ?? settings.defaultTaxPercent ?? 0),
        taxableAmount: Math.max(0, Number(subscription.baseAmount || subscription.amount || 0) - Number(subscription.discountAmount || 0)),
        amountBeforeCharges: Number(subscription.amountBeforeCharges || (Number(subscription.baseAmount || subscription.amount || 0) - Number(subscription.discountAmount || 0) + Number(subscription.taxAmount || 0))),
        convenienceChargePercent: Number(subscription.convenienceChargePercent ?? settings.defaultConvenienceChargePercent ?? 0),
        convenienceChargeGstPercent: Number(subscription.convenienceChargeGstPercent ?? settings.defaultConvenienceChargeGstPercent ?? 0),
      },
      templateId: connected?.id || settings.connectedTemplateId || "",
      templateName: connected?.name || settings.connectedTemplateName || "",
      transactionId: subscription.razorpayPaymentId || subscription.razorpayOrderId || "",
      invoiceDate: new Date(),
      dueDate: subscription.endDate,
      items: [{
        product: plan?.name || subscription.planId,
        description: "Premium subscription purchase",
        quantity: 1,
        price: Number(subscription.baseAmount || subscription.amount || 0),
        discount: Number(subscription.discountAmount || 0),
        tax: Number(subscription.taxPercent ?? settings.defaultTaxPercent ?? 0),
        total: Number(subscription.amountBeforeCharges || (Number(subscription.baseAmount || subscription.amount || 0) - Number(subscription.discountAmount || 0) + Number(subscription.taxAmount || 0))),
      }],
      emailStatus: "pending",
      issuedAt: new Date(),
      paymentHistory: [{
        status: subscription.status === "active" ? "paid" : "pending",
        amount: Number(subscription.finalAmount || subscription.amount || 0),
        convenienceCharge: Number(subscription.convenienceCharge || 0),
        convenienceChargeGst: Number(subscription.convenienceChargeGst || 0),
        transactionId: subscription.razorpayPaymentId || subscription.razorpayOrderId || "",
        paidAt: subscription.transactionDate || new Date(),
        note: "Subscription payment",
        razorpayOrderId: subscription.razorpayOrderId || "",
        razorpayPaymentId: subscription.razorpayPaymentId || "",
      }],
      activityLogs: [{ action: "created", message: "Invoice generated from subscription", at: new Date() }],
    });
    const pdf = await regenerateInvoicePdf(invoice, settings, { planName: plan?.name || subscription.planId }, { requireConnectedTemplate: true });
    await invoice.save();
    if (settings.enabled && settings.emailEnabled && invoice.userEmail) {
      const data = invoiceData({ ...invoice.toJSON(), planName: plan?.name || subscription.planId });
      const result = await sendTemplatedEmail(EMAIL_TEMPLATE_KEYS.INVOICE_GENERATED, invoice.userEmail, {
        user_name: invoice.userName || "Learner",
        customer_name: invoice.userName || "Learner",
        email: invoice.userEmail,
        invoice_number: invoice.invoiceNumber,
        invoice_amount: `${invoice.currency || "INR"} ${Number(invoice.grandTotal || invoice.amount || 0).toFixed(2)}`,
        payment_amount: `${invoice.currency || "INR"} ${Number(invoice.grandTotal || invoice.amount || 0).toFixed(2)}`,
        invoice_date: new Date(invoice.invoiceDate || invoice.createdAt).toLocaleDateString("en-IN"),
        due_date: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-IN") : "",
        tax_amount: `${invoice.currency || "INR"} ${Number(invoice.taxTotal || 0).toFixed(2)}`,
        convenience_fee: `${invoice.currency || "INR"} ${Number(invoice.convenienceCharge || 0).toFixed(2)}`,
        convenience_fee_gst: `${invoice.currency || "INR"} ${Number(invoice.convenienceChargeGst || 0).toFixed(2)}`,
        total_amount: `${invoice.currency || "INR"} ${Number(invoice.grandTotal || invoice.amount || 0).toFixed(2)}`,
        payment_status: data.paymentStatus,
        transaction_id: data.transactionId || "-",
        company_name: settings.companyName || "Krita",
        support_email: settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com",
      }, [{ filename: `${invoice.invoiceNumber}.pdf`, contentType: "application/pdf", content: pdf }], {
        smtp: settings.smtp || {},
        logger: req.logger || console,
      });
      invoice.emailStatus = result.skipped ? "skipped" : "sent";
      invoice.emailError = result.skipped ? result.reason : "";
      invoice.sentAt = result.skipped ? undefined : new Date();
      await invoice.save();
    }
    res.status(201).json({ success: true, message: "Invoice generated", data: invoice.toJSON() });
  }),
);

router.get(
  "/notification-settings",
  asyncHandler(async (_req, res) => {
    const settings = await getNotificationSettingsDoc();
    res.json({ success: true, data: settings.toJSON() });
  }),
);

router.post(
  "/notification-settings",
  asyncHandler(async (req, res) => {
    const settings = await getNotificationSettingsDoc();
    const body = req.body || {};
    settings.enabled = body.enabled === undefined ? settings.enabled : Boolean(body.enabled);
    settings.emailEnabled = body.emailEnabled === undefined ? settings.emailEnabled : Boolean(body.emailEnabled);
    settings.inAppEnabled = body.inAppEnabled === undefined ? settings.inAppEnabled : Boolean(body.inAppEnabled);
    if (Array.isArray(body.reminders)) {
      settings.reminders = body.reminders.map((item) => ({
        daysBefore: Math.max(0, Number(item.daysBefore || 0)),
        enabled: item.enabled !== false,
        title: String(item.title || ""),
        body: String(item.body || ""),
        emailSubject: String(item.emailSubject || ""),
        emailBody: String(item.emailBody || ""),
      }));
    }
    await settings.save();
    res.json({ success: true, message: "Notification settings saved", data: settings.toJSON() });
  }),
);

router.post(
  "/notification-settings/run-expiry-reminders",
  asyncHandler(async (_req, res) => {
    const settings = await getNotificationSettingsDoc();
    let created = 0;
    if (settings.enabled) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      for (const reminder of settings.reminders.filter((item) => item.enabled !== false)) {
        const target = new Date(dayStart);
        target.setDate(target.getDate() + Number(reminder.daysBefore || 0));
        const next = new Date(target);
        next.setDate(next.getDate() + 1);
        const subscriptions = await Subscription.find({ status: "active", endDate: { $gte: target, $lt: next } }).lean();
        for (const subscription of subscriptions) {
          const user = await User.findById(subscription.userId).lean();
          if (!user) continue;
          const data = {
            userName: user.name || user.mobile || "Learner",
            daysBefore: reminder.daysBefore,
            expiryDate: subscription.endDate ? new Date(subscription.endDate).toLocaleDateString("en-IN") : "",
          };
          const result = await UserNotification.updateOne(
            { dedupeKey: `subscription-expiry:${subscription._id}:${reminder.daysBefore}` },
            {
              userId: String(subscription.userId),
              type: "subscription",
              title: replaceTokens(reminder.title, data),
              body: replaceTokens(reminder.body, data),
              visibleInApp: settings.inAppEnabled !== false,
              dedupeKey: `subscription-expiry:${subscription._id}:${reminder.daysBefore}`,
            },
            { upsert: true },
          );
          if (result.upsertedCount) created += 1;
        }
      }
    }
    res.json({ success: true, message: "Expiry reminders processed", data: { created } });
  }),
);

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const search = String(req.query.search || "").trim();
    const type = String(req.query.type || "").trim();
    const filter = {};
    if (type && type !== "all") filter.type = type;
    if (search) {
      filter.$or = [
        { title: new RegExp(search, "i") },
        { body: new RegExp(search, "i") },
        { targetGroup: new RegExp(search, "i") },
      ];
    }

    const [items, total] = await Promise.all([
      UserNotification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      UserNotification.countDocuments(filter),
    ]);
    const userIds = [...new Set(items.map((item) => String(item.userId)).filter(Boolean))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name email mobile").lean() : [];
    const userMap = new Map(users.map((user) => [String(user._id), user]));

    res.json({
      success: true,
      data: items.map((item) => ({
        ...item.toJSON(),
        user: userMap.has(String(item.userId))
          ? {
              id: String(userMap.get(String(item.userId))._id),
              name: userMap.get(String(item.userId)).name,
              email: userMap.get(String(item.userId)).email,
              mobile: userMap.get(String(item.userId)).mobile,
            }
          : null,
      })),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.post(
  "/notifications/broadcast",
  upload.single("attachment"),
  asyncHandler(async (req, res) => {
    const payload = notificationBroadcastSchema.parse(req.body || {});
    const recipients = await getNotificationRecipients(payload.targetGroup);
    if (!recipients.length) throw new AppError("No users found for selected target group", 400);

    const settings = await InvoiceSettings.findOne({ key: "default" });
    const attachment = await saveNotificationAttachment(req.file);
    const shouldNotify = ["notification", "both", "push", "email_push"].includes(payload.deliveryMode);
    const shouldEmail = ["email", "both", "email_push"].includes(payload.deliveryMode);
    const templateKey = notificationTemplateKeyForType(payload.type, payload.templateKey);
    const extraVariables = parseNotificationVariables(payload.variables);
    console.info(`[NOTIFICATION] Email template selected | type=${payload.type} | explicit=${payload.templateKey || "auto"} | resolved=${templateKey}`);
    const broadcastId = `broadcast-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const docs = [];
    let emailSent = 0;
    let emailFailed = 0;
    let emailSkipped = 0;

    for (const user of recipients) {
      let emailStatus = shouldEmail ? "pending" : "not_requested";
      let emailError = "";
      if (shouldEmail) {
        if (!user.email) {
          emailStatus = "skipped";
          emailError = "User email missing";
          emailSkipped += 1;
        } else {
          try {
            await sendTemplatedEmail(templateKey, user.email, buildNotificationEmailVariables({
              user,
              payload,
              settings,
              extraVariables,
            }), req.file
              ? [{ filename: req.file.originalname, contentType: req.file.mimetype, content: req.file.buffer }]
              : []);

            emailStatus = "sent";
            emailSent += 1;
          } catch (error) {
            emailStatus = "failed";
            emailError = error.message;
            emailFailed += 1;
          }
        }
      }

      docs.push({
        userId: String(user._id),
        type: payload.type,
        title: payload.title,
        body: payload.body,
        dedupeKey: `${broadcastId}:${String(user._id)}`,
        visibleInApp: shouldNotify,
        linkUrl: payload.linkUrl || notificationLinkForType(payload.type),
        imageUrl: attachment.imageUrl,
        attachmentUrl: attachment.attachmentUrl,
        attachmentName: attachment.attachmentName,
        targetGroup: payload.targetGroup,
        deliveryMode: payload.deliveryMode,
        notificationStatus: shouldNotify ? "sent" : "not_requested",
        senderId: String(req.admin?._id || ""),
        senderName: req.admin?.name || req.admin?.email || "Admin",
        emailStatus,
        emailError,
        templateKey: shouldEmail ? templateKey : "",
        sentAt: new Date(),
      });
    }

    await UserNotification.insertMany(docs, { ordered: false });
    res.status(201).json({
      success: true,
      message: "Notification broadcast created",
      data: {
        totalRecipients: recipients.length,
        notificationCreated: shouldNotify ? recipients.length : 0,
        emailSent,
        emailSkipped,
        emailFailed,
      },
    });
  }),
);

router.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 200);
    const search = String(req.query.search || "").trim();
    const filters = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.origin) filters.origin = req.query.origin;
    if (req.query.userId) filters.userId = req.query.userId;
    if (search) filters.title = new RegExp(search, "i");
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      LearningSession.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LearningSession.countDocuments(filters),
    ]);
    const userIds = [...new Set(items.map((item) => String(item.userId)).filter(Boolean))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("_id name email mobile").lean() : [];
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    res.json({
      success: true,
      data: items.map((item) => ({
        id: String(item._id),
        ...item,
        user: userMap.has(String(item.userId))
          ? {
              id: String(userMap.get(String(item.userId))._id),
              name: userMap.get(String(item.userId)).name,
              email: userMap.get(String(item.userId)).email,
              mobile: userMap.get(String(item.userId)).mobile,
            }
          : null,
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);
router.post(
  "/questions/upload-asset",
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError("Image file is required", 400);
    }

    const allowedMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
    if (!allowedMimeTypes.has(String(req.file.mimetype || "").toLowerCase())) {
      throw new AppError("Only image files are allowed (jpg, png, webp, gif)", 400);
    }

    ensureDir(questionUploadsRoot);
    const baseName = sanitizeFileName(req.file.originalname || "question-image");
    const dotIndex = baseName.lastIndexOf(".");
    const name = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
    const ext = dotIndex > 0 ? baseName.slice(dotIndex) : ".png";
    const fileName = `${name}-${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`;
    const filePath = `${questionUploadsRoot}/${fileName}`;
    await fs.writeFile(filePath, req.file.buffer);

    const publicPath = buildPublicUploadPath(fileName);
    res.status(201).json({
      success: true,
      data: {
        path: publicPath,
        url: publicPath,
      },
    });
  }),
);

router.post(
  "/questions/own-asset-url",
  asyncHandler(async (req, res) => {
    const sourceUrl = String(req.body?.url || "").trim();
    if (!sourceUrl) {
      throw new AppError("Image URL is required", 400);
    }

    const ownedUrl = await ownQuestionAssetUrl(sourceUrl);
    return res.json({
      success: true,
      data: {
        sourceUrl,
        path: ownedUrl,
        url: ownedUrl,
      },
    });
  }),
);

router.post(
  "/questions/bulk-upload/validate",
  upload.fields([{ name: "sheet", maxCount: 1 }]),
  asyncHandler(async (req, res) => {
    const data = await questionBulkUploadService.validateFile({
      sheetFile: req.files?.sheet?.[0],
      uploadedBy: req.admin?._id,
    });
    res.json({ success: true, message: "Bulk upload validation completed", data });
  }),
);

router.post(
  "/questions/bulk-upload/:batchId/create-categories",
  asyncHandler(async (req, res) => {
    const data = await questionBulkUploadService.createMissingCategories({
      batchId: req.params.batchId,
    });
    res.json({ success: true, message: "Categories created successfully", data });
  }),
);

router.get(
  "/questions/bulk-upload/:batchId/status",
  asyncHandler(async (req, res) => {
    const data = await questionBulkUploadService.getStatus({
      batchId: req.params.batchId,
    });
    res.json({ success: true, message: "Bulk upload status loaded", data });
  }),
);

router.post(
  "/questions/bulk-upload/:batchId/approve",
  asyncHandler(async (req, res) => {
    const data = await questionBulkUploadService.approve({
      batchId: req.params.batchId,
      uploadAnyway: req.body?.uploadAnyway === true,
    });
    res.status(202).json({ success: true, message: req.body?.uploadAnyway === true ? "Bulk upload approved with incomplete rows" : "Bulk upload approved and processing started", data });
  }),
);

router.get(
  "/mock-tests/marking-settings",
  asyncHandler(async (_req, res) => {
    const settings = await getOrCreateExamMarkingSettings();
    res.json({ success: true, data: mapMarkingSettingsResponse(settings) });
  }),
);

router.get(
  "/support-tickets",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (search) {
      filter.$or = [
        { ticketId: new RegExp(search, "i") },
        { userName: new RegExp(search, "i") },
        { userEmail: new RegExp(search, "i") },
        { userMobile: new RegExp(search, "i") },
        { category: new RegExp(search, "i") },
      ];
    }

    const [items, total] = await Promise.all([
      SupportTicket.find(filter).sort({ isReadByAdmin: 1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
      SupportTicket.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  }),
);

router.patch(
  "/support-tickets/:id/read",
  asyncHandler(async (req, res) => {
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { isReadByAdmin: true }, { new: true });
    if (!ticket) throw new AppError("Support ticket not found", 404);
    res.json({ success: true, data: ticket });
  }),
);

router.post(
  "/support-tickets/:id/reply",
  asyncHandler(async (req, res) => {
    const payload = supportReplySchema.parse(req.body || {});
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) throw new AppError("Support ticket not found", 404);

    ticket.messages.push({ sender: "admin", message: payload.message, createdAt: new Date() });
    ticket.status = "pending";
    ticket.isReadByAdmin = true;
    await ticket.save();

    if (payload.sendNotification) {
      await UserNotification.create({
        userId: ticket.userId,
        type: "support",
        title: `Reply for ${ticket.ticketId}`,
        body: payload.message,
        dedupeKey: `support-reply-${ticket.id}-${Date.now()}`,
        visibleInApp: true,
      }).catch(() => undefined);
    }

    if (payload.sendEmail && ticket.userEmail) {
      const settings = await InvoiceSettings.findOne({ key: "default" });
      if (settings?.smtp) {
        await sendTemplatedEmail(EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_REPLY, ticket.userEmail, {
          user_name: ticket.userName || "Learner",
          email: ticket.userEmail,
          ticket_id: ticket.ticketId,
          ticket_status: ticket.status || "open",
          reply_message: payload.message,
          support_email: settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com",
        }, [], {
          smtp: settings.smtp,
          logger: req.logger || console,
        }).catch(() => undefined);
      }
    }

    res.json({ success: true, message: "Support reply sent", data: ticket });
  }),
);

router.post(
  "/mock-tests/marking-settings",
  asyncHandler(async (req, res) => {
    const payload = examMarkingSettingsSchema.parse(req.body || {});
    const existing = await getOrCreateExamMarkingSettings();
    const defaults = createDefaultMarkingSettingsPayload();
    const normalizedExisting = normalizeMarkingSettingsDocument(existing);

    const nextValues = {
      predictionMinimumMockTests: Math.max(
        1,
        Math.min(50, Number(payload.predictionMinimumMockTests ?? normalizedExisting.predictionMinimumMockTests ?? defaults.predictionMinimumMockTests)),
      ),
      neet: normalizeMarkingScheme(payload.neet ?? normalizedExisting.neet, defaults.neet),
      jeeMain: normalizeMarkingScheme(payload.jeeMain ?? normalizedExisting.jeeMain, defaults.jeeMain),
      jeeAdvanced: normalizeMarkingScheme(payload.jeeAdvanced ?? normalizedExisting.jeeAdvanced, defaults.jeeAdvanced),
    };
    assertValidMarkingScheme(nextValues.neet, "NEET scheme");
    assertValidMarkingScheme(nextValues.jeeMain, "JEE Main scheme");
    assertValidMarkingScheme(nextValues.jeeAdvanced, "JEE Advanced scheme");

    const settings = await ExamMarkingSettings.findOneAndUpdate({}, nextValues, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    });
    res.json({ success: true, message: "Marking settings updated", data: mapMarkingSettingsResponse(settings) });
  }),
);

router.get(
  "/mock-tests",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
    const search = String(req.query.search || "").trim();
    const filters = {};

    if (req.query.examType) filters.examType = normalizeExamType(req.query.examType);
    if (req.query.isActive === "true" || req.query.isActive === "false") filters.isActive = req.query.isActive === "true";
    if (req.query.isPremiumOnly === "true" || req.query.isPremiumOnly === "false") filters.isPremiumOnly = req.query.isPremiumOnly === "true";
    if (req.query.createdDate) {
      const start = new Date(`${String(req.query.createdDate).slice(0, 10)}T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      if (!Number.isNaN(start.getTime())) filters.createdAt = { $gte: start, $lt: end };
    }
    if (search) {
      filters.$or = [
        { title: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { description: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      ];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      MockTest.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
      MockTest.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: await serializeMockTests(items),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.get(
  "/mock-tests/questions",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 10);
    const search = String(req.query.search || "").trim();
    const filters = {};

    if (req.query.examType && String(req.query.examType).toUpperCase() !== "BOTH") {
      filters.examMode = normalizeExamType(req.query.examType);
    }
    if (req.query.subjectId) filters.subjectId = String(req.query.subjectId);
    if (req.query.chapterId) filters.chapterId = String(req.query.chapterId);
    if (search) {
      filters.question = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Question.find(filters)
        .populate("subjectId")
        .populate("chapterId")
        .populate("questionTypeId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Question.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: items.map((item) => ({
        id: String(item._id),
        question: item.question || "[Image Question]",
        questionImageUrl: item.questionImageUrl || "",
        hasDiagram: Boolean(item.hasDiagram || item.questionImageUrl),
        examMode: item.examMode,
        difficulty: item.difficulty,
        subjectName: item.subjectId?.name || "-",
        chapterName: item.chapterId?.name || "-",
        questionTypeLabel: item.questionTypeId?.name || item.questionTypeId?.label || "-",
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.post(
  "/mock-tests/auto-generate",
  asyncHandler(async (req, res) => {
    const payload = await buildAutoMockTestPayload({ ...(req.body || {}), isPremiumOnly: false }, req.userId);
    const shortageCount = Array.isArray(payload?.generationConfig?.shortages) ? payload.generationConfig.shortages.length : 0;
    const preview = (await serializeMockTests([{ ...payload, _id: "" }]))[0];
    res.json({
      success: true,
      message: shortageCount > 0 ? `Mock test generated with ${shortageCount} section shortage(s). Review and save to publish.` : "Mock test generated. Review and save to publish.",
      data: {
        ...preview,
        previewOnly: true,
      },
    });
  }),
);

router.post(
  "/mock-tests/:id/regenerate",
  asyncHandler(async (req, res) => {
    const existing = await MockTest.findById(req.params.id);
    if (!existing) throw new AppError("Mock test not found", 404);
    const payload = await buildAutoMockTestPayload(req.body || {}, req.userId, existing);
    Object.assign(existing, payload);
    await existing.save();
    const shortageCount = Array.isArray(payload?.generationConfig?.shortages) ? payload.generationConfig.shortages.length : 0;
    res.json({
      success: true,
      message: shortageCount > 0 ? `Mock test regenerated with ${shortageCount} section shortage(s)` : "Mock test regenerated",
      data: (await serializeMockTests([existing]))[0],
    });
  }),
);

router.get(
  "/mock-tests/:id/generation-history",
  asyncHandler(async (req, res) => {
    const existing = await MockTest.findById(req.params.id).select("_id title generationHistory generationConfig generationSource");
    if (!existing) throw new AppError("Mock test not found", 404);
    res.json({
      success: true,
      data: {
        id: String(existing._id),
        title: existing.title,
        generationSource: existing.generationSource || "manual",
        generationConfig: existing.generationConfig || null,
        history: Array.isArray(existing.generationHistory) ? existing.generationHistory : [],
      },
    });
  }),
);

router.get(
  "/mock-tests/:id",
  asyncHandler(async (req, res) => {
    const item = await MockTest.findById(req.params.id);
    if (!item) throw new AppError("Mock test not found", 404);
    res.json({ success: true, data: (await serializeMockTests([item]))[0] });
  }),
);

router.post(
  "/mock-tests",
  asyncHandler(async (req, res) => {
    const payload = await buildMockTestPayload(req.body);
    const item = await MockTest.create(payload);
    res.status(201).json({ success: true, message: "Mock test created", data: (await serializeMockTests([item]))[0] });
  }),
);

router.put(
  "/mock-tests/:id",
  asyncHandler(async (req, res) => {
    const existing = await MockTest.findById(req.params.id);
    if (!existing) throw new AppError("Mock test not found", 404);
    const payload = await buildMockTestPayload(req.body, existing);
    Object.assign(existing, payload);
    await existing.save();
    res.json({ success: true, message: "Mock test updated", data: (await serializeMockTests([existing]))[0] });
  }),
);

router.delete(
  "/mock-tests/:id",
  asyncHandler(async (req, res) => {
    const existing = await MockTest.findById(req.params.id);
    if (!existing) throw new AppError("Mock test not found", 404);
    await existing.deleteOne();
    res.json({ success: true, message: "Mock test deleted", data: null });
  }),
);

router.get(
  "/daily-plan-configs",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
    const search = String(req.query.search || "").trim();
    const filters = {};

    if (req.query.modeKey) filters.modeKey = normalizeModeKey(req.query.modeKey);
    if (req.query.isActive === "true" || req.query.isActive === "false") filters.isActive = req.query.isActive === "true";
    if (search) {
      filters.$or = [
        { modeKey: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { title: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { description: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      ];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      DailyPlanConfig.find(filters).sort({ modeKey: 1, createdAt: -1 }).skip(skip).limit(limit),
      DailyPlanConfig.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: await serializeDailyPlans(items),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.get(
  "/daily-plan-configs/questions",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 10);
    const search = String(req.query.search || "").trim();
    const filters = {
      isVisibleToUsers: { $ne: false },
      questionStatus: { $ne: "incomplete" },
      reviewStatus: { $ne: "needs_review" },
    };

    if (req.query.modeKey && String(req.query.modeKey).toUpperCase() !== "BOTH") {
      const modeKey = normalizeModeKey(req.query.modeKey);
      filters.$or = [{ examMode: modeKey }, { examMode: "BOTH" }];
    }
    if (req.query.subjectId) filters.subjectId = String(req.query.subjectId);
    if (req.query.chapterId) filters.chapterId = String(req.query.chapterId);
    if (search) {
      filters.question = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Question.find(filters)
        .populate("subjectId")
        .populate("chapterId")
        .populate("questionTypeId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Question.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: items.map((item) => ({
        id: String(item._id),
        question: item.question,
        examMode: item.examMode,
        difficulty: item.difficulty,
        subjectName: item.subjectId?.name || "-",
        chapterName: item.chapterId?.name || "-",
        questionTypeLabel: item.questionTypeId?.name || item.questionTypeId?.label || "-",
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.get(
  "/daily-plan-configs/:id",
  asyncHandler(async (req, res) => {
    const item = await DailyPlanConfig.findById(req.params.id);
    if (!item) throw new AppError("Daily plan config not found", 404);
    res.json({ success: true, data: (await serializeDailyPlans([item]))[0] });
  }),
);

router.post(
  "/daily-plan-configs",
  validate(createSchemas.dailyPlan),
  asyncHandler(async (req, res) => {
    const payload = await buildDailyPlanPayload(req.validated.body);
    const existingByMode = await DailyPlanConfig.findOne({ modeKey: payload.modeKey });
    if (existingByMode) {
      Object.assign(existingByMode, payload);
      await existingByMode.save();
      res.status(200).json({ success: true, message: "Daily plan config updated", data: (await serializeDailyPlans([existingByMode]))[0] });
      return;
    }
    const item = await DailyPlanConfig.create(payload);
    res.status(201).json({ success: true, message: "Daily plan config created", data: (await serializeDailyPlans([item]))[0] });
  }),
);

router.put(
  "/daily-plan-configs/:id",
  validate(updateSchemas.dailyPlan),
  asyncHandler(async (req, res) => {
    const existing = await DailyPlanConfig.findById(req.params.id);
    if (!existing) throw new AppError("Daily plan config not found", 404);
    const payload = await buildDailyPlanPayload(req.validated.body, existing);
    const duplicate = await DailyPlanConfig.findOne({ modeKey: payload.modeKey, _id: { $ne: existing._id } }).select("_id");
    if (duplicate) {
      throw new AppError(`Daily plan for ${payload.modeKey} already exists.`, 400);
    }
    Object.assign(existing, payload);
    await existing.save();
    res.json({ success: true, message: "Daily plan config updated", data: (await serializeDailyPlans([existing]))[0] });
  }),
);

router.delete(
  "/daily-plan-configs/:id",
  asyncHandler(async (req, res) => {
    const existing = await DailyPlanConfig.findById(req.params.id);
    if (!existing) throw new AppError("Daily plan config not found", 404);
    await existing.deleteOne();
    res.json({ success: true, message: "Daily plan config deleted", data: null });
  }),
);

function createCrudRouter({ key, label, service }) {
  const route = Router();
  const controller = createCrudController(service, label);

  route.get("/", validate(listQuerySchema), asyncHandler(controller.list));
  route.post("/reorder", asyncHandler(async (req, res) => {
    if (!service.reorder) throw new AppError(`${label} sorting is not supported`, 400);
    const result = await service.reorder(Array.isArray(req.body?.items) ? req.body.items : []);
    sendResponse(res, { message: `${label} order updated`, data: result });
  }));
  route.post("/bulk-delete", validate(bulkDeleteSchema), asyncHandler(controller.bulkRemove));
  route.delete("/bulk", validate(bulkDeleteSchema), asyncHandler(controller.bulkRemove));
  route.get("/:id", asyncHandler(controller.getById));
  route.post("/", validate(createSchemas[key]), asyncHandler(controller.create));
  route.put("/:id", validate(updateSchemas[key]), asyncHandler(controller.update));
  route.delete("/:id", asyncHandler(controller.remove));

  return route;
}

function normalizeExamType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized === "NEET") return "NEET";
  if (normalized === "JEE" || normalized === "JEE_MAIN" || normalized === "JEE_ADVANCED") return "JEE";
  if (normalized) return normalized;
  throw new AppError("Invalid exam type.", 400);
}

function normalizeDifficultyKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "medium") return "moderate";
  return normalized;
}

async function resolveDifficultyPayload(input = {}) {
  const requestedId = String(input.difficultyId || "").trim();
  const requestedKey = normalizeDifficultyKey(input.difficulty);

  if (requestedId && mongoose.isValidObjectId(requestedId)) {
    const difficulty = await Difficulty.findById(requestedId);
    if (!difficulty) throw new AppError("Selected difficulty was not found", 400);
    return {
      difficultyId: String(difficulty._id),
      difficulty: normalizeDifficultyKey(difficulty.key || difficulty.name),
    };
  }

  if (requestedKey) {
    const difficulty = await Difficulty.findOne({
      $or: [
        { key: requestedKey },
        { name: new RegExp(`^${requestedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      ],
    });

    if (difficulty) {
      return {
        difficultyId: String(difficulty._id),
        difficulty: normalizeDifficultyKey(difficulty.key || difficulty.name),
      };
    }

    return {
      difficultyId: undefined,
      difficulty: requestedKey,
    };
  }

  throw new AppError("Difficulty is required", 400);
}

async function ensureExamTypeExists(value) {
  const name = normalizeExamType(value);
  const exists = await ExamType.exists({ $or: [{ name }, { key: name }, { label: name }] });
  if (!exists) {
    throw new AppError(`Exam type ${name} is not configured`, 400);
  }
  return name;
}

function buildQuestionDuplicateQuery(payload = {}) {
  return {
    question: String(payload.question || "").trim(),
    subjectId: payload.subjectId,
    chapterId: payload.chapterId,
    topicId: payload.topicId,
    exam: payload.exam,
  };
}

async function assertUniqueQuestion(payload = {}, existingId = null) {
  const query = buildQuestionDuplicateQuery(payload);
  if (!query.question || !query.subjectId || !query.chapterId || !query.topicId || !query.exam) return;
  if (existingId) query._id = { $ne: existingId };
  const exists = await Question.exists(query);
  if (exists) throw new AppError("Question already exists", 400);
}

const modeService = createCrudService({
  model: Mode,
  allowedSorts: ["createdAt", "updatedAt", "sortOrder", "label", "key"],
  searchFields: ["key", "label", "description"],
});

const learningLevelService = createCrudService({
  model: LearningLevel,
  allowedSorts: ["createdAt", "updatedAt", "sortOrder", "label", "key"],
  searchFields: ["key", "label", "description"],
  exactFilters: ["active"],
  beforeCreate: async (payload) => ({
    ...payload,
    key: String(payload.key || "").trim(),
    label: String(payload.label || "").trim(),
    description: payload.description || undefined,
  }),
  beforeUpdate: async (_existing, payload) => ({
    ...payload,
    ...(payload.key !== undefined ? { key: String(payload.key || "").trim() } : {}),
    ...(payload.label !== undefined ? { label: String(payload.label || "").trim() } : {}),
    ...(payload.description !== undefined ? { description: payload.description || undefined } : {}),
  }),
});

const examTypeService = createCrudService({
  model: ExamType,
  allowedSorts: ["createdAt", "updatedAt", "sortOrder", "name", "key", "label"],
  searchFields: ["name", "key", "label", "description"],
  beforeCreate: async (payload) => ({
    name: normalizeExamType(payload.name),
    description: payload.description || undefined,
    sortOrder: Number(payload.sortOrder || 0),
  }),
  beforeUpdate: async (_existing, payload) => ({
    ...(payload.name !== undefined ? { name: normalizeExamType(payload.name) } : {}),
    ...(payload.description !== undefined ? { description: payload.description || undefined } : {}),
    ...(payload.sortOrder !== undefined ? { sortOrder: Number(payload.sortOrder || 0) } : {}),
  }),
  beforeDelete: async (examType) => {
    const examTypeName = String(examType.name || examType.key || examType.label || "").trim().toUpperCase();
    const questionTypeFilters =
      examTypeName === "JEE"
        ? {
            $or: [
              { examType: "JEE" },
              { examCategory: "JEE" },
              { examCategory: "JEE_MAIN" },
              { examCategory: "JEE_ADVANCED" },
            ],
          }
        : {
            $or: [
              { examType: examTypeName },
              { examCategory: examTypeName },
            ],
          };
    const [subjectCount, yearCount, questionTypeCount] = await Promise.all([
      Subject.countDocuments({ examType: examTypeName }),
      Year.countDocuments({ examType: examTypeName }),
      QuestionType.countDocuments(questionTypeFilters),
    ]);
    if (subjectCount > 0 || yearCount > 0 || questionTypeCount > 0) {
      throw new AppError("Remove or reassign related subjects, years, and question types before deleting this exam type", 400);
    }
  },
});

const difficultyService = createCrudService({
  model: Difficulty,
  allowedSorts: ["createdAt", "updatedAt", "sortOrder", "name", "key"],
  searchFields: ["name", "key", "description"],
  beforeCreate: async (payload) => ({
    ...payload,
    key: String(payload.key ?? "").trim().toLowerCase(),
    name: String(payload.name ?? "").trim(),
  }),
  beforeUpdate: async (_existing, payload) => ({
    ...payload,
    ...(payload.key !== undefined ? { key: String(payload.key).trim().toLowerCase() } : {}),
    ...(payload.name !== undefined ? { name: String(payload.name).trim() } : {}),
  }),
});

const subjectService = createCrudService({
  model: Subject,
  allowedSorts: ["createdAt", "updatedAt", "name", "examType"],
  searchFields: ["name", "icon", "color"],
  exactFilters: ["examType"],
  beforeDelete: async (subject) => {
    const [chapterCount, topicCount, questionCount] = await Promise.all([
      Chapter.countDocuments({ subjectId: subject._id }),
      Topic.countDocuments({ subjectId: subject._id }),
      Question.countDocuments({ subjectId: subject._id }),
    ]);
    if (chapterCount > 0 || topicCount > 0 || questionCount > 0) {
      throw new AppError("Delete related chapters, topics, and questions before removing this subject", 400);
    }
  },
});

const chapterService = createCrudService({
  model: Chapter,
  populate: ["subjectId"],
  allowedSorts: ["createdAt", "updatedAt", "name"],
  searchFields: ["name"],
  exactFilters: ["_id", "subjectId"],
  beforeDelete: async (chapter) => {
    const [topicCount, questionCount] = await Promise.all([
      Topic.countDocuments({ chapterId: chapter._id }),
      Question.countDocuments({ chapterId: chapter._id }),
    ]);
    if (topicCount > 0 || questionCount > 0) {
      throw new AppError("Delete related topics and questions before removing this chapter", 400);
    }
  },
});

const topicService = createCrudService({
  model: Topic,
  populate: ["subjectId", "chapterId"],
  allowedSorts: ["createdAt", "updatedAt", "name"],
  searchFields: ["name"],
  exactFilters: ["_id", "subjectId", "chapterId"],
  beforeCreate: async (payload) => {
    const [subject, chapter] = await Promise.all([
      Subject.findById(payload.subjectId),
      Chapter.findById(payload.chapterId),
    ]);
    if (!subject) throw new AppError("Selected subject was not found", 400);
    if (!chapter) throw new AppError("Selected chapter was not found", 400);
    if (String(chapter.subjectId) !== String(subject._id)) {
      throw new AppError("Chapter does not belong to the selected subject", 400);
    }
    return {
      subjectId: String(subject._id),
      chapterId: String(chapter._id),
      name: String(payload.name || "").trim(),
    };
  },
  beforeUpdate: async (existing, payload) => {
    const nextSubjectId = payload.subjectId || String(existing.subjectId);
    const nextChapterId = payload.chapterId || String(existing.chapterId);
    const [subject, chapter] = await Promise.all([
      Subject.findById(nextSubjectId),
      Chapter.findById(nextChapterId),
    ]);
    if (!subject) throw new AppError("Selected subject was not found", 400);
    if (!chapter) throw new AppError("Selected chapter was not found", 400);
    if (String(chapter.subjectId) !== String(subject._id)) {
      throw new AppError("Chapter does not belong to the selected subject", 400);
    }
    return {
      ...(payload.subjectId !== undefined ? { subjectId: String(subject._id) } : {}),
      ...(payload.chapterId !== undefined ? { chapterId: String(chapter._id) } : {}),
      ...(payload.name !== undefined ? { name: String(payload.name || "").trim() } : {}),
    };
  },
  beforeDelete: async (topic) => {
    const questionCount = await Question.countDocuments({ topicId: topic._id });
    if (questionCount > 0) throw new AppError("Delete related questions before removing this topic", 400);
  },
});

const yearService = createCrudService({
  model: Year,
  allowedSorts: ["createdAt", "updatedAt", "name"],
  searchFields: ["name"],
  exactFilters: ["examType"],
  beforeCreate: async (payload) => ({
    ...payload,
    examType: await ensureExamTypeExists(payload.examType),
  }),
  beforeUpdate: async (_existing, payload) => {
    if (!payload.examType) return payload;
    return {
      ...payload,
      examType: await ensureExamTypeExists(payload.examType),
    };
  },
  beforeDelete: async (year) => {
    const questionCount = await Question.countDocuments({ yearId: year._id });
    if (questionCount > 0) throw new AppError("Delete related questions before removing this year", 400);
  },
});

const questionTypeService = createCrudService({
  model: QuestionType,
  allowedSorts: ["createdAt", "updatedAt", "name", "examType", "label", "key"],
  searchFields: ["name", "key", "label", "description"],
  exactFilters: ["examType", "examCategory", "responseType", "displayVariant"],
  beforeCreate: async (payload) => {
    const examType = await ensureExamTypeExists(payload.examType || payload.examCategory);
    return {
      name: String(payload.name ?? payload.label ?? payload.key ?? "").trim(),
      examType,
      key: String(payload.key ?? "").trim() || undefined,
      label: String(payload.label ?? "").trim() || undefined,
      examCategory: examType,
      responseType: payload.responseType || "single",
      displayVariant: String(payload.displayVariant ?? "").trim() || "single_choice",
      exampleQuestion: String(payload.exampleQuestion ?? "").trim() || undefined,
      exampleOptions: String(payload.exampleOptions ?? "").trim() || undefined,
      exampleAnswer: String(payload.exampleAnswer ?? "").trim() || undefined,
      exampleExplanation: String(payload.exampleExplanation ?? "").trim() || undefined,
      description: String(payload.description ?? "").trim() || undefined,
    };
  },
  beforeUpdate: async (existing, payload) => {
    const examType = payload.examType || payload.examCategory || existing.examType || existing.examCategory;
    const resolvedExamType = await ensureExamTypeExists(examType);
    return {
      ...(payload.name !== undefined ? { name: String(payload.name ?? payload.label ?? payload.key ?? "").trim() } : {}),
      examType: resolvedExamType,
      ...(payload.key !== undefined ? { key: String(payload.key).trim() || undefined } : {}),
      ...(payload.label !== undefined ? { label: String(payload.label).trim() || undefined } : {}),
      examCategory: resolvedExamType,
      ...(payload.responseType !== undefined ? { responseType: payload.responseType || "single" } : {}),
      ...(payload.displayVariant !== undefined ? { displayVariant: String(payload.displayVariant ?? "").trim() || "single_choice" } : {}),
      ...(payload.exampleQuestion !== undefined ? { exampleQuestion: String(payload.exampleQuestion ?? "").trim() || undefined } : {}),
      ...(payload.exampleOptions !== undefined ? { exampleOptions: String(payload.exampleOptions ?? "").trim() || undefined } : {}),
      ...(payload.exampleAnswer !== undefined ? { exampleAnswer: String(payload.exampleAnswer ?? "").trim() || undefined } : {}),
      ...(payload.exampleExplanation !== undefined ? { exampleExplanation: String(payload.exampleExplanation ?? "").trim() || undefined } : {}),
      ...(payload.description !== undefined ? { description: String(payload.description ?? "").trim() || undefined } : {}),
    };
  },
  beforeDelete: async (questionType) => {
    const questionCount = await Question.countDocuments({ questionTypeId: questionType._id });
    if (questionCount > 0) throw new AppError("Delete related questions before removing this question type", 400);
  },
});

const questionService = createCrudService({
  model: Question,
  populate: ["subjectId", "chapterId", "topicId", "yearId", "difficultyId", "questionTypeId"],
  allowedSorts: ["createdAt", "updatedAt", "difficulty", "examMode", "exam"],
  searchFields: ["question", "passage", "conceptTags"],
  exactFilters: ["subjectId", "chapterId", "topicId", "yearId", "difficultyId", "questionTypeId", "examMode", "difficulty", "responseType", "questionStatus", "reviewStatus", "isVisibleToUsers"],
  beforeCreate: async (payload) => {
    const normalizedPayload = normalizeQuestionExamFields(payload);
    Object.assign(normalizedPayload, await resolveDifficultyPayload(normalizedPayload));
    if (normalizedPayload.yearId) {
      const year = await Year.findById(normalizedPayload.yearId);
      if (!year) throw new AppError("Selected year was not found", 400);
      normalizedPayload.yearId = String(year._id);
    } else {
      normalizedPayload.yearId = undefined;
    }
    const [subject, chapter, topic] = await Promise.all([
      Subject.findById(normalizedPayload.subjectId),
      normalizedPayload.chapterId ? Chapter.findById(normalizedPayload.chapterId) : Promise.resolve(null),
      normalizedPayload.topicId ? Topic.findById(normalizedPayload.topicId) : Promise.resolve(null),
    ]);
    if (!subject) throw new AppError("Selected subject was not found", 400);
    if (normalizedPayload.chapterId && !chapter) throw new AppError("Selected chapter was not found", 400);
    if (!normalizedPayload.topicId || !topic) throw new AppError("Selected topic was not found", 400);
    if (chapter && String(chapter.subjectId) !== String(subject._id)) {
      throw new AppError("Chapter does not belong to the selected subject", 400);
    }
    if (String(topic.subjectId) !== String(subject._id) || String(topic.chapterId) !== String(chapter?._id)) {
      throw new AppError("Topic does not belong to the selected chapter and subject", 400);
    }
    const examType = normalizedPayload.examType || deriveExamType(normalizedPayload.examMode, normalizedPayload.exam);
    if (subject.examType !== examType) {
      throw new AppError("Question exam selection must match the selected subject exam type", 400);
    }
    if (!isQuestionModeCompatible(normalizedPayload.examMode, normalizedPayload.exam)) {
      throw new AppError("Question exam mode must match the selected exam", 400);
    }
    if (normalizedPayload.questionStatus !== "incomplete") {
      await assertUniqueQuestion(normalizedPayload);
    }
    return normalizedPayload;
  },
  beforeUpdate: async (existing, payload) => {
    const chapterIdWasProvided = Object.prototype.hasOwnProperty.call(payload, "chapterId");
    const topicIdWasProvided = Object.prototype.hasOwnProperty.call(payload, "topicId");
    const normalizedPayload = normalizeQuestionExamFields({
      examType: payload.examType || deriveExamType(existing.examMode, existing.exam),
      examMode: payload.examMode || existing.examMode,
      exam: payload.exam || existing.exam,
      ...payload,
    });
    if (Object.prototype.hasOwnProperty.call(payload, "difficultyId") || Object.prototype.hasOwnProperty.call(payload, "difficulty")) {
      Object.assign(normalizedPayload, await resolveDifficultyPayload({
        difficultyId: payload.difficultyId,
        difficulty: payload.difficulty,
      }));
    }
    if (normalizedPayload.yearId) {
      const year = await Year.findById(normalizedPayload.yearId);
      if (!year) throw new AppError("Selected year was not found", 400);
      normalizedPayload.yearId = String(year._id);
    } else if (Object.prototype.hasOwnProperty.call(payload, "yearId")) {
      normalizedPayload.yearId = undefined;
    }
    const nextSubjectId = normalizedPayload.subjectId || String(existing.subjectId);
    const nextChapterId = chapterIdWasProvided ? normalizedPayload.chapterId || undefined : String(existing.chapterId || "");
    const nextTopicId = topicIdWasProvided ? normalizedPayload.topicId || undefined : String(existing.topicId || "");
    const nextExamMode = normalizedPayload.examMode || existing.examMode;
    const nextExam = normalizedPayload.exam || existing.exam;
    const [subject, chapter, topic] = await Promise.all([
      Subject.findById(nextSubjectId),
      nextChapterId ? Chapter.findById(nextChapterId) : Promise.resolve(null),
      nextTopicId ? Topic.findById(nextTopicId) : Promise.resolve(null),
    ]);
    if (!subject) throw new AppError("Selected subject was not found", 400);
    if (nextChapterId && !chapter) throw new AppError("Selected chapter was not found", 400);
    if (!nextTopicId || !topic) throw new AppError("Selected topic was not found", 400);
    if (chapter && String(chapter.subjectId) !== String(subject._id)) {
      throw new AppError("Chapter does not belong to the selected subject", 400);
    }
    if (String(topic.subjectId) !== String(subject._id) || String(topic.chapterId) !== String(chapter?._id)) {
      throw new AppError("Topic does not belong to the selected chapter and subject", 400);
    }
    const examType = deriveExamType(nextExamMode, nextExam);
    if (subject.examType !== examType) {
      throw new AppError("Question exam selection must match the selected subject exam type", 400);
    }
    if (!isQuestionModeCompatible(nextExamMode, nextExam)) {
      throw new AppError("Question exam mode must match the selected exam", 400);
    }
    if (chapterIdWasProvided && !normalizedPayload.chapterId) {
      normalizedPayload.chapterId = undefined;
    }
    if (topicIdWasProvided && !normalizedPayload.topicId) {
      normalizedPayload.topicId = undefined;
    }
    const nextQuestionStatus = normalizedPayload.questionStatus || existing.questionStatus;
    if (nextQuestionStatus !== "incomplete") {
      await assertUniqueQuestion({
        question: normalizedPayload.question ?? existing.question,
        subjectId: nextSubjectId,
        chapterId: nextChapterId,
        topicId: nextTopicId,
        exam: nextExam,
      }, existing._id);
    }
    return normalizedPayload;
  },
});

const userService = createCrudService({
  model: User,
  allowedSorts: ["createdAt", "updatedAt", "lastLoginAt", "name", "mobile", "email"],
  searchFields: ["name", "mobile", "email"],
  exactFilters: ["examMode", "isPremium", "isAdmin", "onboardingComplete", "isActive", "isBlocked"],
  beforeCreate: async (payload) => {
    const next = {
      ...payload,
      passwordHash: payload.password ? hashPassword(payload.password) : undefined,
      authTypes: payload.password ? ["email"] : payload.authTypes,
      premiumExpiresAt: payload.premiumExpiresAt || undefined,
    };
    if (!String(next.mobile || "").trim()) delete next.mobile;
    if (!String(next.email || "").trim()) delete next.email;
    return next;
  },
  beforeUpdate: async (_existing, payload) => {
    const next = {
      ...Object.fromEntries(
        Object.entries(payload).filter(([key]) => !["password", "isPremium", "premiumExpiresAt"].includes(key)),
      ),
      ...(payload.password
        ? {
            passwordHash: hashPassword(payload.password),
            authTypes: [...new Set([...(Array.isArray(_existing.authTypes) ? _existing.authTypes : []), "email"])],
          }
        : {}),
    };
    if (payload.mobile !== undefined && !String(payload.mobile || "").trim()) next.mobile = undefined;
    if (payload.email !== undefined && !String(payload.email || "").trim()) next.email = undefined;
    return next;
  },
  beforeDelete: async (user) => {
    if (user.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount <= 1) {
        throw new AppError("Cannot delete the last admin", 400);
      }
    }
  },
});

const couponService = createCrudService({
  model: Coupon,
  allowedSorts: ["createdAt", "updatedAt", "code", "value", "usedCount"],
  searchFields: ["code", "type", "description"],
  exactFilters: ["active", "type"],
  beforeCreate: async (payload) => {
    if (payload.type === "percent" && Number(payload.value) > 100) {
      throw new AppError("Percentage coupon value cannot exceed 100", 400);
    }
    return {
      ...payload,
      code: String(payload.code || "").trim().toUpperCase(),
      description: payload.description || undefined,
      validFrom: payload.validFrom || undefined,
      validUntil: payload.validUntil || undefined,
      usageLimit: payload.usageLimit || undefined,
      usedCount: payload.usedCount === "" || payload.usedCount === undefined ? 0 : payload.usedCount,
    };
  },
  beforeUpdate: async (existing, payload) => {
    const nextType = payload.type ?? existing.type;
    const nextValue = payload.value ?? existing.value;
    if (nextType === "percent" && Number(nextValue) > 100) {
      throw new AppError("Percentage coupon value cannot exceed 100", 400);
    }
    return {
      ...payload,
      ...(payload.code !== undefined ? { code: String(payload.code || "").trim().toUpperCase() } : {}),
      ...(payload.description !== undefined ? { description: payload.description || undefined } : {}),
      ...(payload.validFrom !== undefined ? { validFrom: payload.validFrom || undefined } : {}),
      ...(payload.validUntil !== undefined ? { validUntil: payload.validUntil || undefined } : {}),
      ...(payload.usageLimit !== undefined ? { usageLimit: payload.usageLimit || undefined } : {}),
      ...(payload.usedCount !== undefined ? { usedCount: payload.usedCount === "" ? 0 : payload.usedCount } : {}),
    };
  },
});

const subscriptionPlanService = createCrudService({
  model: SubscriptionPlan,
  allowedSorts: ["createdAt", "updatedAt", "name", "price", "durationMonths", "sortOrder"],
  searchFields: ["planId", "name", "savings", "features"],
  exactFilters: ["active"],
  beforeCreate: async (payload) => {
    if (payload.active !== false) {
      await SubscriptionPlan.updateMany({ active: true }, { $set: { active: false } });
    }
    return {
      ...payload,
      planId: String(payload.planId || "").trim(),
      name: String(payload.name || "").trim(),
      savings: payload.savings || undefined,
      features: Array.isArray(payload.features) ? payload.features.map((item) => String(item).trim()).filter(Boolean) : [],
    };
  },
  beforeUpdate: async (_existing, payload) => {
    if (payload.active === true) {
      await SubscriptionPlan.updateMany({ _id: { $ne: _existing._id }, active: true }, { $set: { active: false } });
    }
    return {
      ...payload,
      planId: _existing.planId,
      ...(payload.name !== undefined ? { name: String(payload.name || "").trim() } : {}),
      ...(payload.savings !== undefined ? { savings: payload.savings || undefined } : {}),
      ...(payload.features !== undefined
        ? { features: Array.isArray(payload.features) ? payload.features.map((item) => String(item).trim()).filter(Boolean) : [] }
        : {}),
    };
  },
  
});

router.use("/modes", createCrudRouter({ key: "mode", label: "Mode", service: modeService }));
router.use("/learning-levels", createCrudRouter({ key: "learningLevel", label: "Learning Level", service: learningLevelService }));
router.use("/difficulties", createCrudRouter({ key: "difficulty", label: "Difficulty", service: difficultyService }));
router.use("/exam-types", createCrudRouter({ key: "examType", label: "Exam Type", service: examTypeService }));
router.use("/subjects", createCrudRouter({ key: "subject", label: "Subject", service: subjectService }));
router.post("/chapters/free-access/bulk", asyncHandler(async (req, res) => {
  const payload = chapterBulkFreeAccessSchema.parse(req.body || {});
  const uniqueChapterIds = [...new Set((payload.chapterIds || []).map((item) => String(item).trim()).filter(Boolean))];
  const shouldLock = Boolean(payload.isLockedForFreeUsers);

  if (!payload.subjectId && uniqueChapterIds.length === 0) {
    throw new AppError("Provide chapterIds or a subjectId for bulk chapter access update", 400);
  }

  let updateFilter = {};
  if (payload.subjectId) {
    updateFilter = { subjectId: payload.subjectId };
  } else {
    updateFilter = { _id: { $in: uniqueChapterIds } };
  }

  const updateResult = await Chapter.updateMany(updateFilter, { $set: { isLockedForFreeUsers: shouldLock } });
  const updatedRows = await Chapter.find(updateFilter).select("_id name subjectId isLockedForFreeUsers").lean();

  res.json({
    success: true,
    message: shouldLock ? "Selected chapters locked for free users" : "Selected chapters unlocked for free users",
    data: {
      matchedCount: Number(updateResult.matchedCount || 0),
      modifiedCount: Number(updateResult.modifiedCount || 0),
      chapters: updatedRows.map((item) => ({
        id: String(item._id),
        name: item.name,
        subjectId: String(item.subjectId),
        isLockedForFreeUsers: Boolean(item.isLockedForFreeUsers),
      })),
    },
  });
}));
router.use("/chapters", createCrudRouter({ key: "chapter", label: "Chapter", service: chapterService }));
router.use("/topics", createCrudRouter({ key: "topic", label: "Topic", service: topicService }));
router.use("/years", createCrudRouter({ key: "year", label: "Year", service: yearService }));
router.use("/question-types", createCrudRouter({ key: "questionType", label: "Question Type", service: questionTypeService }));
router.use("/questions", createCrudRouter({ key: "question", label: "Question", service: questionService }));

// Email Templates (System)
const emailTemplateService = createCrudService({
  model: EmailTemplate,
  allowedSorts: ["createdAt", "updatedAt", "name", "key", "type"],
  searchFields: ["name", "key", "type", "subject"],
  exactFilters: ["isActive", "type", "key", "module"],
  beforeCreate: async (payload) => ({
    ...payload,
    key: String(payload.key || "").trim(),
    name: String(payload.name || "").trim(),
    type: payload.type,
    module: String(payload.module || payload.type || "").trim(),
    subject: String(payload.subject || "").trim(),
    htmlContent: String(payload.htmlContent || ""),
    textContent: String(payload.textContent || ""),
    variables: Array.isArray(payload.variables) ? payload.variables.map((v) => String(v).trim()).filter(Boolean) : [],
    sampleData: payload.sampleData || {},
    isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    isDefault: payload.isDefault !== undefined ? Boolean(payload.isDefault) : false,
    createdBy: String(payload.createdBy || ""),
    updatedBy: String(payload.updatedBy || ""),
  }),
  beforeUpdate: async (_existing, payload) => ({
    ...payload,
    ...(payload.key !== undefined ? { key: String(payload.key || "").trim() } : {}),
    ...(payload.name !== undefined ? { name: String(payload.name || "").trim() } : {}),
    ...(payload.module !== undefined ? { module: String(payload.module || "").trim() } : {}),
    ...(payload.subject !== undefined ? { subject: String(payload.subject || "").trim() } : {}),
    ...(payload.htmlContent !== undefined ? { htmlContent: String(payload.htmlContent || "") } : {}),
    ...(payload.textContent !== undefined ? { textContent: String(payload.textContent || "") } : {}),
    ...(payload.variables !== undefined
      ? { variables: Array.isArray(payload.variables) ? payload.variables.map((v) => String(v).trim()).filter(Boolean) : [] }
      : {}),
    ...(payload.sampleData !== undefined ? { sampleData: payload.sampleData } : {}),
    ...(payload.isActive !== undefined ? { isActive: Boolean(payload.isActive) } : {}),
    ...(payload.isDefault !== undefined ? { isDefault: Boolean(payload.isDefault) } : {}),
    ...(payload.updatedBy !== undefined ? { updatedBy: String(payload.updatedBy || "") } : {}),
  }),
});

router.get(
  "/email-templates/catalog",
  asyncHandler(async (req, res) => {
    const templateDocs = await EmailTemplate.find({
      key: { $in: EMAIL_TEMPLATE_DEFINITIONS.map((item) => item.key) },
    }).lean();
    const docsByKey = new Map(templateDocs.map((item) => [item.key, item]));
    const templateList = EMAIL_TEMPLATE_DEFINITIONS.map((definition) => {
      const existing = docsByKey.get(definition.key);
      const fallback = buildDefaultTemplate(definition);
      return {
        ...definition,
        id: existing?._id?.toString(),
        subject: existing?.subject || fallback.subject,
        htmlContent: existing?.htmlContent || fallback.htmlContent,
        textContent: existing?.textContent || fallback.textContent,
        sampleData: existing?.sampleData || sampleEmailVariables(),
        variables: existing?.variables?.length ? existing.variables : definition.variables || [],
        placeholders: (definition.variables || []).map((name) => `{{${name}}}`),
        status: {
          exists: Boolean(existing),
          isActive: existing?.isActive !== false,
          templateId: existing?._id?.toString() || null,
        },
      };
    });
    const modules = [...new Set(templateList.map((item) => String(item.module || "").trim()).filter(Boolean))];
    const types = [...new Set(templateList.map((item) => String(item.type || "").trim()).filter(Boolean))];
    const mappings = Object.fromEntries(templateList.map((item) => [item.key, item]));
    sendResponse(res, {
      data: {
        modules: modules.sort(),
        types: types.sort(),
        templates: templateList,
        variables: COMMON_EMAIL_VARIABLES,
        sampleData: sampleEmailVariables(),
        mappings,
      },
    });
  }),
);

router.get(
  "/email-templates/audit",
  asyncHandler(async (req, res) => {
    const templateDocs = await EmailTemplate.find({
      key: { $in: EMAIL_TEMPLATE_DEFINITIONS.map((item) => item.key) },
    }).lean();
    const docsByKey = new Map(templateDocs.map((item) => [item.key, item]));
    const modules = EMAIL_TEMPLATE_DEFINITIONS.map((definition) => {
      const existing = docsByKey.get(definition.key);
      return {
        moduleName: definition.module,
        functionality: definition.name,
        emailTriggerEvent: definition.trigger,
        templateKey: definition.key,
        status: !existing ? "Missing" : existing.isActive === false ? "Inactive" : "Working",
        templateId: existing?._id?.toString() || null,
      };
    });
    const totals = modules.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status.toLowerCase()] += 1;
        return acc;
      },
      { total: 0, working: 0, inactive: 0, missing: 0 },
    );
    sendResponse(res, { data: { modules, totals } });
  }),
);

router.post(
  "/email-templates/seed-defaults",
  asyncHandler(async (req, res) => {
    const updateExisting = Boolean(req.body?.updateExisting);
    const created = [];
    const updated = [];
    const skipped = [];

    for (const definition of EMAIL_TEMPLATE_DEFINITIONS) {
      const existing = await EmailTemplate.findOne({ key: definition.key });
      const payload = {
        ...buildDefaultTemplate(definition),
        sampleData: sampleEmailVariables(),
        updatedBy: "system",
      };

      if (!existing) {
        const doc = await EmailTemplate.create({ ...payload, createdBy: "system" });
        created.push({ key: doc.key, id: doc._id?.toString() });
        continue;
      }

      if (updateExisting) {
        existing.set({
          name: payload.name,
          type: payload.type,
          module: payload.module,
          subject: payload.subject,
          htmlContent: payload.htmlContent,
          textContent: payload.textContent,
          variables: payload.variables,
          sampleData: { ...(existing.sampleData || {}), ...(payload.sampleData || {}) },
          isDefault: true,
          updatedBy: "system",
        });
        await existing.save();
        updated.push({ key: existing.key, id: existing._id?.toString() });
      } else {
        skipped.push({ key: existing.key, reason: "Already exists" });
      }
    }

    sendResponse(res, {
      data: { created, updated, skipped },
      message: `Default templates processed: ${created.length} created, ${updated.length} updated, ${skipped.length} skipped.`,
    });
  }),
);

router.post(
  "/email-templates/:id/preview",
  asyncHandler(async (req, res) => {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) throw new AppError("Email template not found", 404);
    const values = sampleEmailVariables({ ...(template.sampleData || {}), ...(req.body?.variables || {}) });
    sendResponse(res, {
      data: {
        subject: renderTemplate(template.subject, values),
        htmlContent: renderTemplate(template.htmlContent, values),
        textContent: renderTemplate(template.textContent, values),
        variables: values,
      },
    });
  }),
);

router.post(
  "/email-templates/:id/test",
  asyncHandler(async (req, res) => {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) throw new AppError("Email template not found", 404);
    const to = String(req.body?.to || "").trim();
    if (!to) throw new AppError("Test recipient email is required", 400);
    const result = await sendTemplatedEmail(template.key, to, req.body?.variables || {});
    sendResponse(res, { data: result, message: result.skipped ? "Test email skipped" : "Test email sent" });
  }),
);

router.use("/email-templates", createCrudRouter({ key: "emailTemplate", label: "Email Template", service: emailTemplateService }));

router.get(
  "/email-logs",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 200);
    const search = String(req.query.search || "").trim();
    const filters = {};
    if (req.query.status) filters.status = String(req.query.status);
    if (req.query.module) filters.module = String(req.query.module);
    if (req.query.templateKey) filters.templateKey = String(req.query.templateKey);
    if (search) {
      filters.$or = [
        { to: new RegExp(search, "i") },
        { subject: new RegExp(search, "i") },
        { templateName: new RegExp(search, "i") },
        { templateKey: new RegExp(search, "i") },
      ];
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      EmailLog.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
      EmailLog.countDocuments(filters),
    ]);
    sendResponse(res, {
      data: items,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

router.post(
  "/email-logs/:id/retry",
  asyncHandler(async (req, res) => {
    const log = await EmailLog.findById(req.params.id);
    if (!log) throw new AppError("Email log not found", 404);
    if (!log.templateKey) throw new AppError("Only templated emails can be retried", 400);
    const result = await sendTemplatedEmail(log.templateKey, log.to, { ...(log.payload || {}), ...(req.body?.variables || {}) });
    log.status = result.skipped ? "skipped" : "sent";
    log.error = result.skipped ? result.reason || "" : "";
    log.attempts = Number(log.attempts || 0) + 1;
    log.lastAttemptAt = new Date();
    log.sentAt = result.skipped ? undefined : new Date();
    await log.save();
    sendResponse(res, { data: result, message: result.skipped ? "Retry skipped" : "Retry email sent" });
  }),
);

router.get("/auth-settings", asyncHandler(async (_req, res) => {
  const settings = await AuthSettings.findOneAndUpdate({ key: "default" }, { $setOnInsert: { key: "default" } }, { upsert: true, new: true });
  const data = settings.toJSON();
  data.googleClientId = data.googleClientId || process.env.GOOGLE_WEB_CLIENT_ID || "";
  data.googleAndroidClientId = data.googleAndroidClientId || process.env.GOOGLE_ANDROID_CLIENT_ID || "";
  data.googleIosClientId = data.googleIosClientId || process.env.GOOGLE_IOS_CLIENT_ID || "";
  data.googleAndroidPackageName = data.googleAndroidPackageName || "com.kritamcqs.androidapp";
  data.googleAndroidSha1 = data.googleAndroidSha1 || "CE:34:23:0A:77:79:E5:01:09:10:2C:3C:A9:9C:B3:BF:7B:FD:AF:C4";
  sendResponse(res, { data });
}));
router.post("/auth-settings", asyncHandler(async (req, res) => {
  const current = await AuthSettings.findOne({ key: "default" });
  const body = req.body || {};
  const payload = {
    emailPasswordEnabled: Boolean(body.emailPasswordEnabled),
    googleEnabled: Boolean(body.googleEnabled),
    googleClientId: String(body.googleClientId || process.env.GOOGLE_WEB_CLIENT_ID || "").trim(),
    googleAndroidClientId: String(body.googleAndroidClientId || process.env.GOOGLE_ANDROID_CLIENT_ID || "").trim(),
    googleIosClientId: String(body.googleIosClientId || process.env.GOOGLE_IOS_CLIENT_ID || "").trim(),
    googleAndroidPackageName: String(body.googleAndroidPackageName || "com.kritamcqs.androidapp").trim(),
    googleAndroidSha1: String(body.googleAndroidSha1 || "CE:34:23:0A:77:79:E5:01:09:10:2C:3C:A9:9C:B3:BF:7B:FD:AF:C4").trim().toUpperCase(),
    googleCallbackUrl: String(body.googleCallbackUrl || "").trim(),
    profileMobileRequired: Boolean(body.profileMobileRequired),
    googleRedirectUrls: Array.isArray(body.googleRedirectUrls)
      ? body.googleRedirectUrls.map((item) => String(item || "").trim()).filter(Boolean)
      : String(body.googleRedirectUrls || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
    resetOtpExpiryMinutes: Math.max(1, Math.min(60, Number(body.resetOtpExpiryMinutes || 10))),
    resetOtpMaxAttempts: Math.max(1, Math.min(10, Number(body.resetOtpMaxAttempts || 5))),
    resetOtpMaxResends: Math.max(1, Math.min(10, Number(body.resetOtpMaxResends || 3))),
    sessionTimeoutMinutes: Math.max(15, Number(body.sessionTimeoutMinutes || 43200)),
    resetOtpEmailSubject: String(body.resetOtpEmailSubject || "Krita password reset OTP").trim(),
    resetOtpEmailTemplate: String(body.resetOtpEmailTemplate || "Your Krita password reset OTP is {{otp}}. It expires in {{expiryMinutes}} minutes.").trim(),
  };
  const secret = String(body.googleClientSecret || "").trim();
  if (secret) payload.googleClientSecret = secret;
  else if (current?.googleClientSecret) payload.googleClientSecret = current.googleClientSecret;
  const settings = await AuthSettings.findOneAndUpdate(
    { key: "default" },
    { $set: payload, $setOnInsert: { key: "default" } },
    { upsert: true, new: true },
  );
  sendResponse(res, { message: "Authentication settings saved", data: settings });
}));

router.get("/weak-areas/analytics", asyncHandler(async (_req, res) => {
  const [weakAreas, subjects, chapters, users, categories] = await Promise.all([
    ChapterPerformance.find({}).sort({ updatedAt: -1 }).limit(1000),
    Subject.find({}).select("_id name examType examMode"),
    Chapter.find({}).select("_id name"),
    User.find({}).select("_id name email mobile isPremium"),
    mongoose.connection.collection("weak_area_categories").find({}).sort({ name: 1 }).toArray(),
  ]);

  const subjectMap = new Map(subjects.map((item) => [String(item._id), item]));
  const chapterMap = new Map(chapters.map((item) => [String(item._id), item]));
  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const activeWeakAreas = weakAreas.filter((item) => item.isWeak || item.strength === "weak");
  const commonTopics = new Map();

  activeWeakAreas.forEach((item) => {
    const chapter = chapterMap.get(String(item.chapterId));
    const subject = subjectMap.get(String(item.subjectId));
    const key = String(item.chapterId || "unknown");
    if (!commonTopics.has(key)) {
      commonTopics.set(key, {
        chapterId: String(item.chapterId || ""),
        chapterName: chapter?.name || "Unknown",
        subjectName: subject?.name || "Unknown",
        affectedUsers: 0,
        wrongCount: 0,
        averageAccuracy: 0,
      });
    }
    const row = commonTopics.get(key);
    row.affectedUsers += 1;
    row.wrongCount += Number(item.wrongCount || 0);
    row.averageAccuracy += Number(item.accuracy || 0) * 100;
  });

  const commonWeakTopics = Array.from(commonTopics.values())
    .map((item) => ({
      ...item,
      averageAccuracy: item.affectedUsers > 0 ? Math.round((item.averageAccuracy / item.affectedUsers) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.affectedUsers - a.affectedUsers || b.wrongCount - a.wrongCount)
    .slice(0, 20);

  const improvementTrends = weakAreas
    .filter((item) => Number(item.totalAttempts || 0) > 0)
    .sort((a, b) => Number(b.improvementPercentage || 0) - Number(a.improvementPercentage || 0))
    .slice(0, 20)
    .map((item) => {
      const user = userMap.get(String(item.userId));
      const subject = subjectMap.get(String(item.subjectId));
      const chapter = chapterMap.get(String(item.chapterId));
      return {
        id: item.id,
        userId: item.userId,
        userName: user?.name || user?.email || user?.mobile || "Learner",
        subjectName: subject?.name || "Unknown",
        chapterName: chapter?.name || "Unknown",
        attempts: item.totalAttempts,
        accuracy: Math.round(Number(item.accuracy || 0) * 10000) / 100,
        improvementPercentage: Math.round(Number(item.improvementPercentage || 0) * 100) / 100,
        strength: item.strength,
        isMastered: item.isMastered,
      };
    });

  res.json({
    summary: {
      totalWeakAreas: activeWeakAreas.length,
      trackedAreas: weakAreas.length,
      masteredAreas: weakAreas.filter((item) => item.isMastered).length,
      usersAffected: new Set(activeWeakAreas.map((item) => String(item.userId))).size,
    },
    commonWeakTopics,
    improvementTrends,
    userAnalytics: activeWeakAreas.slice(0, 100).map((item) => {
      const user = userMap.get(String(item.userId));
      const subject = subjectMap.get(String(item.subjectId));
      const chapter = chapterMap.get(String(item.chapterId));
      return {
        id: item.id,
        userName: user?.name || user?.email || user?.mobile || "Learner",
        isPremium: Boolean(user?.isPremium),
        subjectName: subject?.name || "Unknown",
        chapterName: chapter?.name || "Unknown",
        attempts: item.totalAttempts,
        wrongCount: item.wrongCount,
        accuracy: Math.round(Number(item.accuracy || 0) * 10000) / 100,
        incorrectQuestionIds: item.incorrectQuestionIds || [],
        topicIds: item.topicIds || [],
        updatedAt: item.updatedAt,
      };
    }),
    categories: categories.map((item) => ({ ...item, id: String(item._id), _id: undefined })),
  });
}));

router.post("/weak-areas/categories", asyncHandler(async (req, res) => {
  const now = new Date();
  const payload = {
    name: String(req.body?.name || "").trim(),
    description: String(req.body?.description || "").trim(),
    isActive: req.body?.isActive !== false,
    updatedAt: now,
    createdAt: now,
  };
  if (!payload.name) throw new AppError("Category name is required", 400);
  const result = await mongoose.connection.collection("weak_area_categories").insertOne(payload);
  res.status(201).json({ ...payload, id: String(result.insertedId) });
}));

router.put("/weak-areas/categories/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid category id", 400);
  const update = {
    name: String(req.body?.name || "").trim(),
    description: String(req.body?.description || "").trim(),
    isActive: req.body?.isActive !== false,
    updatedAt: new Date(),
  };
  if (!update.name) throw new AppError("Category name is required", 400);
  await mongoose.connection.collection("weak_area_categories").updateOne(
    { _id: new mongoose.Types.ObjectId(req.params.id) },
    { $set: update },
  );
  res.json({ ...update, id: req.params.id });
}));

router.delete("/weak-areas/categories/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Invalid category id", 400);
  await mongoose.connection.collection("weak_area_categories").deleteOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
  res.json({ success: true });
}));

router.get("/mistakes/analytics", asyncHandler(async (_req, res) => {
  const [mistakes, attempts, subjects, chapters, questions, users] = await Promise.all([
    Mistake.find({}).sort({ updatedAt: -1 }).limit(1000),
    QuestionAttempt.find({ skipped: { $ne: true } }).sort({ createdAt: -1 }).limit(5000),
    Subject.find({}).select("_id name"),
    Chapter.find({}).select("_id name"),
    Question.find({}).select("_id question subjectId chapterId difficulty difficultyId"),
    User.find({}).select("_id name email mobile isPremium"),
  ]);
  const subjectMap = new Map(subjects.map((item) => [String(item._id), item]));
  const chapterMap = new Map(chapters.map((item) => [String(item._id), item]));
  const questionMap = new Map(questions.map((item) => [String(item._id), item]));
  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const questionStats = new Map();

  attempts.forEach((attempt) => {
    const questionId = String(attempt.questionId);
    const question = questionMap.get(questionId);
    if (!questionStats.has(questionId)) {
      questionStats.set(questionId, {
        questionId,
        question: question?.question || "Question unavailable",
        subjectName: subjectMap.get(String(question?.subjectId || attempt.subjectId))?.name || "Unknown",
        chapterName: chapterMap.get(String(question?.chapterId || attempt.chapterId))?.name || "Unknown",
        difficulty: String(question?.difficulty || question?.difficultyId || "Unassigned"),
        attempts: 0,
        wrong: 0,
      });
    }
    const row = questionStats.get(questionId);
    row.attempts += 1;
    if (!attempt.isCorrect) row.wrong += 1;
  });

  const frequentIncorrectQuestions = Array.from(questionStats.values())
    .map((item) => ({ ...item, wrongRate: item.attempts > 0 ? Math.round((item.wrong / item.attempts) * 10000) / 100 : 0 }))
    .sort((a, b) => b.wrong - a.wrong || b.wrongRate - a.wrongRate)
    .slice(0, 25);

  const topicReports = new Map();
  attempts.forEach((attempt) => {
    const key = String(attempt.chapterId || "unknown");
    if (!topicReports.has(key)) {
      topicReports.set(key, {
        chapterId: key,
        subjectName: subjectMap.get(String(attempt.subjectId))?.name || "Unknown",
        chapterName: chapterMap.get(String(attempt.chapterId))?.name || "Unknown",
        attempts: 0,
        wrong: 0,
      });
    }
    const row = topicReports.get(key);
    row.attempts += 1;
    if (!attempt.isCorrect) row.wrong += 1;
  });

  const difficultyReports = new Map();
  frequentIncorrectQuestions.forEach((item) => {
    const key = item.difficulty || "Unassigned";
    if (!difficultyReports.has(key)) difficultyReports.set(key, { difficulty: key, questions: 0, wrong: 0, attempts: 0 });
    const row = difficultyReports.get(key);
    row.questions += 1;
    row.wrong += item.wrong;
    row.attempts += item.attempts;
  });

  res.json({
    summary: {
      activeMistakes: mistakes.filter((item) => item.completionStatus !== "completed").length,
      repeatedMistakes: mistakes.filter((item) => Number(item.attempts || 0) >= 2).length,
      weakMistakes: mistakes.filter((item) => item.status === "weak").length,
      trackedQuestions: questionStats.size,
    },
    frequentIncorrectQuestions,
    userMistakeAnalytics: mistakes.slice(0, 100).map((item) => {
      const user = userMap.get(String(item.userId));
      const question = questionMap.get(String(item.questionId));
      return {
        id: item.id,
        userName: user?.name || user?.email || user?.mobile || "Learner",
        isPremium: Boolean(user?.isPremium),
        question: question?.question || "Question unavailable",
        subjectName: subjectMap.get(String(item.subjectId || question?.subjectId))?.name || "Unknown",
        chapterName: chapterMap.get(String(item.chapterId || question?.chapterId))?.name || "Unknown",
        attempts: item.attempts,
        accuracy: item.accuracy,
        status: item.status,
        completionStatus: item.completionStatus,
        lastAttemptDate: item.lastAttemptDate,
      };
    }),
    topicReports: Array.from(topicReports.values())
      .map((item) => ({ ...item, wrongRate: item.attempts > 0 ? Math.round((item.wrong / item.attempts) * 10000) / 100 : 0 }))
      .sort((a, b) => b.wrong - a.wrong)
      .slice(0, 25),
    difficultyReports: Array.from(difficultyReports.values())
      .map((item) => ({ ...item, wrongRate: item.attempts > 0 ? Math.round((item.wrong / item.attempts) * 10000) / 100 : 0 }))
      .sort((a, b) => b.wrongRate - a.wrongRate),
    repeatedMistakes: mistakes.filter((item) => Number(item.attempts || 0) >= 2).slice(0, 50),
  });
}));

router.use("/users", createCrudRouter({ key: "user", label: "User", service: userService }));
router.use("/coupons", createCrudRouter({ key: "coupon", label: "Coupon", service: couponService }));
router.use(
  "/subscription-plan-configs",
  createCrudRouter({ key: "subscriptionPlan", label: "Subscription Plan", service: subscriptionPlanService }),
);

export default router;
