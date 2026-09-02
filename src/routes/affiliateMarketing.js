import crypto from "node:crypto";
import { Router } from "express";
import { Affiliate, AffiliateAuditLog, AffiliatePurchase, AffiliateReferral, AffiliateSettings } from "../models/index.js";
import { requireAdmin, requireMainAdmin } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { hashPassword } from "../utils/password.js";

export const affiliateMarketingRouter = Router();
affiliateMarketingRouter.use(requireAdmin, requireMainAdmin);
const actor = (req) => req.admin?._id?.toString();
const DEFAULT_REFERRAL_BASE_URL = "https://affiliateapi.kritamcqs.com/affiliatelink";
const LEGACY_REFERRAL_BASE_URLS = new Set(["https://kritamcqs.com", "https://app.kritamcqs.com/affiliate"]);

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
  const limit = Math.min(500, Math.max(1, Number(query.limit || 100)));
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
  const [clicks, uniqueClicks, installs, existingAppUsers, registrations, existingUserLogins, premiumPurchases, pendingConversions, failedPurchases, result] = await Promise.all([
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
  ]);
  const successfulPurchases = Number(result[0]?.count || 0);
  const totalPurchaseAmount = Number(result[0]?.amount || 0);
  return { clicks, totalClicks: clicks, uniqueClicks: uniqueClicks.length, newAppInstallations: installs, existingAppUsers, registrations, existingUserLogins, premiumPurchases, successfulConversions: successfulPurchases, pendingConversions, failedOrCancelledPurchases: failedPurchases, successfulPurchases, totalPurchaseAmount, commissionEarned: Number(result[0]?.commission || 0), averagePurchaseValue: successfulPurchases ? totalPurchaseAmount / successfulPurchases : 0, conversionRate: clicks ? successfulPurchases / clicks * 100 : 0 };
}

affiliateMarketingRouter.get("/affiliate-marketing/dashboard", asyncHandler(async (req, res) => { const [totalAffiliates, activeAffiliates, performance] = await Promise.all([Affiliate.countDocuments(), Affiliate.countDocuments({ status: "ACTIVE" }), metrics(referralFilters(req.query))]); res.json({ success: true, data: { totalAffiliates, activeAffiliates, ...performance } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/affiliates", asyncHandler(async (_req, res) => { const items = await Affiliate.find().sort({ createdAt: -1 }); const stats = await Promise.all(items.map((item) => metrics({ affiliateId: item._id }))); res.json({ success: true, data: items.map((item, index) => ({ ...item.toJSON(), ...stats[index] })) }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates", asyncHandler(async (req, res) => { const body = req.body || {}; if (!body.email || !body.username || !body.password || !body.affiliateName) throw new AppError("Affiliate name, email, username and password are required", 400); if (String(body.password).length < 8) throw new AppError("Password must be at least 8 characters", 400); let code = String(body.affiliateCode || "").trim().toUpperCase(); if (code && !/^[A-Z0-9_-]{4,24}$/.test(code)) throw new AppError("Invalid affiliate code", 400); if (!code) { code = `AFF${String(await Affiliate.countDocuments() + 1).padStart(4, "0")}`; while (await Affiliate.exists({ affiliateCode: code })) code = `AFF${crypto.randomInt(1000, 999999)}`; } const config = await settings(); const affiliate = await Affiliate.create({ ...body, affiliateCode: code, passwordHash: hashPassword(body.password), referralLink: buildReferralLink(config.referralBaseUrl, code) }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: affiliate._id, action: "Affiliate Created", newData: affiliate.toJSON() }); res.status(201).json({ success: true, data: affiliate }); }));
affiliateMarketingRouter.patch("/affiliate-marketing/affiliates/:id", asyncHandler(async (req, res) => { const old = await Affiliate.findById(req.params.id); if (!old) throw new AppError("Affiliate not found", 404); const update = { ...req.body }; delete update.password; delete update.passwordHash; delete update.affiliateCode; delete update.referralLink; const affiliate = await Affiliate.findByIdAndUpdate(old._id, { $set: update }, { new: true, runValidators: true }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: old._id, action: update.status ? `Affiliate ${update.status}` : "Affiliate Updated", oldData: old.toJSON(), newData: affiliate.toJSON() }); res.json({ success: true, data: affiliate }); }));
affiliateMarketingRouter.post("/affiliate-marketing/affiliates/:id/reset-password", asyncHandler(async (req, res) => { if (String(req.body?.password || "").length < 8) throw new AppError("Password must be at least 8 characters", 400); await Affiliate.findByIdAndUpdate(req.params.id, { passwordHash: hashPassword(req.body.password) }); await AffiliateAuditLog.create({ adminId: actor(req), affiliateId: req.params.id, action: "Password Reset" }); res.json({ success: true, message: "Password reset" }); }));
affiliateMarketingRouter.get("/affiliate-marketing/referrals", asyncHandler(async (req, res) => { const { page, limit, skip } = pageValues(req.query); const filter = referralFilters(req.query); const [items, total] = await Promise.all([AffiliateReferral.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ clickAt: -1 }).skip(skip).limit(limit), AffiliateReferral.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/purchases", asyncHandler(async (req, res) => { const { page, limit, skip } = pageValues(req.query); const filter = purchaseFilters(req.query); const [items, total] = await Promise.all([AffiliatePurchase.find(filter).populate("affiliateId", "affiliateName affiliateCode").sort({ purchaseAt: -1 }).skip(skip).limit(limit), AffiliatePurchase.countDocuments(filter)]); res.json({ success: true, data: { items, total, page, limit } }); }));
affiliateMarketingRouter.get("/affiliate-marketing/settings", asyncHandler(async (_req, res) => res.json({ success: true, data: await settings() })));
affiliateMarketingRouter.patch("/affiliate-marketing/settings", asyncHandler(async (req, res) => {
  const old = await settings();
  const update = { ...req.body };
  delete update.key;
  if (update.referralBaseUrl !== undefined) update.referralBaseUrl = normalizeReferralBaseUrl(update.referralBaseUrl);
  const value = await AffiliateSettings.findOneAndUpdate({ key: "default" }, { $set: update }, { new: true, runValidators: true });
  if (update.referralBaseUrl !== undefined && update.referralBaseUrl !== old.referralBaseUrl) {
    await updateAllAffiliateLinks(value.referralBaseUrl);
  }
  await AffiliateAuditLog.create({ adminId: actor(req), action: "Affiliate Settings Changed", oldData: old, newData: value });
  res.json({ success: true, data: value });
}));
affiliateMarketingRouter.get("/affiliate-marketing/audit-logs", asyncHandler(async (_req, res) => res.json({ success: true, data: await AffiliateAuditLog.find().sort({ createdAt: -1 }).limit(1000) })));
