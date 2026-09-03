import crypto from "node:crypto";
import { Router } from "express";
import { Affiliate, AffiliateAdminNotification, AffiliateAuditLog, AffiliateNotification, AffiliatePurchase, AffiliateReferral, AffiliateSettings } from "../models/index.js";
import { requireAdmin, requireMainAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { hashPassword } from "../utils/password.js";

export const affiliateMarketingRouter = Router();
affiliateMarketingRouter.use(requireAdmin, requireMainAdmin);
const actor = (req) => req.admin?._id?.toString();
const DEFAULT_REFERRAL_BASE_URL = "https://affiliateapi.kritamcqs.com/affiliatelink";
const LEGACY_REFERRAL_BASE_URLS = new Set(["https://kritamcqs.com", "https://app.kritamcqs.com/affiliate"]);
const allowedAffiliateProfile = ["firstName", "lastName", "affiliateName", "email", "mobile", "username", "profileImage", "status", "company", "organization", "profession", "website", "socialMediaLinks", "address", "city", "state", "country", "pincode", "description", "accountHolderName", "bankName", "accountNumber", "ifsc", "upiId", "pan", "gst", "notes"];

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
affiliateMarketingRouter.get("/affiliate-marketing/affiliates", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const { page, limit, skip } = pageValues(req.query); const filter = affiliateSearchFilter(req.query); const [items, total] = await Promise.all([Affiliate.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Affiliate.countDocuments(filter)]); const stats = await Promise.all(items.map((item) => metrics({ affiliateId: item._id }))); res.json({ success: true, data: { items: items.map((item, index) => ({ ...toPublicAffiliate(item), ...stats[index] })), total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findById(req.params.id); if (!affiliate) throw new AppError("Affiliate not found", 404); const [performance, referrals, purchases, notifications] = await Promise.all([metrics({ affiliateId: affiliate._id }), AffiliateReferral.find({ affiliateId: affiliate._id }).sort({ clickAt: -1 }).limit(50), AffiliatePurchase.find({ affiliateId: affiliate._id }).sort({ purchaseAt: -1 }).limit(50), AffiliateNotification.find({ affiliateId: affiliate._id }).sort({ createdAt: -1 }).limit(50)]); res.json({ success: true, data: { affiliate: { ...toPublicAffiliate(affiliate), ...performance }, referrals, purchases, notifications } }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates", asyncHandler(async (req, res) => { const body = req.body || {}; if (!body.email || !body.username || !body.password || !body.affiliateName) throw new AppError("Affiliate name, email, username and password are required", 400); if (String(body.password).length < 8) throw new AppError("Password must be at least 8 characters", 400); let code = String(body.affiliateCode || "").trim().toUpperCase(); if (code && !/^[A-Z0-9_-]{4,24}$/.test(code)) throw new AppError("Invalid affiliate code", 400); if (!code) { code = `AFF${String(await Affiliate.countDocuments() + 1).padStart(4, "0")}`; while (await Affiliate.exists({ affiliateCode: code })) code = `AFF${crypto.randomInt(1000, 999999)}`; } const config = await settings(); const payload = sanitizeAffiliatePayload(body, true); const affiliate = await Affiliate.create({ ...payload, affiliateCode: code, passwordHash: hashPassword(body.password), referralLink: buildReferralLink(config.referralBaseUrl, code) }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Created", newData: toPublicAffiliate(affiliate) }); res.status(201).json({ success: true, data: toPublicAffiliate(affiliate) }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const old = await Affiliate.findById(req.params.id); if (!old) throw new AppError("Affiliate not found", 404); const update = sanitizeAffiliatePayload(req.body); delete update.password; delete update.passwordHash; const affiliate = await Affiliate.findByIdAndUpdate(old._id, { $set: update }, { new: true, runValidators: true }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: old._id, action: update.status ? `Affiliate ${update.status}` : "Affiliate Updated", oldData: toPublicAffiliate(old), newData: toPublicAffiliate(affiliate) }); res.json({ success: true, data: toPublicAffiliate(affiliate) }); }));
affiliateMarketingRouter.delete("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findById(req.params.id); if (!affiliate) throw new AppError("Affiliate not found", 404); const [referralCount, purchaseCount] = await Promise.all([AffiliateReferral.countDocuments({ affiliateId: affiliate._id }), AffiliatePurchase.countDocuments({ affiliateId: affiliate._id })]); if ((referralCount || purchaseCount) && req.query.force !== "true") throw new AppError("Affiliate has referral or purchase history. Pass force=true to delete and preserve historical rows as orphaned records.", 409); await Affiliate.deleteOne({ _id: affiliate._id }); await AffiliateNotification.deleteMany({ affiliateId: affiliate._id }); await AffiliateAdminNotification.deleteMany({ affiliateId: affiliate._id }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Deleted", oldData: toPublicAffiliate(affiliate) }); res.json({ success: true, message: "Affiliate deleted" }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/reset-password", asyncHandler(async (req, res) => { if (String(req.body?.password || "").length < 8) throw new AppError("Password must be at least 8 characters", 400); await Affiliate.findByIdAndUpdate(req.params.id, { passwordHash: hashPassword(req.body.password) }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: req.params.id, action: "Password Reset" }); res.json({ success: true, message: "Password reset" }); }));
affiliateMarketingRouter.get("/affiliate-marketing/referrals", asyncHandler(async (req, res) => { const { page, limit, skip } = pageValues(req.query); const filter = referralFilters(req.query); const [items, total] = await Promise.all([AffiliateReferral.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ clickAt: -1 }).skip(skip).limit(limit), AffiliateReferral.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/purchases", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const { page, limit, skip } = pageValues(req.query); const filter = purchaseFilters(req.query); const [items, total] = await Promise.all([AffiliatePurchase.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ purchaseAt: -1 }).skip(skip).limit(limit), AffiliatePurchase.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/purchases/:id/commission", asyncHandler(async (req, res) => { const status = String(req.body?.commissionStatus || "").trim().toUpperCase(); if (!["PENDING", "PAID"].includes(status)) throw new AppError("commissionStatus must be PENDING or PAID", 400); const update = { commissionStatus: status, ...(status === "PAID" ? { commissionPaidAt: new Date() } : { commissionPaidAt: null }) }; const purchase = await AffiliatePurchase.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }); if (!purchase) throw new AppError("Purchase not found", 404); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: purchase.affiliateId, action: `Commission ${status}` }); res.json({ success: true, data: purchase }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/notifications", asyncHandler(async (req, res) => { const affiliate = await Affiliate.findById(req.params.id); if (!affiliate) throw new AppError("Affiliate not found", 404); const title = String(req.body?.title || "").trim(); const message = String(req.body?.message || "").trim(); if (!title || !message) throw new AppError("Notification title and message are required", 400); const notification = await AffiliateNotification.create({ affiliateId: affiliate._id, notificationType: String(req.body?.notificationType || "ADMIN_MESSAGE").trim().toUpperCase(), title, message, reportData: req.body?.reportData || {}, emailStatus: "PENDING", appNotificationStatus: "SENT", sentByAdminId: actor(req), sentAt: new Date(), deliveredAt: new Date() }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Notification Sent", newData: notification.toJSON() }); res.status(201).json({ success: true, data: notification }); }));
affiliateMarketingRouter.get("/affiliate-marketing/notifications", asyncHandler(async (req, res) => { const { page, limit, skip } = pageValues(req.query); const filter = {}; if (req.query.status === "READ") filter.readAt = { $ne: null }; if (req.query.status === "UNREAD") filter.readAt = null; if (req.query.affiliateId) filter.affiliateId = req.query.affiliateId; const [items, total] = await Promise.all([AffiliateNotification.find(filter).populate("affiliateId", "affiliateName affiliateCode email").sort({ createdAt: -1 }).skip(skip).limit(limit), AffiliateNotification.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/admin-notifications", asyncHandler(async (req, res) => { await syncMilestoneNotifications(); const { page, limit, skip } = pageValues(req.query); const filter = {}; if (req.query.status) filter.status = String(req.query.status).trim().toUpperCase(); const [items, total, unread] = await Promise.all([AffiliateAdminNotification.find(filter).populate("affiliateId", "affiliateName affiliateCode email").sort({ createdAt: -1 }).skip(skip).limit(limit), AffiliateAdminNotification.countDocuments(filter), AffiliateAdminNotification.countDocuments({ status: "UNREAD" })]); res.json({ success: true, data: { items, total, unread, page, limit } }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/admin-notifications/:id/read", asyncHandler(async (req, res) => { const notification = await AffiliateAdminNotification.findByIdAndUpdate(req.params.id, { $set: { status: "READ", readAt: new Date() } }, { new: true }); if (!notification) throw new AppError("Notification not found", 404); res.json({ success: true, data: notification }); }));
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
