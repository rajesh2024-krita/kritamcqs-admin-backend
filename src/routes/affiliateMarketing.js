import crypto from "node:crypto";
import { Router } from "express";
import { AFFILIATE_PERMISSION_DEFAULTS, Affiliate, AffiliateActivityLog, AffiliateAdminNotification, AffiliateAuditLog, AffiliateEmailActivity, AffiliateEventTemplate, AffiliateNotification, AffiliatePaymentCycle, AffiliatePurchase, AffiliateReferral, AffiliateRole, AffiliateSettings, InvoiceSettings } from "../models/index.js";
import { requireAdmin, requireMainAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { hashPassword } from "../utils/password.js";
import { sendEmail } from "../utils/simpleEmail.js";

export const affiliateMarketingRouter = Router();
affiliateMarketingRouter.use(requireAdmin, requireMainAdmin);
const actor = (req) => req.admin?._id?.toString();
const DEFAULT_REFERRAL_BASE_URL = "https://affiliateapi.kritamcqs.com/affiliatelink";
const LEGACY_REFERRAL_BASE_URLS = new Set(["https://kritamcqs.com", "https://app.kritamcqs.com/affiliate"]);
const allowedAffiliateProfile = ["firstName", "lastName", "affiliateName", "email", "mobile", "username", "profileImage", "status", "accessEnabled", "roleId", "referralTarget", "commissionRatePercent", "referralCodeStatus", "referralCodeActivatedAt", "referralCodeExpiresAt", "dateOfBirth", "promotionChannels", "marketingCategory", "experienceLevel", "company", "organization", "profession", "website", "socialMediaLinks", "address", "city", "state", "country", "pincode", "description", "accountHolderName", "bankName", "accountNumber", "ifsc", "swiftCode", "upiId", "paypalEmail", "otherPaymentInformation", "paymentPreference", "pan", "gst", "notes"];
const PAYMENT_STATUSES = ["ACTIVE", "TARGET_REACHED", "ELIGIBLE_FOR_PAYMENT", "PAYMENT_PENDING", "ADMIN_REVIEW", "PAYMENT_PROCESSING", "PAYMENT_SENT", "PAYMENT_COMPLETED", "FAILED", "CANCELLED"];
const PAYMENT_TRANSITIONS = { ACTIVE: ["TARGET_REACHED", "PAYMENT_PENDING", "CANCELLED"], TARGET_REACHED: ["ELIGIBLE_FOR_PAYMENT", "PAYMENT_PENDING", "CANCELLED"], ELIGIBLE_FOR_PAYMENT: ["PAYMENT_PENDING", "ADMIN_REVIEW", "PAYMENT_PROCESSING", "CANCELLED"], PAYMENT_PENDING: ["PAYMENT_PROCESSING", "PAYMENT_SENT", "CANCELLED"], ADMIN_REVIEW: ["PAYMENT_PROCESSING", "CANCELLED"], PAYMENT_PROCESSING: ["PAYMENT_SENT", "FAILED"], PAYMENT_SENT: ["PAYMENT_COMPLETED", "FAILED"], FAILED: ["PAYMENT_PROCESSING", "CANCELLED"], PAYMENT_COMPLETED: [], CANCELLED: [] };
const DEFAULT_EVENTS = ["AFFILIATE_CREATED", "AFFILIATE_UPDATED", "AFFILIATE_ACTIVATED", "AFFILIATE_DEACTIVATED", "AFFILIATE_SUSPENDED", "REFERRAL_CLICKED", "APP_INSTALLED", "USER_REGISTERED", "USER_LOGGED_IN", "SUBSCRIPTION_PURCHASED", "PURCHASE_CANCELLED", "PURCHASE_REFUNDED", "CYCLE_STARTED", "CYCLE_TARGET_REACHED", "PAYMENT_PROCESSING", "PAYMENT_SENT", "PAYMENT_COMPLETED", "PAYMENT_FAILED", "COMMISSION_UPDATED", "PROFILE_UPDATED", "PASSWORD_CHANGED"];
const AFFILIATE_VISIBLE_EVENTS = new Set(["SUBSCRIPTION_PURCHASED", "PAYMENT_SENT", "ADMIN_MESSAGE"]);
const humanize = (value) => String(value || "").toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const interpolate = (value, variables) => String(value || "").replace(/{{\s*([\w.]+)\s*}}/g, (_all, key) => variables[key] ?? "");
const adminRequestMeta = req => ({ ipAddress: String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim(), device: String(req.headers["user-agent"] || "").slice(0, 500), browser: String(req.headers["sec-ch-ua"] || req.headers["user-agent"] || "").slice(0, 200) });
async function recordActivity(req, affiliateId, action, module, description, metadata) { return AffiliateActivityLog.create({ activityId: crypto.randomUUID(), userType: "ADMIN", userId: actor(req), affiliateId, action, module, description, ...adminRequestMeta(req), metadata }); }

async function ensureRoles() {
  const definitions = [
    { name: "Standard Affiliate", description: "Dashboard, referrals, payment cycles, notifications and profile", isDefault: true, isSystem: true, permissions: AFFILIATE_PERMISSION_DEFAULTS },
    { name: "Limited Affiliate", description: "Basic referral statistics and referral link", isSystem: true, permissions: { ...AFFILIATE_PERMISSION_DEFAULTS, referralDetails: false, purchaseDetails: false, commissionVisibility: false, analytics: false, reports: false } },
    { name: "Premium Affiliate", description: "Full analytics, campaign and report access", isSystem: true, permissions: { ...AFFILIATE_PERMISSION_DEFAULTS, campaigns: true, reports: true, analytics: true } },
  ];
  await Promise.all(definitions.map((item) => AffiliateRole.updateOne({ name: item.name }, { $setOnInsert: item }, { upsert: true })));
}

async function ensureEventTemplates() {
  await Promise.all(DEFAULT_EVENTS.map((event) => AffiliateEventTemplate.updateOne({ event }, { $setOnInsert: { event, name: humanize(event), title: humanize(event), subject: `[KritaMCQs] ${humanize(event)}`, message: `Hello {{affiliate_name}}, ${humanize(event).toLowerCase()} for payment cycle {{cycle_number}}.`, htmlContent: `<p>Hello {{affiliate_name}},</p><p>${humanize(event)} for payment cycle <strong>{{cycle_number}}</strong>.</p>`, textContent: `Hello {{affiliate_name}}, ${humanize(event)} for payment cycle {{cycle_number}}.`, variables: ["affiliate_name", "affiliate_code", "cycle_number", "target_count", "successful_count", "earnings", "payment_status", "status_date"] } }, { upsert: true })));
}

async function syncPaymentCycles(affiliateId) {
  await AffiliatePaymentCycle.updateMany({ affiliateId, status: "PENDING" }, { $set: { status: "ACTIVE" } });
  const [affiliate, config, purchases] = await Promise.all([Affiliate.findById(affiliateId), settings(), AffiliatePurchase.find({ affiliateId, paymentStatus: "PAID", subscriptionStatus: { $ne: "REFUNDED" } }).sort({ purchaseAt: 1, _id: 1 })]);
  if (!affiliate) throw new AppError("Affiliate not found", 404);
  const target = Math.max(1, Number(affiliate.referralTarget || config.milestoneCount || 25));
  const cycleCount = Math.floor(purchases.length / target) + 1;
  for (let index = 0; index < cycleCount; index += 1) {
    const slice = purchases.slice(index * target, (index + 1) * target);
    const eligible = slice.length >= target;
    const earnings = slice.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0), purchaseValue = slice.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const set = { startDate: slice[0]?.purchaseAt || new Date(), endDate: eligible ? slice.at(-1)?.purchaseAt : null, targetCount: target, successfulReferralCount: slice.length, rejectedReferralCount: 0, pendingReferralCount: Math.max(target - slice.length, 0), totalPurchaseValue: purchaseValue, earnings, finalPayableAmount: earnings, purchaseIds: slice.map((item) => item._id) };
    await AffiliatePaymentCycle.updateOne({ affiliateId, cycleNumber: index + 1 }, { $set: set, $setOnInsert: { affiliateId, cycleNumber: index + 1, status: eligible ? "PAYMENT_PENDING" : "ACTIVE", statusHistory: [{ status: eligible ? "PAYMENT_PENDING" : "ACTIVE", changedAt: new Date(), changedBy: "SYSTEM" }], ...(eligible ? { eligibleAt: slice.at(-1)?.purchaseAt || new Date(), completedAt: slice.at(-1)?.purchaseAt || new Date() } : {}) } }, { upsert: true });
    if (eligible) {
      const completedAt = slice.at(-1)?.purchaseAt || new Date();
      await AffiliatePaymentCycle.updateOne({ affiliateId, cycleNumber: index + 1, status: { $in: ["ACTIVE", "TARGET_REACHED", "ELIGIBLE_FOR_PAYMENT"] } }, { $set: { status: "PAYMENT_PENDING", eligibleAt: completedAt, completedAt }, $push: { statusHistory: { status: "PAYMENT_PENDING", changedAt: new Date(), changedBy: "SYSTEM" } } });
      const existingNotice = await AffiliateAdminNotification.exists({ type: "PAYMENT_CYCLE_COMPLETED", affiliateId, "metadata.cycleNumber": index + 1 });
      if (!existingNotice) await AffiliateAdminNotification.create({ type: "PAYMENT_CYCLE_COMPLETED", title: "Affiliate payment cycle completed", message: `${affiliate.affiliateName} (${affiliate.affiliateCode}) completed Payment Cycle ${index + 1} and is ready for payment processing.`, affiliateId, threshold: target, purchaseCount: slice.length, metadata: { affiliateName: affiliate.affiliateName, affiliateCode: affiliate.affiliateCode, cycleNumber: index + 1, cycleId: null } });
    }
  }
  return AffiliatePaymentCycle.find({ affiliateId }).sort({ cycleNumber: -1 });
}

async function dispatchCycleEvent(cycle, affiliate, event, adminId) {
  await ensureEventTemplates();
  const template = await AffiliateEventTemplate.findOne({ event });
  if (!template) return;
  const values = { affiliate_name: affiliate.affiliateName, affiliate_code: affiliate.affiliateCode, cycle_number: cycle.cycleNumber, target_count: cycle.targetCount, successful_count: cycle.successfulReferralCount, earnings: cycle.earnings, payment_status: humanize(cycle.status), status_date: new Date().toLocaleString("en-IN") };
  let notification;
  if (AFFILIATE_VISIBLE_EVENTS.has(event) && template.notificationEnabled && ["AFFILIATE", "BOTH"].includes(template.recipient)) notification = await AffiliateNotification.create({ affiliateId: affiliate._id, notificationType: event, title: interpolate(template.title, values), message: interpolate(template.message, values), reportData: { cycleId: cycle._id, cycleNumber: cycle.cycleNumber, status: cycle.status }, appNotificationStatus: "SENT", emailStatus: template.emailEnabled ? "PENDING" : "DISABLED", sentByAdminId: adminId, sentAt: new Date(), deliveredAt: new Date() });
  if (AFFILIATE_VISIBLE_EVENTS.has(event) && template.emailEnabled && affiliate.email && ["AFFILIATE", "BOTH"].includes(template.recipient)) {
    const subject = interpolate(template.subject, values), html = interpolate(template.htmlContent, values), text = interpolate(template.textContent || template.message, values);
    const activity = await AffiliateEmailActivity.create({ affiliateId: affiliate._id, cycleId: cycle._id, recipientName: affiliate.affiliateName, recipientEmail: affiliate.email, event, subject, renderedContent: html || text, templateId: template._id, templateName: template.name, status: "PROCESSING", timeline: [{ status: "QUEUED", at: new Date() }, { status: "PROCESSING", at: new Date() }], triggeredBy: adminId });
    try { const mail = await InvoiceSettings.findOne().lean(); const result = await sendEmail({ smtp: mail?.smtp, to: affiliate.email, subject, text, html }); const status = result?.skipped ? "DISABLED" : "SENT"; activity.status = status; activity.timeline.push({ status, at: new Date(), detail: result?.reason }); await activity.save(); if (notification) { notification.emailStatus = status; await notification.save(); } }
    catch (error) { activity.status = "FAILED"; activity.failedReason = error.message; activity.timeline.push({ status: "FAILED", at: new Date(), detail: error.message }); await activity.save(); if (notification) { notification.emailStatus = "FAILED"; notification.reportData = { ...notification.reportData, emailError: error.message }; await notification.save(); } }
  }
}

function normalizeReferralBaseUrl(value) {
  const raw = String(value || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("Referral base URL must be a valid HTTPS URL", 400);
  }
  if (url.protocol !== "https:") throw new AppError("Referral base URL must use HTTPS", 400);
  url.hash = "";
  url.searchParams.delete("code");
  url.searchParams.delete("ref");
  return url.toString().replace(/\/$/, "");
}

function buildReferralLink(baseUrl, affiliateCode) {
  const url = new URL(normalizeReferralBaseUrl(baseUrl));
  url.searchParams.set("code", String(affiliateCode || "").trim().toUpperCase());
  return url.toString();
}

async function generateUniqueAffiliateCode() {
  let code = `AFF${String(await Affiliate.countDocuments() + 1).padStart(4, "0")}`;
  while (await Affiliate.exists({ affiliateCode: code })) code = `AFF${crypto.randomInt(100000, 999999)}`;
  return code;
}

async function updateAllAffiliateLinks(baseUrl) {
  const affiliates = await Affiliate.find().select("affiliateCode");
  await Promise.all(affiliates.map((item) => Affiliate.updateOne(
    { _id: item._id },
    { $set: { referralLink: buildReferralLink(baseUrl, item.affiliateCode) } },
  )));
}

async function settings() {
  let value = await AffiliateSettings.findOneAndUpdate({ key: "default" }, { $setOnInsert: { key: "default" } }, { upsert: true, new: true });
  if (LEGACY_REFERRAL_BASE_URLS.has(String(value.referralBaseUrl || "").replace(/\/$/, ""))) {
    value = await AffiliateSettings.findOneAndUpdate({ key: "default" }, { $set: { referralBaseUrl: DEFAULT_REFERRAL_BASE_URL } }, { new: true });
    await updateAllAffiliateLinks(DEFAULT_REFERRAL_BASE_URL);
  }
  return value;
}
function pageValues(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(500, Math.max(1, Number(query.limit || 25)));
  return { page, limit, skip: (page - 1) * limit };
}
function parseDate(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}
function platform(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "ANDROID" || normalized === "IOS" ? normalized : normalized === "WEB" ? "WEB" : "";
}
function addDateRange(filter, query, field = "clickAt") {
  const from = parseDate(query.from || query.startDate);
  const to = parseDate(query.to || query.endDate);
  if (from || to) filter[field] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
}
function referralFilters(query = {}, base = {}) {
  const filter = { ...base };
  addDateRange(filter, query);
  if (query.affiliateId) filter.affiliateId = query.affiliateId;
  if (query.affiliateCode) filter.affiliateCode = String(query.affiliateCode).trim().toUpperCase();
  if (query.campaign) filter.campaign = String(query.campaign).trim();
  if (query.affiliateLinkId) filter.affiliateLinkId = String(query.affiliateLinkId).trim();
  const normalizedPlatform = platform(query.platform);
  if (normalizedPlatform) filter.platform = normalizedPlatform;
  for (const key of ["clickStatus", "installationStatus", "registrationStatus", "loginStatus", "purchaseStatus", "conversionStatus", "userType", "attributionStatus"]) {
    if (query[key]) filter[key] = String(query[key]).trim().toUpperCase();
  }
  return filter;
}
function purchaseFilters(query = {}, base = {}) {
  const filter = { ...base };
  addDateRange(filter, query, "purchaseAt");
  if (query.affiliateId) filter.affiliateId = query.affiliateId;
  const normalizedPlatform = platform(query.platform);
  if (normalizedPlatform) filter.platform = normalizedPlatform;
  if (query.paymentStatus) filter.paymentStatus = String(query.paymentStatus).trim().toUpperCase();
  if (query.purchaseStatus) filter.paymentStatus = String(query.purchaseStatus).trim().toUpperCase();
  if (query.conversionStatus) filter.conversionStatus = String(query.conversionStatus).trim().toUpperCase();
  return filter;
}
async function metrics(match = {}) {
  const purchaseMatch = { paymentStatus: "PAID", subscriptionStatus: { $ne: "REFUNDED" } };
  if (match.affiliateId) purchaseMatch.affiliateId = match.affiliateId;
  if (match.platform) purchaseMatch.platform = match.platform;
  if (match.clickAt) purchaseMatch.purchaseAt = match.clickAt;
  const [clicks, uniqueClicks, installs, existingAppUsers, registrations, existingUserLogins, premiumPurchases, pendingConversions, failedPurchases, result, commissionBreakdown] = await Promise.all([
    AffiliateReferral.countDocuments(match),
    AffiliateReferral.distinct("referralClickId", match),
    AffiliateReferral.countDocuments({ ...match, installationStatus: "NEW_INSTALL" }),
    AffiliateReferral.countDocuments({ ...match, installationStatus: "EXISTING_APP_USER" }),
    AffiliateReferral.countDocuments({ ...match, registrationStatus: "REGISTERED" }),
    AffiliateReferral.countDocuments({ ...match, registrationStatus: "EXISTING_USER", loginStatus: "LOGGED_IN" }),
    AffiliateReferral.countDocuments({ ...match, purchaseStatus: "PAID" }),
    AffiliateReferral.countDocuments({ ...match, conversionStatus: "PENDING", userId: { $exists: true } }),
    AffiliateReferral.countDocuments({ ...match, purchaseStatus: { $in: ["FAILED", "CANCELLED"] } }),
    AffiliatePurchase.aggregate([{ $match: purchaseMatch }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" }, commission: { $sum: "$commissionAmount" } } }]),
    AffiliatePurchase.aggregate([{ $match: purchaseMatch }, { $group: { _id: "$commissionStatus", commission: { $sum: "$commissionAmount" } } }]),
  ]);
  const successfulPurchases = Number(result[0]?.count || 0);
  const totalPurchaseAmount = Number(result[0]?.amount || 0);
  const paidCommission = Number(commissionBreakdown.find((item) => item._id === "PAID")?.commission || 0);
  const pendingCommission = Number(result[0]?.commission || 0) - paidCommission;
  return { clicks, totalClicks: clicks, uniqueClicks: uniqueClicks.length, newAppInstallations: installs, existingAppUsers, registrations, existingUserLogins, newUsers: registrations, existingUsers: existingUserLogins, premiumPurchases, successfulConversions: successfulPurchases, pendingConversions, failedOrCancelledPurchases: failedPurchases, successfulPurchases, totalPurchaseAmount, commissionEarned: Number(result[0]?.commission || 0), pendingCommission, paidCommission, averagePurchaseValue: successfulPurchases ? totalPurchaseAmount / successfulPurchases : 0, conversionRate: clicks ? successfulPurchases / clicks * 100 : 0 };
}
function normalizeThresholds(value, fallback) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const thresholds = raw.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
  return [...new Set(thresholds.length ? thresholds : fallback)].sort((a, b) => a - b);
}
function affiliateSearchFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = String(query.status).trim().toUpperCase();
  if (query.search) {
    const regex = new RegExp(String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ affiliateName: regex }, { email: regex }, { mobile: regex }, { username: regex }, { affiliateCode: regex }];
  }
  return filter;
}
function sanitizeAffiliatePayload(body = {}, isCreate = false) {
  const update = {};
  for (const key of allowedAffiliateProfile) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  if (!isCreate) {
    delete update.affiliateCode;
    delete update.referralLink;
  }
  if (update.email) update.email = String(update.email).trim().toLowerCase();
  if (update.username) update.username = String(update.username).trim().toLowerCase();
  if (update.affiliateCode) update.affiliateCode = String(update.affiliateCode).trim().toUpperCase();
  if (update.status) update.status = String(update.status).trim().toUpperCase();
  return update;
}
function toPublicAffiliate(affiliate) {
  const value = typeof affiliate.toJSON === "function" ? affiliate.toJSON() : affiliate;
  delete value.passwordHash;
  delete value.tokenVersion;
  delete value.accountNumber;
  return value;
}
async function syncMilestoneNotifications() {
  const config = await settings();
  const thresholds = normalizeThresholds(config.milestoneThresholds, [Number(config.milestoneCount || 25)]);
  const rows = await AffiliatePurchase.aggregate([
    { $match: { paymentStatus: "PAID", subscriptionStatus: { $ne: "REFUNDED" } } },
    { $group: { _id: "$affiliateId", count: { $sum: 1 } } },
  ]);
  const affiliates = await Affiliate.find({ _id: { $in: rows.map((row) => row._id).filter(Boolean) } }).select("affiliateName affiliateCode email");
  const affiliateMap = new Map(affiliates.map((item) => [String(item._id), item]));
  const created = [];
  for (const row of rows) {
    const affiliate = affiliateMap.get(String(row._id));
    if (!affiliate) continue;
    for (const threshold of thresholds) {
      if (row.count < threshold) continue;
      const existing = await AffiliateAdminNotification.exists({ type: "PURCHASE_MILESTONE", affiliateId: row._id, threshold });
      if (existing) continue;
      const notification = await AffiliateAdminNotification.create({
        type: "PURCHASE_MILESTONE",
        title: "Affiliate purchase milestone reached",
        message: `${affiliate.affiliateName} (${affiliate.affiliateCode}) reached ${row.count} successful purchases.`,
        affiliateId: row._id,
        threshold,
        purchaseCount: row.count,
        metadata: { affiliateName: affiliate.affiliateName, affiliateCode: affiliate.affiliateCode, email: affiliate.email },
      });
      created.push(notification);
    }
  }
  return created;
}

affiliateMarketingRouter.get("/affiliate-marketing/dashboard", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const [totalAffiliates, activeAffiliates, performance, unreadAdminNotifications] = await Promise.all([Affiliate.countDocuments(), Affiliate.countDocuments({ status: "ACTIVE" }), metrics(referralFilters(req.query)), AffiliateAdminNotification.countDocuments({ status: "UNREAD" })]); res.json({ success: true, data: { totalAffiliates, activeAffiliates, unreadAdminNotifications, ...performance } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/affiliates", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const { page, limit, skip } = pageValues(req.query); const filter = affiliateSearchFilter(req.query); const [items, total] = await Promise.all([Affiliate.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Affiliate.countDocuments(filter)]); const [stats, cycles] = await Promise.all([Promise.all(items.map((item) => metrics({ affiliateId: item._id }))), Promise.all(items.map((item) => syncPaymentCycles(item._id)))]); res.json({ success: true, data: { items: items.map((item, index) => { const completedCycles = cycles[index].filter((cycle) => Number(cycle.successfulReferralCount || 0) >= Number(cycle.targetCount || 0) && cycle.status !== "CANCELLED"); const currentCycle = cycles[index].find((cycle) => cycle.status === "ACTIVE") || cycles[index][0]; const latestCompletedCycle = completedCycles[0]; return { ...toPublicAffiliate(item), ...stats[index], referralCodeStatus: item.referralCodeStatus || "ACTIVE", currentCycle: currentCycle?.cycleNumber || 1, currentCycleStatus: currentCycle?.status || "ACTIVE", currentCycleProgress: `${Number(currentCycle?.successfulReferralCount || 0)} / ${Number(currentCycle?.targetCount || item.referralTarget || 25)}`, completedCycles: completedCycles.length, paymentStatus: latestCompletedCycle?.status || currentCycle?.status || "ACTIVE", pendingPayment: cycles[index].filter((cycle) => ["PAYMENT_PENDING", "PAYMENT_PROCESSING", "PAYMENT_SENT", "ADMIN_REVIEW"].includes(cycle.status)).reduce((sum, cycle) => sum + Number(cycle.finalPayableAmount || cycle.earnings || 0), 0) }; }), total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findById(req.params.id); if (!affiliate) throw new AppError("Affiliate not found", 404); const [performance, referrals, purchases, notifications, cycles] = await Promise.all([metrics({ affiliateId: affiliate._id }), AffiliateReferral.find({ affiliateId: affiliate._id }).sort({ clickAt: -1 }).limit(50), AffiliatePurchase.find({ affiliateId: affiliate._id }).sort({ purchaseAt: -1 }).limit(50), AffiliateNotification.find({ affiliateId: affiliate._id }).sort({ createdAt: -1 }).limit(50), syncPaymentCycles(affiliate._id)]); res.json({ success: true, data: { affiliate: { ...toPublicAffiliate(affiliate), ...performance }, referrals, purchases, notifications, cycles } }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates", asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.email || !body.username || !body.password || !body.affiliateName) throw new AppError("Affiliate name, email, username and password are required", 400);
  if (String(body.password).length < 8) throw new AppError("Password must be at least 8 characters", 400);
  let code = String(body.affiliateCode || "").trim().toUpperCase();
  if (code && !/^[A-Z0-9_-]{4,24}$/.test(code)) throw new AppError("Invalid affiliate code", 400);
  if (code && await Affiliate.exists({ affiliateCode: code })) throw new AppError("Affiliate code already exists", 409);
  if (!code) code = await generateUniqueAffiliateCode();
  await ensureRoles();
  const config = await settings();
  const defaultRole = config.defaultRoleId || (await AffiliateRole.findOne({ isDefault: true }))?._id;
  const payload = sanitizeAffiliatePayload(body, true);
  const affiliate = await Affiliate.create({
    ...payload,
    roleId: payload.roleId || defaultRole,
    affiliateCode: code,
    referralCodeStatus: payload.referralCodeStatus || "ACTIVE",
    referralCodeActivatedAt: payload.referralCodeActivatedAt || new Date(),
    passwordHash: hashPassword(body.password),
    referralLink: buildReferralLink(config.referralBaseUrl, code),
  });
  await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Created", newData: toPublicAffiliate(affiliate) });
  await recordActivity(req, affiliate._id, "AFFILIATE_CREATED", "AFFILIATES", "Affiliate account created");
  res.status(201).json({ success: true, data: toPublicAffiliate(affiliate) });
}));
affiliateMarketingRouter.patch("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const old = await Affiliate.findById(req.params.id); if (!old) throw new AppError("Affiliate not found", 404); const update = sanitizeAffiliatePayload(req.body); delete update.password; delete update.passwordHash; const revoke = update.status && update.status !== "ACTIVE"; const affiliate = await Affiliate.findByIdAndUpdate(old._id, { $set: update, ...(revoke ? { $inc: { tokenVersion: 1 } } : {}) }, { new: true, runValidators: true }); const action = update.status ? `AFFILIATE_${update.status}` : "AFFILIATE_UPDATED"; await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: old._id, action: update.status ? `Affiliate ${update.status}` : "Affiliate Updated", oldData: toPublicAffiliate(old), newData: toPublicAffiliate(affiliate) }); await recordActivity(req, old._id, action, "AFFILIATES", update.status ? `Affiliate status changed to ${update.status}` : "Affiliate profile updated", { fields: Object.keys(update) }); res.json({ success: true, data: toPublicAffiliate(affiliate) }); }));
affiliateMarketingRouter.delete("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findById(req.params.id).select("+tokenVersion"); if (!affiliate) throw new AppError("Affiliate not found", 404); affiliate.status = "DELETED"; affiliate.accessEnabled = false; affiliate.deletedAt = new Date(); affiliate.tokenVersion = Number(affiliate.tokenVersion || 0) + 1; await affiliate.save(); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Deleted", oldData: toPublicAffiliate(affiliate) }); await recordActivity(req, affiliate._id, "AFFILIATE_DELETED", "AFFILIATES", "Affiliate was soft deleted"); res.json({ success: true, message: "Affiliate deleted and can be restored" }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/restore", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findByIdAndUpdate(req.params.id, { $set: { status: "ACTIVE", accessEnabled: true, deletedAt: null } }, { new: true }); if (!affiliate) throw new AppError("Affiliate not found", 404); await recordActivity(req, affiliate._id, "AFFILIATE_RESTORED", "AFFILIATES", "Affiliate was restored"); res.json({ success: true, data: affiliate }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/force-logout", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findByIdAndUpdate(req.params.id, { $inc: { tokenVersion: 1 } }, { new: true }).select("+tokenVersion"); if (!affiliate) throw new AppError("Affiliate not found", 404); await recordActivity(req, affiliate._id, "FORCE_LOGOUT", "ACCESS", "All affiliate sessions were revoked"); res.json({ success: true, message: "All sessions revoked" }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/regenerate-link", asyncHandler(async (req, res) => {
  const affiliate = await Affiliate.findById(req.params.id);
  if (!affiliate) throw new AppError("Affiliate not found", 404);
  const config = await settings();
  affiliate.affiliateCode = await generateUniqueAffiliateCode();
  affiliate.referralLink = buildReferralLink(config.referralBaseUrl, affiliate.affiliateCode);
  affiliate.referralCodeStatus = "ACTIVE";
  affiliate.referralCodeActivatedAt = new Date();
  affiliate.referralCodeExpiresAt = req.body?.referralCodeExpiresAt ? new Date(req.body.referralCodeExpiresAt) : null;
  await affiliate.save();
  await recordActivity(req, affiliate._id, "REFERRAL_LINK_REGENERATED", "REFERRALS", "Affiliate referral code and link were regenerated");
  res.json({ success: true, data: affiliate });
}));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/reset-password", asyncHandler(async (req, res) => { if (String(req.body?.password || "").length < 8) throw new AppError("Password must be at least 8 characters", 400); await Affiliate.findByIdAndUpdate(req.params.id, { passwordHash: hashPassword(req.body.password) }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: req.params.id, action: "Password Reset" }); res.json({ success: true, message: "Password reset" }); }));
affiliateMarketingRouter.get("/affiliate-marketing/referrals", asyncHandler(async (req, res) => { const { page, limit, skip } = pageValues(req.query); const filter = referralFilters(req.query); const [items, total] = await Promise.all([AffiliateReferral.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ clickAt: -1 }).skip(skip).limit(limit), AffiliateReferral.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/purchases", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const { page, limit, skip } = pageValues(req.query); const filter = purchaseFilters(req.query); const [items, total] = await Promise.all([AffiliatePurchase.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ purchaseAt: -1 }).skip(skip).limit(limit), AffiliatePurchase.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/purchases/:id/commission", asyncHandler(async (req, res) => { const status = String(req.body?.commissionStatus || "").trim().toUpperCase(); if (!["PENDING", "PAID"].includes(status)) throw new AppError("commissionStatus must be PENDING or PAID", 400); const update = { commissionStatus: status, ...(status === "PAID" ? { commissionPaidAt: new Date() } : { commissionPaidAt: null }) }; const purchase = await AffiliatePurchase.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }); if (!purchase) throw new AppError("Purchase not found", 404); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: purchase.affiliateId, action: `Commission ${status}` }); res.json({ success: true, data: purchase }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/notifications", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findById(req.params.id); if (!affiliate) throw new AppError("Affiliate not found", 404); const title = String(req.body?.title || "").trim(); const message = String(req.body?.message || "").trim(); if (!title || !message) throw new AppError("Notification title and message are required", 400); const notification = await AffiliateNotification.create({ affiliateId: affiliate._id, notificationType: String(req.body?.notificationType || "ADMIN_MESSAGE").trim().toUpperCase(), title, message, reportData: req.body?.reportData || {}, emailStatus: "PENDING", appNotificationStatus: "SENT", sentByAdminId: actor(req), sentAt: new Date(), deliveredAt: new Date() }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Notification Sent", newData: notification.toJSON() }); res.status(201).json({ success: true, data: notification }); }));
affiliateMarketingRouter.get("/affiliate-marketing/notifications", asyncHandler(async (req, res) => { const { page, limit, skip } = pageValues(req.query); const filter = {}; if (req.query.status === "READ") filter.readAt = { $ne: null }; if (req.query.status === "UNREAD") filter.readAt = null; if (req.query.affiliateId) filter.affiliateId = req.query.affiliateId; const [items, total] = await Promise.all([AffiliateNotification.find(filter).populate("affiliateId", "affiliateName affiliateCode email").sort({ createdAt: -1 }).skip(skip).limit(limit), AffiliateNotification.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/admin-notifications", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const { page, limit, skip } = pageValues(req.query); const filter = {}; if (req.query.status) filter.status = String(req.query.status).trim().toUpperCase(); const [items, total, unread] = await Promise.all([AffiliateAdminNotification.find(filter).populate("affiliateId", "affiliateName affiliateCode email").sort({ createdAt: -1 }).skip(skip).limit(limit), AffiliateAdminNotification.countDocuments(filter), AffiliateAdminNotification.countDocuments({ status: "UNREAD" })]); res.json({ success: true, data: { items, total, unread, page, limit } }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/admin-notifications/:id/read", asyncHandler(async (req, res) => { const notification = await AffiliateAdminNotification.findByIdAndUpdate(req.params.id, { $set: { status: "READ", readAt: new Date() } }, { new: true }); if (!notification) throw new AppError("Notification not found", 404); res.json({ success: true, data: notification }); }));
affiliateMarketingRouter.get("/affiliate-marketing/payment-cycles", asyncHandler(async (req, res) => { const affiliates = req.query.affiliateId ? await Affiliate.find({ _id: req.query.affiliateId }) : await Affiliate.find(); await Promise.all(affiliates.map((item) => syncPaymentCycles(item._id))); const filter = { successfulReferralCount: { $gte: 1 }, $expr: { $gte: ["$successfulReferralCount", "$targetCount"] }, status: { $ne: "ACTIVE" }, ...(req.query.affiliateId ? { affiliateId: req.query.affiliateId } : {}) }; if (req.query.status) filter.status = String(req.query.status).toUpperCase(); const items = await AffiliatePaymentCycle.find(filter).populate("affiliateId", "affiliateName affiliateCode email").sort({ completedAt: -1, updatedAt: -1 }); res.json({ success: true, data: { items, total: items.length } }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/payment-cycles/:id/status", asyncHandler(async (req, res) => { const status = String(req.body?.status || "").toUpperCase(); if (!PAYMENT_STATUSES.includes(status)) throw new AppError("Invalid payment cycle status", 400); const old = await AffiliatePaymentCycle.findById(req.params.id); if (!old) throw new AppError("Payment cycle not found", 404); if (status !== old.status && !PAYMENT_TRANSITIONS[old.status]?.includes(status)) throw new AppError(`Cannot change payment cycle from ${old.status} to ${status}`, 409); const now = new Date(); old.status = status; old.statusHistory.push({ status, changedAt: now, changedBy: actor(req), note: String(req.body?.note || "") }); for (const key of ["adjustments", "paymentMethod", "transactionReference", "paymentProof"]) if (req.body?.[key] !== undefined) old[key] = req.body[key]; old.finalPayableAmount = Number(old.earnings || 0) + Number(old.adjustments || 0); if (["PAYMENT_SENT", "PAYMENT_COMPLETED"].includes(status)) old.paymentDate = now; if (status === "PAYMENT_COMPLETED" && !old.completedAt) old.completedAt = now; await old.save(); if (["PAYMENT_SENT", "PAYMENT_COMPLETED"].includes(status) && old.purchaseIds?.length) await AffiliatePurchase.updateMany({ _id: { $in: old.purchaseIds } }, { $set: { commissionStatus: "PAID", commissionPaidAt: now } }); const affiliate = await Affiliate.findById(old.affiliateId); const event = { TARGET_REACHED: "CYCLE_TARGET_REACHED", PAYMENT_PENDING: "CYCLE_TARGET_REACHED", PAYMENT_PROCESSING: "PAYMENT_PROCESSING", PAYMENT_SENT: "PAYMENT_SENT", PAYMENT_COMPLETED: "PAYMENT_COMPLETED", FAILED: "PAYMENT_FAILED", CANCELLED: "PAYMENT_FAILED" }[status]; if (affiliate && event) await dispatchCycleEvent(old, affiliate, event, actor(req)); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: old.affiliateId, action: `Payment Cycle ${old.cycleNumber}: ${status}`, newData: old.toJSON() }); await recordActivity(req, old.affiliateId, "PAYMENT_STATUS_CHANGED", "PAYMENTS", `Cycle ${old.cycleNumber} changed to ${status}`, { cycleId: old._id }); res.json({ success: true, data: old }); }));
affiliateMarketingRouter.get("/affiliate-marketing/event-templates", asyncHandler(async (_req, res) => { await ensureEventTemplates(); res.json({ success: true, data: await AffiliateEventTemplate.find().sort({ event: 1 }) }); }));
affiliateMarketingRouter.post("/affiliate-marketing/event-templates", asyncHandler(async (req, res) => { const event = String(req.body?.event || "").trim().toUpperCase(); if (!event || !req.body?.name) throw new AppError("Event and template name are required", 400); const item = await AffiliateEventTemplate.create({ ...req.body, event, updatedBy: actor(req) }); res.status(201).json({ success: true, data: item }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/event-templates/:id", asyncHandler(async (req, res) => { const update = { ...req.body, updatedBy: actor(req) }; delete update.event; const item = await AffiliateEventTemplate.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true }); if (!item) throw new AppError("Template not found", 404); res.json({ success: true, data: item }); }));
affiliateMarketingRouter.post("/affiliate-marketing/event-templates/:id/preview", asyncHandler(async (req, res) => { const item = await AffiliateEventTemplate.findById(req.params.id); if (!item) throw new AppError("Template not found", 404); const values = { affiliate_name: "Sample Affiliate", affiliate_code: "AFF0001", cycle_number: 3, target_count: 25, successful_count: 25, earnings: "5,000", payment_status: "Payment Sent", status_date: new Date().toLocaleString("en-IN"), ...(req.body?.variables || {}) }; res.json({ success: true, data: { title: interpolate(item.title, values), message: interpolate(item.message, values), subject: interpolate(item.subject, values), htmlContent: interpolate(item.htmlContent, values), textContent: interpolate(item.textContent, values) } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/affiliates/:id/permissions", asyncHandler(async (req, res) => { await ensureRoles(); const affiliate = await Affiliate.findById(req.params.id).populate("roleId"); if (!affiliate) throw new AppError("Affiliate not found", 404); const rolePermissions = affiliate.roleId?.permissions instanceof Map ? Object.fromEntries(affiliate.roleId.permissions) : affiliate.roleId?.permissions || {}; const overrides = affiliate.permissionOverrides instanceof Map ? Object.fromEntries(affiliate.permissionOverrides) : affiliate.permissionOverrides || {}; res.json({ success: true, data: { role: affiliate.roleId, overrides, effectivePermissions: { ...AFFILIATE_PERMISSION_DEFAULTS, ...rolePermissions, ...overrides }, accessEnabled: affiliate.accessEnabled !== false } }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/affiliates/:id/permissions", asyncHandler(async (req, res) => { const update = {}; if (req.body?.roleId !== undefined) update.roleId = req.body.roleId || null; if (req.body?.permissionOverrides !== undefined) update.permissionOverrides = req.body.permissionOverrides; if (req.body?.accessEnabled !== undefined) update.accessEnabled = Boolean(req.body.accessEnabled); const affiliate = await Affiliate.findByIdAndUpdate(req.params.id, { $set: update, ...(update.accessEnabled === false ? { $inc: { tokenVersion: 1 } } : {}) }, { new: true }); if (!affiliate) throw new AppError("Affiliate not found", 404); await recordActivity(req, affiliate._id, "PERMISSIONS_CHANGED", "ACCESS", "Affiliate role, permissions, or panel access changed", update); res.json({ success: true, data: affiliate }); }));
affiliateMarketingRouter.get("/affiliate-marketing/roles", asyncHandler(async (_req, res) => { await ensureRoles(); res.json({ success: true, data: await AffiliateRole.find().sort({ name: 1 }) }); }));
affiliateMarketingRouter.post("/affiliate-marketing/roles", asyncHandler(async (req, res) => { if (!req.body?.name) throw new AppError("Role name is required", 400); const item = await AffiliateRole.create({ name: req.body.name, description: req.body.description, permissions: { ...AFFILIATE_PERMISSION_DEFAULTS, ...(req.body.permissions || {}) } }); res.status(201).json({ success: true, data: item }); }));
affiliateMarketingRouter.get("/affiliate-marketing/roles/:id", asyncHandler(async (req, res) => { const item = await AffiliateRole.findById(req.params.id); if (!item) throw new AppError("Role not found", 404); res.json({ success: true, data: item }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/roles/:id", asyncHandler(async (req, res) => { const item = await AffiliateRole.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }); if (!item) throw new AppError("Role not found", 404); res.json({ success: true, data: item }); }));
affiliateMarketingRouter.delete("/affiliate-marketing/roles/:id", asyncHandler(async (req, res) => { const item = await AffiliateRole.findById(req.params.id); if (!item) throw new AppError("Role not found", 404); if (item.isSystem) throw new AppError("System roles cannot be deleted", 409); if (await Affiliate.exists({ roleId: item._id })) throw new AppError("Role is assigned to affiliates", 409); await item.deleteOne(); res.json({ success: true, message: "Role deleted" }); }));
affiliateMarketingRouter.get("/affiliate-marketing/activities", asyncHandler(async (req, res) => { const filter = {}; if (req.query.affiliateId) filter.affiliateId = req.query.affiliateId; if (req.query.action) filter.action = req.query.action; const items = await AffiliateActivityLog.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ createdAt: -1 }).limit(1000); res.json({ success: true, data: { items, total: items.length } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/affiliates/:id/activities", asyncHandler(async (req, res) => { const items = await AffiliateActivityLog.find({ affiliateId: req.params.id }).sort({ createdAt: -1 }).limit(1000); res.json({ success: true, data: { items, total: items.length } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/communication/activity", asyncHandler(async (req, res) => { const filter = {}; if (req.query.affiliateId) filter.affiliateId = req.query.affiliateId; if (req.query.status) filter.status = String(req.query.status).toUpperCase(); if (req.query.event) filter.event = String(req.query.event).toUpperCase(); const items = await AffiliateEmailActivity.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ createdAt: -1 }).limit(1000); res.json({ success: true, data: { items, total: items.length } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/communication/activity/:id", asyncHandler(async (req, res) => { const item = await AffiliateEmailActivity.findById(req.params.id).populate("affiliateId", "affiliateName affiliateCode").populate("templateId"); if (!item) throw new AppError("Communication activity not found", 404); res.json({ success: true, data: item }); }));
affiliateMarketingRouter.post("/affiliate-marketing/communication/:id/retry", asyncHandler(async (req, res) => { const activity = await AffiliateEmailActivity.findById(req.params.id); if (!activity) throw new AppError("Communication activity not found", 404); if (!activity.recipientEmail) throw new AppError("Recipient email is missing", 409); activity.status = "PROCESSING"; activity.retryCount += 1; activity.timeline.push({ status: "PROCESSING", at: new Date(), detail: "Manual retry" }); try { const mail = await InvoiceSettings.findOne().lean(); const result = await sendEmail({ smtp: mail?.smtp, to: activity.recipientEmail, subject: activity.subject, html: activity.renderedContent }); activity.status = result?.skipped ? "DISABLED" : "SENT"; activity.failedReason = ""; activity.timeline.push({ status: activity.status, at: new Date(), detail: result?.reason }); } catch (error) { activity.status = "FAILED"; activity.failedReason = error.message; activity.timeline.push({ status: "FAILED", at: new Date(), detail: error.message }); } await activity.save(); res.json({ success: true, data: activity }); }));
affiliateMarketingRouter.post("/affiliate-marketing/communication/:id/resend", asyncHandler(async (req, res) => { const activity = await AffiliateEmailActivity.findById(req.params.id); if (!activity) throw new AppError("Communication activity not found", 404); const copy = await AffiliateEmailActivity.create({ affiliateId: activity.affiliateId, cycleId: activity.cycleId, recipientName: activity.recipientName, recipientEmail: activity.recipientEmail, event: activity.event, subject: activity.subject, renderedContent: activity.renderedContent, templateId: activity.templateId, templateName: activity.templateName, status: "QUEUED", timeline: [{ status: "QUEUED", at: new Date(), detail: "Manual resend" }], triggeredBy: actor(req) }); res.status(201).json({ success: true, data: copy }); }));
affiliateMarketingRouter.get("/affiliate-marketing/settings", asyncHandler(async (_req, res) => res.json({ success: true, data: await settings() })));
affiliateMarketingRouter.patch("/affiliate-marketing/settings", asyncHandler(async (req, res) => {
  const old = await settings();
  const update = { ...req.body };
  delete update.key;
  if (update.referralBaseUrl !== undefined) update.referralBaseUrl = normalizeReferralBaseUrl(update.referralBaseUrl);
  if (update.milestoneThresholds !== undefined) update.milestoneThresholds = normalizeThresholds(update.milestoneThresholds, [25]);
  if (update.milestoneCount !== undefined) update.milestoneCount = Number(update.milestoneCount);
  const value = await AffiliateSettings.findOneAndUpdate({ key: "default" }, { $set: update }, { new: true, runValidators: true });
  if (update.referralBaseUrl !== undefined && update.referralBaseUrl !== old.referralBaseUrl) {
    await updateAllAffiliateLinks(value.referralBaseUrl);
  }
  await AffiliateAuditLog.create({ adminId: actor(req), action: "Affiliate Settings Changed", oldData: old, newData: value });
  res.json({ success: true, data: value });
}));
affiliateMarketingRouter.get("/affiliate-marketing/audit-logs", asyncHandler(async (_req, res) => res.json({ success: true, data: await AffiliateAuditLog.find().sort({ createdAt: -1 }).limit(1000) })));
