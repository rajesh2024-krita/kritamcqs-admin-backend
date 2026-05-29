import path from "node:path";
import * as XLSX from "xlsx";
import { MigrationLog, User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { hashPassword } from "../utils/password.js";

const OLD_USER_COLUMNS = {
  name: ["name", "user_name", "fullname", "full_name"],
  mobile: ["mobile", "mobile_number", "phone", "phone_number", "contact", "contact_number"],
  email: ["email", "email_id", "mail"],
  password: ["password", "pass", "pwd", "user_password", "password_hash", "passwordhash"],
  role: ["role", "user_role"],
  planId: ["planid", "plan_id", "plan"],
  createdDateTime: ["createddatetime", "created_date_time", "created_at", "createddate", "created_date"],
};

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getCell(row, keys) {
  const normalizedRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  for (const key of keys) {
    const value = normalizedRow[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function cleanMigrationMobile(input) {
  const raw = String(input ?? "").trim();
  if (!raw || /^(na|n\/a|null|undefined|none)$/i.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  const mobile = digits.slice(-10);
  const invalidValues = new Set([
    "0000000000",
    "1111111111",
    "2222222222",
    "3333333333",
    "4444444444",
    "5555555555",
    "6666666666",
    "7777777777",
    "8888888888",
    "9999999999",
    "1234567890",
  ]);
  if (!mobile || mobile.length < 10 || invalidValues.has(mobile)) return null;
  if (!/^[6-9]\d{9}$/.test(mobile)) return null;
  return mobile;
}

function normalizeMigrationEmail(input) {
  const email = String(input ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : undefined;
}

function parseMigrationDate(input) {
  const parsed = new Date(String(input ?? "").trim());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeImportedPassword(input) {
  const password = String(input ?? "");
  if (!password.trim()) return null;
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(password)) return password;
  if (/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(password)) return password;
  return hashPassword(password);
}

function parseMigrationTimestamp(input) {
  const parsed = new Date(String(input ?? "").trim());
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizeSqlValue(value) {
  const trimmed = String(value ?? "").trim();
  if (/^null$/i.test(trimmed)) return "";
  const quote = trimmed[0];
  if ((quote === "'" || quote === "\"") && trimmed.endsWith(quote)) {
    return trimmed
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\"/g, "\"")
      .replace(/''/g, "'")
      .replace(/""/g, "\"")
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function splitDelimitedRow(row, delimiter = ",") {
  const values = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    const next = row[index + 1];
    if (char === "\\" && quote && next !== undefined) {
      current += char + next;
      index += 1;
      continue;
    }
    if ((char === "'" || char === "\"") && (!quote || quote === char)) {
      if (quote === char && next === char) {
        current += char;
        index += 1;
      } else {
        quote = quote ? null : char;
      }
      continue;
    }
    if (char === delimiter && !quote) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function splitDelimitedRecords(text) {
  const records = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\\" && quote && next !== undefined) {
      current += char + next;
      index += 1;
      continue;
    }
    if ((char === "'" || char === "\"") && (!quote || quote === char)) {
      if (quote === char && next === char) {
        current += char;
        index += 1;
      } else {
        quote = quote ? null : char;
      }
      continue;
    }
    if ((char === "\n" || char === "\r") && !quote) {
      if (current.trim()) records.push(current);
      current = "";
      if (char === "\r" && next === "\n") index += 1;
      continue;
    }
    current += char;
  }

  if (current.trim()) records.push(current);
  return records;
}

function parseCsvBuffer(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const records = splitDelimitedRecords(text);
  if (records.length < 2) return [];
  const headers = splitDelimitedRow(records[0]).map((header) => normalizeHeader(normalizeSqlValue(header)));
  return records.slice(1).map((line) => {
    const values = splitDelimitedRow(line).map(normalizeSqlValue);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function extractSqlTuples(valuesText) {
  const tuples = [];
  let current = "";
  let quote = null;
  let depth = 0;

  for (let index = 0; index < valuesText.length; index += 1) {
    const char = valuesText[index];
    const next = valuesText[index + 1];
    if (char === "\\" && quote && next !== undefined) {
      if (depth > 0) current += char + next;
      index += 1;
      continue;
    }
    if ((char === "'" || char === "\"") && (!quote || quote === char)) {
      if (quote === char && next === char) {
        if (depth > 0) current += char;
        index += 1;
      } else {
        quote = quote ? null : char;
        if (depth > 0) current += char;
      }
      continue;
    }
    if (char === "(" && !quote) {
      if (depth === 0) current = "";
      else current += char;
      depth += 1;
      continue;
    }
    if (char === ")" && !quote) {
      depth -= 1;
      if (depth === 0) {
        tuples.push(current);
        current = "";
      } else if (depth > 0) {
        current += char;
      }
      continue;
    }
    if (depth > 0) current += char;
  }

  return tuples;
}

function parseSqlBuffer(buffer) {
  const text = buffer.toString("utf8");
  const rows = [];
  const insertRegex = /insert\s+into\s+`?(?:user|users)`?\s*\(([^)]+)\)\s*values\s*([\s\S]*?);/gi;
  let match;

  while ((match = insertRegex.exec(text))) {
    const columns = match[1].split(",").map((column) => normalizeHeader(column.trim().replace(/[`"']/g, "")));
    for (const tuple of extractSqlTuples(match[2])) {
      const values = splitDelimitedRow(tuple).map(normalizeSqlValue);
      rows.push(columns.reduce((row, column, index) => {
        row[column] = values[index] ?? "";
        return row;
      }, {}));
    }
  }

  return rows;
}

function parseSheetBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new AppError("Spreadsheet must contain at least one sheet", 400);
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
  return rawRows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])),
  );
}

function parseMigrationFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") return parseSheetBuffer(file.buffer);
  if (ext === ".csv") return parseCsvBuffer(file.buffer);
  if (ext === ".sql") return parseSqlBuffer(file.buffer);
  throw new AppError("Upload a .sql, .csv, or .xlsx file", 400);
}

async function prepareMigrationUsers(rows) {
  const validRows = [];
  const invalidRows = [];
  let sourceDuplicateCount = 0;

  rows.forEach((row, index) => {
    const rawMobileValue = getCell(row, OLD_USER_COLUMNS.mobile);
    const rawEmailValue = getCell(row, OLD_USER_COLUMNS.email);
    const rawPasswordValue = getCell(row, OLD_USER_COLUMNS.password);
    const mobile = cleanMigrationMobile(rawMobileValue);
    const email = normalizeMigrationEmail(rawEmailValue);
    const passwordHash = normalizeImportedPassword(rawPasswordValue);

    if (!email) {
      invalidRows.push({
        row: index + 2,
        reason: "Valid email address is required",
        name: getCell(row, OLD_USER_COLUMNS.name),
        mobile: rawMobileValue,
        email: rawEmailValue,
      });
      return;
    }

    if (!passwordHash) {
      invalidRows.push({
        row: index + 2,
        reason: "Password is required for email login",
        name: getCell(row, OLD_USER_COLUMNS.name),
        mobile: rawMobileValue,
        email: rawEmailValue,
      });
      return;
    }

    validRows.push({
      row,
      mobile,
      email,
      passwordHash,
      sourceIndex: index,
      createdTimestamp: parseMigrationTimestamp(getCell(row, OLD_USER_COLUMNS.createdDateTime)),
    });
  });

  const usedMobiles = new Set();
  const usedEmails = new Set();
  const selectedRows = [];
  validRows
    .sort((left, right) => right.createdTimestamp - left.createdTimestamp || right.sourceIndex - left.sourceIndex)
    .forEach((item) => {
      if (usedEmails.has(item.email) || (item.mobile && usedMobiles.has(item.mobile))) {
        sourceDuplicateCount += 1;
        return;
      }
      usedEmails.add(item.email);
      if (item.mobile) usedMobiles.add(item.mobile);
      selectedRows.push(item);
    });

  const prepared = selectedRows.map((item) => {
    const row = item.row;
    const createdAt = parseMigrationDate(getCell(row, OLD_USER_COLUMNS.createdDateTime));
    return {
      source: row,
      sourceIndex: item.sourceIndex,
      normalized: {
        name: String(getCell(row, OLD_USER_COLUMNS.name) ?? "").trim() || undefined,
        ...(item.mobile ? { mobile: item.mobile, mobileVerified: true } : { mobileVerified: false }),
        email: item.email,
        passwordHash: item.passwordHash,
        authTypes: ["email"],
        examMode: "BOTH",
        level: "Beginner",
        onboardingComplete: true,
        emailVerified: true,
        isPremium: Number(getCell(row, OLD_USER_COLUMNS.planId) ?? 0) > 1,
        isAdmin: String(getCell(row, OLD_USER_COLUMNS.role) ?? "").trim().toLowerCase() === "admin",
        migratedFromOldApp: true,
        createdAt,
        updatedAt: new Date(),
      },
    };
  });

  const mobiles = [...new Set(prepared.map((item) => item.normalized.mobile).filter(Boolean))];
  const emails = [...new Set(prepared.map((item) => item.normalized.email).filter(Boolean))];
  const duplicateFilters = [
    ...(mobiles.length ? [{ mobile: { $in: mobiles } }] : []),
    ...(emails.length ? [{ email: { $in: emails } }] : []),
  ];
  const existingUsers = duplicateFilters.length ? await User.find({ $or: duplicateFilters }).select("mobile email") : [];
  const existingMobiles = new Set(existingUsers.map((user) => String(user.mobile || "")).filter(Boolean));
  const existingEmails = new Set(existingUsers.map((user) => String(user.email ?? "").toLowerCase()).filter(Boolean));
  const importable = prepared.filter((item) => !existingEmails.has(item.normalized.email) && (!item.normalized.mobile || !existingMobiles.has(item.normalized.mobile)));
  const existingDuplicateCount = prepared.length - importable.length;

  return {
    totalUsers: rows.length,
    prepared,
    importable,
    invalidRows,
    invalidUsers: invalidRows.length,
    duplicateUsers: sourceDuplicateCount + existingDuplicateCount,
    sourceDuplicateCount,
    existingDuplicateCount,
  };
}

export const oldUserMigrationService = {
  async preview(file) {
    if (!file?.buffer) throw new AppError("Migration file is required", 400);
    const summary = await prepareMigrationUsers(parseMigrationFile(file));
    return {
      totalUsers: summary.totalUsers,
      importableUsers: summary.importable.length,
      duplicateUsers: summary.duplicateUsers,
      invalidUsers: summary.invalidUsers,
      sourceDuplicateUsers: summary.sourceDuplicateCount,
      existingDuplicateUsers: summary.existingDuplicateCount,
      previewRows: summary.importable.slice(0, 12).map((item) => ({
        name: item.normalized.name,
        mobile: item.normalized.mobile,
        email: item.normalized.email,
        isPremium: item.normalized.isPremium,
        isAdmin: item.normalized.isAdmin,
        createdAt: item.normalized.createdAt,
      })),
      invalidRows: summary.invalidRows.slice(0, 25),
    };
  },

  async import(file) {
    if (!file?.buffer) throw new AppError("Migration file is required", 400);
    const summary = await prepareMigrationUsers(parseMigrationFile(file));
    const docs = summary.importable.map((item) => item.normalized);
    let inserted = [];
    const failedRows = [];

    if (docs.length) {
      try {
        inserted = await User.insertMany(docs, { ordered: false });
      } catch (error) {
        inserted = Array.isArray(error?.insertedDocs) ? error.insertedDocs : [];
        const writeErrors = error?.writeErrors || error?.result?.result?.writeErrors || [];
        writeErrors.forEach((writeError) => {
          const sourceItem = summary.importable[Number(writeError.index)];
          failedRows.push({
            row: Number(sourceItem?.sourceIndex ?? writeError.index ?? 0) + 2,
            name: sourceItem?.normalized?.name || "",
            mobile: sourceItem?.normalized?.mobile || "",
            email: sourceItem?.normalized?.email || "",
            reason: writeError.errmsg || writeError.message || "MongoDB insert failed",
          });
        });

        if (!inserted.length && !failedRows.length) {
          throw error;
        }
      }
    }

    const log = await MigrationLog.create({
      totalUsers: summary.totalUsers,
      importedUsers: inserted.length,
      duplicateUsers: summary.duplicateUsers,
      invalidUsers: summary.invalidUsers + failedRows.length,
      failedRows: [...summary.invalidRows.slice(0, 100), ...failedRows.slice(0, 100)].slice(0, 100),
      migrationDate: new Date(),
    });

    return {
      totalUsers: summary.totalUsers,
      importedUsers: inserted.length,
      duplicateUsers: summary.duplicateUsers,
      invalidUsers: summary.invalidUsers + failedRows.length,
      invalidRows: [...summary.invalidRows, ...failedRows].slice(0, 25),
      failedRows: failedRows.slice(0, 25),
      migrationDate: log.migrationDate,
      logId: String(log._id),
    };
  },

  async logs() {
    const logs = await MigrationLog.find().sort({ migrationDate: -1 }).limit(20);
    return logs.map((log) => {
      const raw = log.toJSON ? log.toJSON() : log;
      return {
        id: String(raw.id ?? raw._id),
        totalUsers: raw.totalUsers,
        importedUsers: raw.importedUsers,
        duplicateUsers: raw.duplicateUsers,
        invalidUsers: raw.invalidUsers,
        failedRows: raw.failedRows || [],
        migrationDate: raw.migrationDate,
      };
    });
  },
};
