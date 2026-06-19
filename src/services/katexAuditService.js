import mongoose from "mongoose";
import * as XLSX from "xlsx";
import {
  AdminActivityLog,
  AIQuestionAuditFinding,
  Chapter,
  Question,
  QuestionKatexAuditResult,
  QuestionType,
  Subject,
  Topic,
  User,
} from "../models/index.js";
import { AppError } from "../utils/AppError.js";

const AUDIT_FIELDS = ["question", "optionA", "optionB", "optionC", "optionD", "explanation"];
const SCAN_VERSION = "katex-audit-v1";
const BATCH_LIMIT = 500;

function normalizeText(value) {
  return String(value ?? "").replace(/\u00A0/g, " ").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactPreview(question = {}) {
  return normalizeText(question.question || question.questionImageUrl || "[Image Question]").slice(0, 260);
}

function hasUnbalancedDelimiters(value) {
  const text = normalizeText(value);
  const dollarCount = (text.match(/\$/g) || []).length;
  return dollarCount % 2 !== 0 || (text.match(/\\\(/g) || []).length !== (text.match(/\\\)/g) || []).length || (text.match(/\\\[/g) || []).length !== (text.match(/\\\]/g) || []).length;
}

function hasUnbalancedBraces(value) {
  let depth = 0;
  for (const char of normalizeText(value)) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

function issue(field, type, severity, message, snippet = "", suggestion = "") {
  return { field, type, severity, message, snippet: normalizeText(snippet).slice(0, 160), suggestion };
}

function detectIssues(field, value) {
  const text = normalizeText(value);
  if (!text) return [];
  const issues = [];

  if (hasUnbalancedDelimiters(text)) issues.push(issue(field, "INVALID_KATEX", "error", "Unbalanced KaTeX math delimiters", text));
  if (hasUnbalancedBraces(text)) issues.push(issue(field, "INVALID_KATEX", "error", "Unbalanced braces in math expression", text));
  if (/\\(?:frac|sqrt|begin|end|int|sum|log|sin|cos|tan)(?![A-Za-z])/.test(text) && !/[\\$]/.test(text.replace(/\\(?:frac|sqrt|begin|end|int|sum|log|sin|cos|tan)/g, ""))) {
    issues.push(issue(field, "BARE_KATEX", "warning", "KaTeX command appears outside an explicit math expression", text));
  }
  if (/\b(?:[A-Z][a-z]?\d+){2,}(?:\.\d*[A-Z][a-z]?\d*)?\b/.test(text) && !/\\ce\{|_/.test(text)) {
    issues.push(issue(field, "CHEMICAL_FORMULA", "warning", "Chemical formula may need subscripts or mhchem formatting", text, "Use subscripts or \\ce{...}"));
  }
  if (/\b[A-Z][a-z]?\d{1,2}[+-](?=\s|$|[),.;:])|\b[A-Z][a-z]?[+-](?=\s|$|[),.;:])/.test(text) && !/\^\{?\d*[+-]\}?/.test(text)) {
    issues.push(issue(field, "IONIC_CHARGE", "warning", "Ionic charge may need superscript formatting", text, "Use Fe^{3+} style charge notation"));
  }
  if (/\b\d+\s*-\s*\d+\b/.test(text) && /\b10\s*-\s*\d+\b/.test(text)) {
    issues.push(issue(field, "SCIENTIFIC_NOTATION", "warning", "Scientific notation exponent may be missing superscript braces", text, "Use 10^{-7}"));
  }
  if (/\b[a-zA-Z]\d\b/.test(text) && !/[A-Z][a-z]?\d/.test(text)) {
    issues.push(issue(field, "MISSING_SUPERSCRIPT", "warning", "Variable exponent may be missing superscript formatting", text, "Use x^2 or x^{2}"));
  }
  if (/\b[a-zA-Z]\(\d+\)\s*\/\s*\([^)]+\)|\b\d+\s*\/\s*\d+\b/.test(text) && !/\\frac/.test(text)) {
    issues.push(issue(field, "FRACTION_FORMAT", "warning", "Fraction may need \\frac{...}{...} formatting", text));
  }
  if (/\bmatrix\b|\[\s*[-\dA-Za-z]+\s+[-\dA-Za-z]+[;\n]\s*[-\dA-Za-z]+\s+[-\dA-Za-z]+\s*\]/i.test(text)) {
    if (!/\\begin\{(?:matrix|pmatrix|bmatrix|vmatrix)\}/.test(text)) issues.push(issue(field, "MATRIX_FORMAT", "warning", "Matrix-like expression may need a KaTeX matrix environment", text));
  }
  if (/\bint(?:egral)?\b|∫/.test(text)) {
    if (!/\\int/.test(text)) issues.push(issue(field, "INTEGRAL_FORMAT", "warning", "Integral expression may need \\int formatting", text));
  }
  if (/\b(sin|cos|tan|cot|sec|cosec)\s*[A-Za-z0-9(]/i.test(text) && !/\\(?:sin|cos|tan|cot|sec|cosec)/.test(text)) {
    issues.push(issue(field, "TRIG_FORMAT", "warning", "Trigonometric function may need KaTeX command formatting", text));
  }
  if (/\b[A-Za-z]+\s*\|\s*[A-Za-z0-9+,-]+\s*\|\|/.test(text) || /\b[A-Z][a-z]?\|[A-Z][a-z]?\b/.test(text)) {
    issues.push(issue(field, "CELL_NOTATION", "warning", "Electrochemical cell notation may need spacing or charge formatting", text));
  }
  if (/[{}()[\]]{3,}|[Il1]\s*[=~]\s*[Il1]|[O0]\s*[=~]\s*[O0]|rn|vv/.test(text)) {
    issues.push(issue(field, "OCR_FORMULA", "warning", "Possible OCR-related formula artifact detected", text));
  }
  if (/[\uFFFD]|(?:â|Î|Ï|Ã)[\w\u0080-\uFFFF]?/.test(text)) {
    issues.push(issue(field, "UNICODE_SYMBOL", "warning", "Possible broken Unicode or OCR symbol detected", text));
  }
  if (/<[^>]*$/.test(text) || /<\/?(?:p|div|span|sub|sup|strong|em)\b[^>]*>/i.test(text) && (text.match(/</g) || []).length !== (text.match(/>/g) || []).length) {
    issues.push(issue(field, "BROKEN_HTML", "warning", "Possible broken HTML markup detected", text));
  }

  return issues;
}

function detectQuestionIssues(question = {}) {
  const issues = AUDIT_FIELDS.flatMap((field) => detectIssues(field, question[field]));
  if (!normalizeText(question.question) && !normalizeText(question.questionImageUrl)) {
    issues.push(issue("question", "EMPTY_FIELD", "error", "Question text or image is missing"));
  }
  ["optionA", "optionB", "optionC", "optionD"].forEach((field) => {
    if (!normalizeText(question[field])) issues.push(issue(field, "EMPTY_FIELD", "error", `${field} is missing`));
  });
  const optionMap = new Map();
  ["optionA", "optionB", "optionC", "optionD"].forEach((field) => {
    const value = normalizeText(question[field]).replace(/\s+/g, " ").toLowerCase();
    if (!value) return;
    if (optionMap.has(value)) {
      issues.push(issue(field, "DUPLICATE_OPTION", "warning", `${field} duplicates ${optionMap.get(value)}`, question[field]));
    } else {
      optionMap.set(value, field);
    }
  });
  return issues;
}

function formatChemicalFormula(value) {
  const formatSingleFormula = (formula) => formula.replace(/([A-Z][a-z]?)(\d+)/g, "$1_{$2}");
  let next = value;
  next = next.replace(/\b((?:[A-Z][a-z]?\d*){2,})\.(\d*)((?:[A-Z][a-z]?\d*){2,})\b/g, (_match, left, coefficient, right) =>
    `${formatSingleFormula(left)}\\cdot${coefficient || ""}${formatSingleFormula(right)}`,
  );
  next = next.replace(/\b((?:[A-Z][a-z]?\d*){2,})\b/g, (match) =>
    formatSingleFormula(match),
  );
  return next;
}

function autoFixText(value) {
  let next = normalizeText(value);
  if (!next) return next;
  next = next.replace(/\b([A-Z][a-z]?)(\d{1,2})([+-])(?=\s|$|[),.;:])/g, "$1^{$2$3}");
  next = next.replace(/\b10\s*-\s*(\d+)\b/g, "10^{-$1}");
  next = next.replace(/\b([A-Z])(\d+)\b/g, "$1_{$2}");
  next = next.replace(/\b([a-z])([23])\b/g, (match, variable, exponent, offset, source) => {
    const before = source[offset - 1] || "";
    const after = source[offset + match.length] || "";
    if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) return match;
    return `${variable}^${exponent}`;
  });
  next = next.replace(/\b(sin|cos|tan|cot|sec)\s+([A-Za-z0-9(])/gi, (_, fn, tail) => `\\${fn.toLowerCase()} ${tail}`);
  next = next.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, "\\frac{$1}{$2}");
  next = formatChemicalFormula(next);
  return next;
}

function buildFixedFields(question = {}) {
  return AUDIT_FIELDS.reduce((fields, field) => {
    const before = normalizeText(question[field]);
    const after = autoFixText(before);
    if (before && after && before !== after) fields[field] = after;
    return fields;
  }, {});
}

export function auditQuestion(question = {}) {
  const issues = detectQuestionIssues(question);
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity !== "error").length;
  const confidence = Math.max(0, Math.min(100, 100 - errorCount * 28 - warningCount * 9));
  const status = issues.length ? "KATEX_ISSUE" : "PASS";
  const fixedFields = buildFixedFields(question);
  return {
    questionId: question._id,
    subjectId: question.subjectId,
    chapterId: question.chapterId,
    topicId: question.topicId,
    questionTypeId: question.questionTypeId,
    status,
    confidence,
    errorCount,
    warningCount,
    issueCount: issues.length,
    preview: compactPreview(question),
    issues,
    fixedFields,
    autoFixAvailable: Object.keys(fixedFields).length > 0,
    lastScannedAt: new Date(),
    scanVersion: SCAN_VERSION,
  };
}

async function upsertAuditResult(question) {
  const audit = auditQuestion(question);
  await QuestionKatexAuditResult.findOneAndUpdate(
    { questionId: question._id },
    { $set: audit, $setOnInsert: { reviewed: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return audit;
}

function buildQuestionFilter(params = {}) {
  const filter = {};
  if (mongoose.isValidObjectId(params.subjectId)) filter.subjectId = params.subjectId;
  if (mongoose.isValidObjectId(params.chapterId)) filter.chapterId = params.chapterId;
  if (mongoose.isValidObjectId(params.topicId)) filter.topicId = params.topicId;
  if (mongoose.isValidObjectId(params.questionTypeId)) filter.questionTypeId = params.questionTypeId;
  return filter;
}

async function buildQuestionListFilter(params = {}) {
  const filter = buildQuestionFilter(params);
  const search = normalizeText(params.search || params.q);
  if (!search) return filter;
  const regex = new RegExp(escapeRegex(search), "i");
  const [subjects, chapters, topics, questionTypes] = await Promise.all([
    Subject.find({ name: regex }).select("_id").lean(),
    Chapter.find({ name: regex }).select("_id").lean(),
    Topic.find({ name: regex }).select("_id").lean(),
    QuestionType.find({ $or: [{ name: regex }, { label: regex }, { key: regex }] }).select("_id").lean(),
  ]);
  const searchOr = [
    { question: regex },
    { explanation: regex },
    { optionA: regex },
    { optionB: regex },
    { optionC: regex },
    { optionD: regex },
  ];
  if (mongoose.isValidObjectId(search)) searchOr.push({ _id: search });
  if (subjects.length) searchOr.push({ subjectId: { $in: subjects.map((item) => item._id) } });
  if (chapters.length) searchOr.push({ chapterId: { $in: chapters.map((item) => item._id) } });
  if (topics.length) searchOr.push({ topicId: { $in: topics.map((item) => item._id) } });
  if (questionTypes.length) searchOr.push({ questionTypeId: { $in: questionTypes.map((item) => item._id) } });
  filter.$or = searchOr;
  return filter;
}

function buildAuditFilter(params = {}) {
  const filter = {};
  if (mongoose.isValidObjectId(params.subjectId)) filter.subjectId = params.subjectId;
  if (mongoose.isValidObjectId(params.chapterId)) filter.chapterId = params.chapterId;
  if (mongoose.isValidObjectId(params.topicId)) filter.topicId = params.topicId;
  if (mongoose.isValidObjectId(params.questionTypeId)) filter.questionTypeId = params.questionTypeId;
  if (["PASS", "KATEX_ISSUE", "WARNING", "FAILED"].includes(String(params.status || "").toUpperCase())) filter.status = String(params.status).toUpperCase();
  if (String(params.reviewed || "") === "true") filter.reviewed = true;
  if (String(params.reviewed || "") === "false") filter.reviewed = false;
  return filter;
}

async function decorateRows(rows) {
  const [subjects, chapters, topics, questionTypes] = await Promise.all([
    Subject.find({ _id: { $in: rows.map((row) => row.subjectId).filter(Boolean) } }).lean(),
    Chapter.find({ _id: { $in: rows.map((row) => row.chapterId).filter(Boolean) } }).lean(),
    Topic.find({ _id: { $in: rows.map((row) => row.topicId).filter(Boolean) } }).lean(),
    QuestionType.find({ _id: { $in: rows.map((row) => row.questionTypeId).filter(Boolean) } }).lean(),
  ]);
  const maps = {
    subject: new Map(subjects.map((item) => [String(item._id), item.name])),
    chapter: new Map(chapters.map((item) => [String(item._id), item.name])),
    topic: new Map(topics.map((item) => [String(item._id), item.name])),
    questionType: new Map(questionTypes.map((item) => [String(item._id), item.name || item.label || item.key])),
  };
  return rows.map((row) => ({
    id: String(row._id),
    questionId: String(row.questionId),
    subjectId: row.subjectId ? String(row.subjectId) : "",
    chapterId: row.chapterId ? String(row.chapterId) : "",
    topicId: row.topicId ? String(row.topicId) : "",
    questionTypeId: row.questionTypeId ? String(row.questionTypeId) : "",
    subject: maps.subject.get(String(row.subjectId)) || "-",
    chapter: maps.chapter.get(String(row.chapterId)) || "-",
    topic: maps.topic.get(String(row.topicId)) || "-",
    questionType: maps.questionType.get(String(row.questionTypeId)) || "-",
    status: row.status,
    confidence: row.confidence,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    issueCount: row.issueCount,
    reviewed: Boolean(row.reviewed),
    preview: row.preview,
    issues: row.issues || [],
    autoFixAvailable: Boolean(row.autoFixAvailable),
    fixedFields: row.fixedFields || {},
    lastScannedAt: row.lastScannedAt,
  }));
}

async function decorateQuestions(rows) {
  const [subjects, chapters, topics, questionTypes, audits] = await Promise.all([
    Subject.find({ _id: { $in: rows.map((row) => row.subjectId).filter(Boolean) } }).lean(),
    Chapter.find({ _id: { $in: rows.map((row) => row.chapterId).filter(Boolean) } }).lean(),
    Topic.find({ _id: { $in: rows.map((row) => row.topicId).filter(Boolean) } }).lean(),
    QuestionType.find({ _id: { $in: rows.map((row) => row.questionTypeId).filter(Boolean) } }).lean(),
    QuestionKatexAuditResult.find({ questionId: { $in: rows.map((row) => row._id) } }).lean(),
  ]);
  const maps = {
    subject: new Map(subjects.map((item) => [String(item._id), item.name])),
    chapter: new Map(chapters.map((item) => [String(item._id), item.name])),
    topic: new Map(topics.map((item) => [String(item._id), item.name])),
    questionType: new Map(questionTypes.map((item) => [String(item._id), item.name || item.label || item.key])),
    audit: new Map(audits.map((item) => [String(item.questionId), item])),
  };
  return rows.map((row) => {
    const audit = maps.audit.get(String(row._id));
    return {
      id: String(row._id),
      questionId: String(row._id),
      subjectId: row.subjectId ? String(row.subjectId) : "",
      chapterId: row.chapterId ? String(row.chapterId) : "",
      topicId: row.topicId ? String(row.topicId) : "",
      questionTypeId: row.questionTypeId ? String(row.questionTypeId) : "",
      subject: maps.subject.get(String(row.subjectId)) || "-",
      chapter: maps.chapter.get(String(row.chapterId)) || "-",
      topic: maps.topic.get(String(row.topicId)) || "-",
      questionType: maps.questionType.get(String(row.questionTypeId)) || "-",
      status: audit?.status || "PENDING",
      preview: compactPreview(row),
    };
  });
}

async function scanQuestions(filter = {}, { limit = BATCH_LIMIT } = {}) {
  const cursor = Question.find(filter).sort({ _id: 1 }).limit(Math.max(1, Math.min(Number(limit || BATCH_LIMIT), BATCH_LIMIT))).lean().cursor();
  let processed = 0;
  let passed = 0;
  let katexIssue = 0;
  for await (const question of cursor) {
    const audit = await upsertAuditResult(question);
    processed += 1;
    if (audit.status === "PASS") passed += 1;
    if (audit.status === "KATEX_ISSUE") katexIssue += 1;
  }
  return { processed, passed, katexIssue, warning: katexIssue, failed: 0 };
}

async function summary(filter = {}) {
  const [totalQuestions, passed, katexIssue, legacyWarning, legacyFailed, needReview] = await Promise.all([
    Question.countDocuments(buildQuestionFilter(filter)),
    QuestionKatexAuditResult.countDocuments({ ...buildAuditFilter(filter), status: "PASS" }),
    QuestionKatexAuditResult.countDocuments({ ...buildAuditFilter(filter), status: "KATEX_ISSUE" }),
    QuestionKatexAuditResult.countDocuments({ ...buildAuditFilter(filter), status: "WARNING" }),
    QuestionKatexAuditResult.countDocuments({ ...buildAuditFilter(filter), status: "FAILED" }),
    QuestionKatexAuditResult.countDocuments({ ...buildAuditFilter(filter), reviewed: false, status: { $in: ["KATEX_ISSUE", "WARNING", "FAILED"] } }),
  ]);
  return { totalQuestions, passed, katexIssue, warning: legacyWarning, failed: legacyFailed, needReview };
}

async function logAuditFix(question, previous, admin, action) {
  const actor = admin?._id ? await User.findById(admin._id).select("name email").lean().catch(() => null) : null;
  await AdminActivityLog.create({
    employeeId: admin?._id || undefined,
    employeeName: actor?.name || admin?.name || "Administrator",
    employeeEmail: actor?.email || admin?.email || "",
    action,
    questionId: question._id,
    previousValue: previous,
    updatedValue: AUDIT_FIELDS.reduce((value, field) => ({ ...value, [field]: question[field] }), {}),
  }).catch(() => null);
}

async function autoFixOne(questionId, admin) {
  if (!mongoose.isValidObjectId(questionId)) throw new AppError("Invalid question id", 400);
  const question = await Question.findById(questionId);
  if (!question) throw new AppError("Question not found", 404);
  const fixedFields = buildFixedFields(question);
  if (!Object.keys(fixedFields).length) {
    await upsertAuditResult(question.toObject());
    return { questionId, updated: false, drafted: 0, fixedFields: {} };
  }
  const audit = await upsertAuditResult(question.toObject());
  const findings = Object.entries(fixedFields).map(([field, newValue]) => ({
    questionId: question._id,
    provider: "rule-engine",
    model: SCAN_VERSION,
    auditStatus: "KATEX_ISSUE",
    confidence: audit.confidence,
    issueType: "katex",
    severity: "medium",
    description: "Rule engine formatting suggestion. Review and approve before applying.",
    field,
    oldValue: String(question[field] ?? ""),
    suggestedValue: String(newValue ?? ""),
    suggestedFixes: [{ field, oldValue: String(question[field] ?? ""), newValue: String(newValue ?? "") }],
    status: "pending",
    fixedBy: admin?._id || undefined,
  }));
  await AIQuestionAuditFinding.deleteMany({ questionId: question._id, provider: "rule-engine", status: "pending" });
  if (findings.length) await AIQuestionAuditFinding.insertMany(findings, { ordered: false });
  return { questionId, updated: false, drafted: findings.length, fixedFields, status: audit.status, confidence: audit.confidence };
}

function toCsv(rows) {
  const headers = ["Question ID", "Subject", "Chapter", "Topic", "Question Type", "Status", "Confidence", "Error Count", "Warning Count", "Reviewed", "Preview", "Issues"];
  const body = rows.map((row) => [
    row.questionId,
    row.subject,
    row.chapter,
    row.topic,
    row.questionType,
    row.status,
    row.confidence,
    row.errorCount,
    row.warningCount,
    row.reviewed ? "Yes" : "No",
    row.preview,
    (row.issues || []).map((item) => `${item.field}:${item.type}:${item.message}`).join(" | "),
  ]);
  return [headers, ...body].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

export const katexAuditService = {
  async listQuestions(params = {}) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.max(10, Math.min(1000, Number(params.limit || 20)));
    const filter = await buildQuestionListFilter(params);
    const status = String(params.status || "").toUpperCase();
    if (["PASS", "KATEX_ISSUE", "WARNING", "FAILED"].includes(status)) {
      const auditIds = await QuestionKatexAuditResult.find({ status }).distinct("questionId");
      filter._id = { $in: auditIds };
    }
    if (status === "PENDING") {
      const auditedIds = await QuestionKatexAuditResult.distinct("questionId");
      filter._id = { $nin: auditedIds };
    }
    const [total, rows, cards] = await Promise.all([
      Question.countDocuments(filter),
      Question.find(filter).sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      summary(params),
    ]);
    return {
      data: await decorateQuestions(rows),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: cards,
    };
  },

  async scanAll({ batchSize } = {}) {
    const total = await Question.countDocuments({});
    let processed = 0;
    let passed = 0;
    let katexIssue = 0;
    let lastId = null;
    const limit = Math.max(1, Math.min(Number(batchSize || BATCH_LIMIT), BATCH_LIMIT));
    while (processed < total) {
      const filter = lastId ? { _id: { $gt: lastId } } : {};
      const questions = await Question.find(filter).sort({ _id: 1 }).limit(limit).lean();
      if (!questions.length) break;
      for (const question of questions) {
        const audit = await upsertAuditResult(question);
        processed += 1;
        if (audit.status === "PASS") passed += 1;
        if (audit.status === "KATEX_ISSUE") katexIssue += 1;
      }
      lastId = questions[questions.length - 1]._id;
    }
    return { total, processed, passed, katexIssue, warning: katexIssue, failed: 0, batchSize: limit, summary: await summary({}) };
  },

  async scanBySubject({ subjectId, batchSize } = {}) {
    if (!mongoose.isValidObjectId(subjectId)) throw new AppError("Invalid subject", 400);
    const result = await scanQuestions({ subjectId }, { limit: batchSize });
    return { ...result, summary: await summary({ subjectId }) };
  },

  async scanSingle({ questionId }) {
    if (!mongoose.isValidObjectId(questionId)) throw new AppError("Invalid question", 400);
    const question = await Question.findById(questionId).lean();
    if (!question) throw new AppError("Question not found", 404);
    await upsertAuditResult(question);
    const [row] = await decorateRows(await QuestionKatexAuditResult.find({ questionId }).lean());
    return row;
  },

  async list(params = {}) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.max(10, Math.min(1000, Number(params.limit || 20)));
    const filter = buildAuditFilter(params);
    const [total, rows, cards] = await Promise.all([
      QuestionKatexAuditResult.countDocuments(filter),
      QuestionKatexAuditResult.find(filter).sort({ status: 1, confidence: 1, lastScannedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      summary(params),
    ]);
    return {
      data: await decorateRows(rows),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: cards,
    };
  },

  async autoFix({ questionId }, admin) {
    return autoFixOne(questionId, admin);
  },

  async bulkAutoFix({ questionIds = [] } = {}, admin) {
    const ids = [...new Set(questionIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    let drafted = 0;
    const results = [];
    for (const id of ids) {
      const result = await autoFixOne(id, admin);
      drafted += result.drafted || 0;
      results.push(result);
    }
    return { requested: questionIds.length, processed: results.length, updated: 0, drafted, results };
  },

  async markReviewed({ questionIds = [] } = {}, admin) {
    const ids = [...new Set(questionIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    const result = await QuestionKatexAuditResult.updateMany(
      { questionId: { $in: ids } },
      { $set: { reviewed: true, reviewedBy: admin?._id || undefined, reviewedAt: new Date() } },
    );
    return { requested: questionIds.length, reviewed: result.modifiedCount || 0 };
  },

  async export(params = {}, format = "csv") {
    const rows = await decorateRows(await QuestionKatexAuditResult.find(buildAuditFilter(params)).sort({ status: 1, confidence: 1 }).limit(20000).lean());
    if (format === "xlsx") {
      const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
        questionId: row.questionId,
        subject: row.subject,
        chapter: row.chapter,
        topic: row.topic,
        questionType: row.questionType,
        status: row.status,
        confidence: row.confidence,
        errorCount: row.errorCount,
        warningCount: row.warningCount,
        reviewed: row.reviewed ? "Yes" : "No",
        preview: row.preview,
        issues: (row.issues || []).map((item) => `${item.field}:${item.type}:${item.message}`).join(" | "),
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "KaTeX Audit");
      return { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "katex-audit.xlsx", body: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) };
    }
    return { contentType: "text/csv; charset=utf-8", filename: "katex-audit.csv", body: toCsv(rows) };
  },
};
