import path from "node:path";
import * as XLSX from "xlsx";
import { LearningLevel, Mode, User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { hashPasswordScrypt } from "../utils/password.js";

export const USER_PROFILE_COLUMNS = [
  "name", "email", "mobile", "password", "address", "country", "state", "district",
  "city", "userType", "profileImage", "examMode", "level",
];

const SAMPLE_USER = {
  name: "Sample Student", email: "student@example.com", mobile: "9876543210", password: "ChangeMe123!",
  address: "12 Example Street", country: "India", state: "Karnataka", district: "Bengaluru Urban",
  city: "Bengaluru", userType: "student", profileImage: "", examMode: "NEET", level: "Beginner",
};

function normalizedKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeRow(raw) {
  const cells = new Map(Object.entries(raw || {}).map(([key, value]) => [normalizedKey(key), value]));
  return Object.fromEntries(USER_PROFILE_COLUMNS.map((column) => [column, String(cells.get(normalizedKey(column)) ?? "").trim()]));
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "enabled", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "disabled", "off"].includes(normalized)) return false;
  return fallback;
}

function resolvePremiumExpiry(value, enabled) {
  if (!enabled) return undefined;
  if (String(value || "").trim()) {
    const configured = new Date(String(value));
    if (Number.isNaN(configured.getTime())) throw new AppError("Premium expiry date is invalid", 400);
    configured.setHours(23, 59, 59, 999);
    if (configured <= new Date()) throw new AppError("Premium expiry date must be in the future", 400);
    return configured;
  }
  const expiry = new Date();
  const originalDay = expiry.getDate();
  expiry.setDate(1);
  expiry.setMonth(expiry.getMonth() + 6);
  const daysInExpiryMonth = new Date(expiry.getFullYear(), expiry.getMonth() + 1, 0).getDate();
  expiry.setDate(Math.min(originalDay, daysInExpiryMonth));
  expiry.setHours(23, 59, 59, 999);
  return expiry;
}

function validateRow(row, modeKeys, levelKeys) {
  const reasons = [];
  if (row.name.length < 2 || row.name.length > 80) reasons.push("Name must contain 2-80 characters");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) reasons.push("A valid email is required");
  const mobile = row.mobile.replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(mobile)) reasons.push("A valid Indian 10-digit mobile is required");
  if (row.password.length < 8) reasons.push("Password must contain at least 8 characters");
  if (!row.country) reasons.push("Country is required");
  if (row.state.length < 2) reasons.push("State is required");
  if (row.district.length < 2) reasons.push("District is required");
  const examMode = [...modeKeys].find((key) => key.toLowerCase() === row.examMode.toLowerCase());
  const level = [...levelKeys].find((key) => key.toLowerCase() === row.level.toLowerCase());
  if (!examMode) reasons.push("Exam mode is missing or not configured");
  if (!level) reasons.push("Learning level is missing or not configured");
  if (row.profileImage && !/^(https?:\/\/|data:image\/)/i.test(row.profileImage)) reasons.push("Profile image must be an HTTP(S) URL or image data URL");
  return { reasons, mobile, examMode, level };
}

function parseFile(file) {
  if (!file?.buffer) throw new AppError("CSV or XLSX file is required", 400);
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (![".csv", ".xlsx", ".xls"].includes(extension)) throw new AppError("Upload a CSV or XLSX file", 400);
  const workbook = XLSX.read(file.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new AppError("The uploaded file does not contain a worksheet", 400);
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

export function createUserBulkTemplate(format = "xlsx") {
  const worksheet = XLSX.utils.json_to_sheet([SAMPLE_USER], { header: USER_PROFILE_COLUMNS });
  if (format === "csv") return { buffer: Buffer.from(XLSX.utils.sheet_to_csv(worksheet)), contentType: "text/csv; charset=utf-8", extension: "csv" };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
  return { buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
}

export async function importProfileUsers(file, options = {}) {
  const rawRows = parseFile(file);
  if (!rawRows.length) throw new AppError("The uploaded file has no user records", 400);
  if (rawRows.length > 5000) throw new AppError("A maximum of 5,000 users can be uploaded at once", 400);

  const [modes, levels] = await Promise.all([
    Mode.find({ active: { $ne: false } }).select("key").lean(),
    LearningLevel.find({ active: { $ne: false } }).select("key").lean(),
  ]);
  const modeKeys = new Set(modes.map((item) => String(item.key || "")).filter(Boolean));
  const levelKeys = new Set(levels.map((item) => String(item.key || "")).filter(Boolean));
  const onboardingComplete = parseBoolean(options.onboardingComplete, false);
  const isPremium = parseBoolean(options.isPremium, false);
  const isActive = parseBoolean(options.isActive, true);
  const premiumExpiresAt = resolvePremiumExpiry(options.premiumExpiresAt, isPremium);
  const failedRecords = [];
  const candidates = [];
  const seenEmails = new Set();
  const seenMobiles = new Set();

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const row = normalizeRow(raw);
    const validated = validateRow(row, modeKeys, levelKeys);
    const email = row.email.toLowerCase();
    if (seenEmails.has(email)) validated.reasons.push("Duplicate email in uploaded file");
    if (seenMobiles.has(validated.mobile)) validated.reasons.push("Duplicate mobile in uploaded file");
    if (email) seenEmails.add(email);
    if (validated.mobile) seenMobiles.add(validated.mobile);
    if (validated.reasons.length) {
      failedRecords.push({ row: rowNumber, name: row.name, email: row.email, mobile: row.mobile, reason: validated.reasons.join("; ") });
      return;
    }
    candidates.push({ rowNumber, row, email, ...validated });
  });

  const existing = candidates.length ? await User.find({ $or: [
    { email: { $in: candidates.map((item) => item.email) } },
    { mobile: { $in: candidates.map((item) => item.mobile) } },
  ] }).select("email mobile").lean() : [];
  const existingEmails = new Set(existing.map((item) => String(item.email || "").toLowerCase()).filter(Boolean));
  const existingMobiles = new Set(existing.map((item) => String(item.mobile || "")).filter(Boolean));
  const insertable = candidates.filter((item) => {
    const reasons = [];
    if (existingEmails.has(item.email)) reasons.push("Email already exists");
    if (existingMobiles.has(item.mobile)) reasons.push("Mobile already exists");
    if (reasons.length) failedRecords.push({ row: item.rowNumber, name: item.row.name, email: item.email, mobile: item.mobile, reason: reasons.join("; ") });
    return !reasons.length;
  });

  let insertedUsers = 0;
  for (let start = 0; start < insertable.length; start += 100) {
    const batch = insertable.slice(start, start + 100);
    const outcomes = await Promise.allSettled(batch.map((item) => User.create({
        name: item.row.name, email: item.email, mobile: item.mobile,
        passwordHash: hashPasswordScrypt(item.row.password), authTypes: ["email"], loginProvider: "EMAIL",
        address: item.row.address, country: item.row.country, state: item.row.state, district: item.row.district,
        city: item.row.city, userType: item.row.userType, profileImage: item.row.profileImage,
        examMode: item.examMode, level: item.level, onboardingComplete, isPremium, isActive,
        ...(premiumExpiresAt ? { premiumExpiresAt, premiumExpiry: premiumExpiresAt } : {}),
        isBlocked: false, emailVerified: false, mobileVerified: false,
        requiresProfileCompletion: false,
      })));
    outcomes.forEach((outcome, index) => {
      const item = batch[index];
      if (outcome.status === "fulfilled") {
        insertedUsers += 1;
        return;
      }
      const error = outcome.reason;
      failedRecords.push({ row: item.rowNumber, name: item.row.name, email: item.email, mobile: item.mobile, reason: error?.code === 11000 ? "Email or mobile already exists" : (error?.message || "Database insert failed") });
    });
  }

  failedRecords.sort((left, right) => left.row - right.row);
  return {
    totalRecords: rawRows.length,
    insertedUsers,
    failedUsers: failedRecords.length,
    failedRecords,
    appliedSettings: { onboardingComplete, isPremium, isActive, premiumExpiresAt: premiumExpiresAt || null },
  };
}
