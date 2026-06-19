import crypto from "crypto";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import {
  AIConfiguration,
  AIFixHistory,
  AIQuestionAuditFinding,
  AIQuestionAuditJob,
  Chapter,
  Question,
  QuestionType,
  Subject,
  Topic,
} from "../models/index.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { auditQuestion } from "./katexAuditService.js";

const PROVIDER_DEFAULTS = {
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", modelsPath: "/models", chatPath: "/chat/completions" },
  openai: { baseUrl: "https://api.openai.com/v1", modelsPath: "/models", chatPath: "/chat/completions" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", modelsPath: "/models", chatPath: "/chat/completions" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelsPath: "/models", chatPath: "" },
};
const DEFAULT_MODELS = {
  openrouter: ["deepseek/deepseek-r1", "openai/gpt-5", "openai/gpt-4.1", "anthropic/claude-3.7-sonnet", "google/gemini-2.5-pro"],
  openai: ["gpt-5", "gpt-4.1", "gpt-4o"],
  groq: ["llama-4-scout-17b-16e-instruct", "deepseek-r1-distill-llama-70b", "llama-3.3-70b-versatile"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
};
const AUDIT_FIELDS = ["question", "optionA", "optionB", "optionC", "optionD", "correctOption", "correctOptions", "numericAnswer", "explanation"];
const AI_AUDIT_STATUSES = ["PASS", "KATEX_ISSUE", "MINOR_ISSUE", "ANSWER_MISMATCH", "EXPLANATION_MISMATCH", "QUESTION_ERROR", "CRITICAL"];
const activeJobs = new Set();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeProvider(provider) {
  const normalized = String(provider || "").toLowerCase();
  if (!PROVIDER_DEFAULTS[normalized]) throw new AppError("Unsupported AI provider", 400);
  return normalized;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(env.sessionSecret || env.jwtSecret).digest();
}

function encrypt(value = "") {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decrypt(value = "") {
  if (!value) return "";
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(":");
  if (!ivRaw || !tagRaw || !encryptedRaw) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
}

function publicConfig(config) {
  if (!config) return null;
  return {
    id: String(config._id),
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    organizationId: config.organizationId,
    availableModels: config.availableModels || [],
    isActive: Boolean(config.isActive),
    hasApiKey: Boolean(config.apiKeyEncrypted),
    lastTestedAt: config.lastTestedAt,
    lastTestStatus: config.lastTestStatus,
    lastTestMessage: config.lastTestMessage,
  };
}

function authHeaders(provider, apiKey, organizationId) {
  const headers = { "Content-Type": "application/json" };
  if (provider === "gemini") return headers;
  headers.Authorization = `Bearer ${apiKey}`;
  if (organizationId && provider === "openai") headers["OpenAI-Organization"] = organizationId;
  return headers;
}

function baseUrlFor(config) {
  return String(config.baseUrl || PROVIDER_DEFAULTS[config.provider].baseUrl).replace(/\/+$/, "");
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
    if (!response.ok) throw new AppError(json?.error?.message || json?.message || `AI provider returned ${response.status}`, response.status);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function getConfig(provider = "") {
  const normalized = provider ? normalizeProvider(provider) : "";
  const config = normalized
    ? await AIConfiguration.findOne({ provider: normalized })
    : await AIConfiguration.findOne({ isActive: true });
  if (!config) throw new AppError("AI configuration not found", 404);
  const apiKey = decrypt(config.apiKeyEncrypted);
  if (!apiKey) throw new AppError("AI API key is not configured", 400);
  return { config, apiKey };
}

function modelNames(provider, json = {}) {
  if (provider === "gemini") {
    return (json.models || []).map((item) => String(item.name || "").replace(/^models\//, "")).filter(Boolean);
  }
  return (json.data || json.models || []).map((item) => item.id || item.name).filter(Boolean);
}

function buildQuestionJson(question) {
  return {
    question: question.question || "",
    options: [
      { id: "A", text: question.optionA || "" },
      { id: "B", text: question.optionB || "" },
      { id: "C", text: question.optionC || "" },
      { id: "D", text: question.optionD || "" },
    ],
    correct_answer: question.correctOption || question.numericAnswer || "",
    difficulty: question.difficulty || "",
    type: question.responseType === "numeric" ? "Numeric" : "MCQ",
    explanation: question.explanation || "",
  };
}

function buildPrompt(question) {
  const questionJson = {
    question_id: String(question._id),
    ...buildQuestionJson(question),
  };
  return [
    "You are an expert NEET/JEE Academic Auditor and KaTeX formatter.",
    "Analyze the following structured question JSON exactly as provided.",
    "For this workflow, fix only formatting, notation, equation, chemical formula, physics notation, and KaTeX rendering issues.",
    "Preserve original question meaning, answer correctness, option order, and explanation logic.",
    "Use valid KaTeX delimiters and formatting like $E_1$, $Cu^{2+}$, $ZnSO_4$, $0.01\\,M$, and $$...$$ for display equations.",
    "Check KaTeX syntax, missing braces, broken subscripts/superscripts, chemical notation, electrochemical cell notation, equation formatting, and rendering errors.",
    "Return ONLY valid JSON.",
    "{",
    "\"status\": \"PASS | KATEX_ISSUE | MINOR_ISSUE | ANSWER_MISMATCH | EXPLANATION_MISMATCH | QUESTION_ERROR | CRITICAL\",",
    "\"confidence\": 0-100,",
    "\"issues\": [{\"field\": \"question | option | answer | explanation\", \"option_id\": \"A | B | C | D\", \"severity\": \"low | medium | high | critical\", \"issue\": \"\", \"reason\": \"\", \"suggested_fix\": \"\"}],",
    "\"corrected_version\": {\"question\": \"\", \"options\": [{\"id\": \"A\", \"text\": \"\"}, {\"id\": \"B\", \"text\": \"\"}, {\"id\": \"C\", \"text\": \"\"}, {\"id\": \"D\", \"text\": \"\"}], \"correct_answer\": \"\", \"difficulty\": \"\", \"type\": \"\", \"explanation\": \"\"}",
    "}",
    "Question Data:",
    JSON.stringify(questionJson, null, 2),
  ].join("\n");
}

function parseAIText(json, provider) {
  if (provider === "gemini") return json?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  return json?.choices?.[0]?.message?.content || json?.output_text || "";
}

function extractJson(text = "") {
  const cleaned = String(text).replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return {}; }
    }
  }
  return {};
}

function deterministicIssues(question, provider, model) {
  const audit = auditQuestion(question);
  return (audit.issues || []).map((item) => ({
    provider,
    model,
    auditStatus: "KATEX_ISSUE",
    confidence: audit.confidence || 0,
    issueType: item.type.includes("CHEMICAL") || item.type.includes("IONIC") || item.type.includes("SCIENTIFIC") ? "formula" : item.type.includes("OCR") ? "ocr" : "katex",
    severity: item.severity === "error" ? "high" : "medium",
    description: item.message,
    field: item.field,
    oldValue: question[item.field] || "",
    suggestedValue: audit.fixedFields?.[item.field] || "",
  }));
}

async function callAIProvider(question, config, apiKey) {
  const provider = config.provider;
  const model = config.model;
  const baseUrl = baseUrlFor(config);
  const prompt = buildPrompt(question);
  if (provider === "gemini") {
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const json = await fetchJson(url, {
      method: "POST",
      headers: authHeaders(provider, apiKey, config.organizationId),
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    return extractJson(parseAIText(json, provider));
  }
  const json = await fetchJson(`${baseUrl}${PROVIDER_DEFAULTS[provider].chatPath}`, {
    method: "POST",
    headers: authHeaders(provider, apiKey, config.organizationId),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a question-bank QA auditor. Return strict JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
  });
  return extractJson(parseAIText(json, provider));
}

function normalizeIssue(raw, question, config) {
  const rawField = String(raw.field || "").toLowerCase();
  const optionField = rawField === "option" ? `option${String(raw.option_id || raw.optionId || "A").toUpperCase()}` : "";
  const field = optionField && AUDIT_FIELDS.includes(optionField) ? optionField : rawField === "answer" ? "correctOption" : AUDIT_FIELDS.includes(raw.field) ? raw.field : "question";
  const auditStatus = AI_AUDIT_STATUSES.includes(raw.auditStatus || raw.status) ? (raw.auditStatus || raw.status) : "KATEX_ISSUE";
  const description = [raw.issue, raw.reason, raw.description].filter(Boolean).join(" - ") || "AI audit issue detected";
  return {
    questionId: question._id,
    provider: config.provider,
    model: config.model,
    auditStatus,
    confidence: Math.max(0, Math.min(100, Number(raw.confidence || 0))),
    issueType: ["formula", "answer", "explanation", "ocr", "katex", "grammar", "option", "science"].includes(raw.issueType) ? raw.issueType : auditStatus === "ANSWER_MISMATCH" ? "answer" : auditStatus === "EXPLANATION_MISMATCH" ? "explanation" : auditStatus === "MINOR_ISSUE" ? "grammar" : "katex",
    severity: ["low", "medium", "high", "critical"].includes(raw.severity) ? raw.severity : "medium",
    description: String(description).slice(0, 2000),
    field,
    oldValue: String(raw.oldValue ?? question[field] ?? ""),
    suggestedValue: String(raw.suggestedValue ?? raw.suggested_fix ?? ""),
    suggestedFixes: Array.isArray(raw.suggestedFixes)
      ? raw.suggestedFixes.filter((fix) => AUDIT_FIELDS.includes(fix.field)).map((fix) => ({ field: fix.field, oldValue: String(fix.oldValue ?? question[fix.field] ?? ""), newValue: String(fix.newValue ?? "") }))
      : ((raw.suggestedValue || raw.suggested_fix) ? [{ field, oldValue: String(raw.oldValue ?? question[field] ?? ""), newValue: String(raw.suggestedValue ?? raw.suggested_fix) }] : []),
    rawResponse: raw,
  };
}

async function scanQuestion(question, config, apiKey, jobId) {
  let rawIssues = [];
  let auditStatus = "PASS";
  let confidence = 100;
  let correctedVersion = {};
  try {
    const response = await callAIProvider(question, config, apiKey);
    rawIssues = Array.isArray(response.issues) ? response.issues : [];
    auditStatus = AI_AUDIT_STATUSES.includes(response.status) ? response.status : (rawIssues.length ? "CRITICAL" : "PASS");
    confidence = Math.max(0, Math.min(100, Number(response.confidence ?? (rawIssues.length ? 70 : 100))));
    correctedVersion = response.corrected_version || {};
  } catch {
    rawIssues = deterministicIssues(question, config.provider, config.model);
    auditStatus = rawIssues.length ? "KATEX_ISSUE" : "PASS";
    confidence = rawIssues[0]?.confidence || (rawIssues.length ? 75 : 100);
  }
  if (!rawIssues.length && auditStatus !== "PASS") {
    rawIssues = [{ auditStatus, confidence, field: "question", severity: auditStatus === "CRITICAL" ? "critical" : "medium", issue: auditStatus, reason: "AI returned a non-pass status without detailed issues" }];
  }
  const optionFields = ["optionA", "optionB", "optionC", "optionD"];
  const correctedFixes = [];
  if (correctedVersion.question && correctedVersion.question !== question.question) correctedFixes.push({ field: "question", oldValue: question.question || "", newValue: correctedVersion.question });
  if (Array.isArray(correctedVersion.options)) {
    correctedVersion.options.forEach((value, index) => {
      const optionId = typeof value === "object" ? String(value.id || "").toUpperCase() : "";
      const field = optionId && ["A", "B", "C", "D"].includes(optionId) ? `option${optionId}` : optionFields[index];
      const nextValue = typeof value === "object" ? value.text : value;
      if (field && nextValue && nextValue !== question[field]) correctedFixes.push({ field, oldValue: question[field] || "", newValue: nextValue });
    });
  }
  if (correctedVersion.correct_answer && correctedVersion.correct_answer !== question.correctOption) correctedFixes.push({ field: "correctOption", oldValue: question.correctOption || "", newValue: correctedVersion.correct_answer });
  if (correctedVersion.explanation && correctedVersion.explanation !== question.explanation) correctedFixes.push({ field: "explanation", oldValue: question.explanation || "", newValue: correctedVersion.explanation });
  const issues = rawIssues.map((item) => {
    const normalized = normalizeIssue({ ...item, auditStatus, confidence }, question, config);
    return { ...normalized, jobId, suggestedFixes: normalized.suggestedFixes.length ? normalized.suggestedFixes : correctedFixes };
  });
  await AIQuestionAuditFinding.deleteMany({ questionId: question._id, status: "pending" });
  if (issues.length) await AIQuestionAuditFinding.insertMany(issues, { ordered: false });
  return issues.length;
}

async function processJob(jobId) {
  const job = await AIQuestionAuditJob.findById(jobId);
  if (!job) return;
  const { config, apiKey } = await getConfig(job.provider);
  job.status = "processing";
  job.startedAt = new Date();
  await job.save();
  try {
    for (const questionId of job.questionIds) {
      const question = await Question.findById(questionId).lean();
      if (question) job.issuesFound += await scanQuestion(question, config, apiKey, job._id);
      job.processed += 1;
      job.remaining = Math.max(0, job.total - job.processed);
      await job.save();
    }
    job.status = "completed";
    job.completedAt = new Date();
    await job.save();
  } catch (error) {
    job.status = "failed";
    job.errorMessage = error.message || "AI scan failed";
    job.completedAt = new Date();
    await job.save();
  } finally {
    activeJobs.delete(String(jobId));
  }
}

function startJob(jobId) {
  const key = String(jobId);
  if (activeJobs.has(key)) return;
  activeJobs.add(key);
  setImmediate(() => void processJob(jobId));
}

function toCsv(rows) {
  const headers = ["Date", "Question ID", "Field", "Old Value", "New Value", "Provider", "Model", "Rolled Back"];
  return [headers, ...rows.map((row) => [
    row.createdAt,
    row.questionId,
    row.field,
    row.oldValue,
    row.newValue,
    row.provider,
    row.model,
    row.rolledBackAt ? "Yes" : "No",
  ])].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function findingsToCsv(rows) {
  const headers = ["Question ID", "Audit Status", "Confidence", "Issue Type", "Severity", "Description", "Field", "Old Value", "Suggested Value", "Draft Status", "Provider", "Model", "Created At"];
  return [headers, ...rows.map((row) => [
    row.questionId,
    row.auditStatus,
    row.confidence,
    row.issueType,
    row.severity,
    row.description,
    row.field,
    row.oldValue,
    row.suggestedValue,
    row.status,
    row.provider,
    row.model,
    row.createdAt,
  ])].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

async function buildQuestionScopedIds(params = {}) {
  const filter = {};
  if (mongoose.isValidObjectId(params.subjectId)) filter.subjectId = params.subjectId;
  if (mongoose.isValidObjectId(params.chapterId)) filter.chapterId = params.chapterId;
  if (mongoose.isValidObjectId(params.topicId)) filter.topicId = params.topicId;
  if (mongoose.isValidObjectId(params.questionTypeId)) filter.questionTypeId = params.questionTypeId;
  const search = String(params.search || params.q || "").trim();
  if (search) {
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
  }
  if (!Object.keys(filter).length) return null;
  return Question.find(filter).distinct("_id");
}

async function findingsFilter(params = {}) {
  const filter = {};
  if (mongoose.isValidObjectId(params.questionId)) filter.questionId = params.questionId;
  if (["formula", "answer", "explanation", "ocr", "katex", "grammar", "option", "science"].includes(params.issueType)) filter.issueType = params.issueType;
  if (AI_AUDIT_STATUSES.includes(params.auditStatus)) filter.auditStatus = params.auditStatus;
  if (["pending", "approved", "rejected", "applied", "rolled_back"].includes(params.status)) filter.status = params.status;
  const scopedIds = await buildQuestionScopedIds(params);
  if (scopedIds) filter.questionId = filter.questionId ? filter.questionId : { $in: scopedIds };
  return filter;
}

async function decorateFindings(rows) {
  const questions = await Question.find({ _id: { $in: rows.map((row) => row.questionId).filter(Boolean) } })
    .select("subjectId chapterId topicId questionTypeId question optionA optionB optionC optionD explanation correctOption")
    .lean();
  const [subjects, chapters, topics, questionTypes] = await Promise.all([
    Subject.find({ _id: { $in: questions.map((row) => row.subjectId).filter(Boolean) } }).lean(),
    Chapter.find({ _id: { $in: questions.map((row) => row.chapterId).filter(Boolean) } }).lean(),
    Topic.find({ _id: { $in: questions.map((row) => row.topicId).filter(Boolean) } }).lean(),
    QuestionType.find({ _id: { $in: questions.map((row) => row.questionTypeId).filter(Boolean) } }).lean(),
  ]);
  const maps = {
    question: new Map(questions.map((item) => [String(item._id), item])),
    subject: new Map(subjects.map((item) => [String(item._id), item.name])),
    chapter: new Map(chapters.map((item) => [String(item._id), item.name])),
    topic: new Map(topics.map((item) => [String(item._id), item.name])),
    questionType: new Map(questionTypes.map((item) => [String(item._id), item.name || item.label || item.key])),
  };
  return rows.map((row) => {
    const question = maps.question.get(String(row.questionId)) || {};
    return {
      ...row,
      subjectId: question.subjectId ? String(question.subjectId) : "",
      chapterId: question.chapterId ? String(question.chapterId) : "",
      topicId: question.topicId ? String(question.topicId) : "",
      questionTypeId: question.questionTypeId ? String(question.questionTypeId) : "",
      subject: maps.subject.get(String(question.subjectId)) || "-",
      chapter: maps.chapter.get(String(question.chapterId)) || "-",
      topic: maps.topic.get(String(question.topicId)) || "-",
      questionType: maps.questionType.get(String(question.questionTypeId)) || "-",
      originalQuestion: {
        question: question.question || "",
        options: [question.optionA || "", question.optionB || "", question.optionC || "", question.optionD || ""],
        explanation: question.explanation || "",
        correctOption: question.correctOption || "",
      },
    };
  });
}

export const aiAuditService = {
  async saveConfig(payload = {}) {
    const provider = normalizeProvider(payload.provider);
    const existing = await AIConfiguration.findOne({ provider });
    const apiKeyEncrypted = payload.apiKey ? encrypt(payload.apiKey) : existing?.apiKeyEncrypted || "";
    if (payload.isActive !== false) await AIConfiguration.updateMany({}, { $set: { isActive: false } });
    const config = await AIConfiguration.findOneAndUpdate(
      { provider },
      {
        $set: {
          provider,
          model: String(payload.model || existing?.model || ""),
          apiKeyEncrypted,
          baseUrl: String(payload.baseUrl || existing?.baseUrl || ""),
          organizationId: String(payload.organizationId || existing?.organizationId || ""),
          isActive: payload.isActive !== false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return publicConfig(config);
  },

  async listConfigs() {
    const configs = await AIConfiguration.find().sort({ provider: 1 }).lean();
    return configs.map(publicConfig);
  },

  async fetchModels(provider) {
    const { config, apiKey } = await getConfig(provider);
    const defaults = PROVIDER_DEFAULTS[config.provider];
    let models = DEFAULT_MODELS[config.provider] || [];
    try {
      const url = config.provider === "gemini"
        ? `${baseUrlFor(config)}${defaults.modelsPath}?key=${encodeURIComponent(apiKey)}`
        : `${baseUrlFor(config)}${defaults.modelsPath}`;
      const json = await fetchJson(url, { headers: authHeaders(config.provider, apiKey, config.organizationId) });
      models = [...new Set([...modelNames(config.provider, json), ...models])].filter(Boolean);
    } catch {
      models = DEFAULT_MODELS[config.provider] || [];
    }
    await AIConfiguration.findByIdAndUpdate(config._id, { $set: { availableModels: models } });
    return { provider: config.provider, models };
  },

  async testConnection(provider) {
    const { config } = await getConfig(provider);
    try {
      const result = await this.fetchModels(config.provider);
      await AIConfiguration.findByIdAndUpdate(config._id, { $set: { lastTestedAt: new Date(), lastTestStatus: "success", lastTestMessage: `${result.models.length} models loaded` } });
      return { success: true, message: `${result.models.length} models loaded`, models: result.models };
    } catch (error) {
      await AIConfiguration.findByIdAndUpdate(config._id, { $set: { lastTestedAt: new Date(), lastTestStatus: "failed", lastTestMessage: error.message || "Connection failed" } });
      throw error;
    }
  },

  async startScan({ questionIds = [], provider = "" } = {}, admin) {
    const { config } = await getConfig(provider);
    if (!config.model) throw new AppError("Select an AI model before scanning", 400);
    const ids = [...new Set(questionIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    if (!ids.length) throw new AppError("Select questions for AI scan", 400);
    const job = await AIQuestionAuditJob.create({
      provider: config.provider,
      model: config.model,
      total: ids.length,
      remaining: ids.length,
      questionIds: ids,
      createdBy: admin?._id || undefined,
    });
    startJob(job._id);
    return job;
  },

  async scanSingle({ questionId, provider = "", questionData = null } = {}) {
    if (!mongoose.isValidObjectId(questionId)) throw new AppError("Invalid question id", 400);
    const { config, apiKey } = await getConfig(provider);
    if (!config.model) throw new AppError("Select an AI model before scanning", 400);
    const storedQuestion = await Question.findById(questionId).lean();
    if (!storedQuestion) throw new AppError("Question not found", 404);
    const question = questionData && typeof questionData === "object"
      ? { ...storedQuestion, ...questionData, _id: storedQuestion._id }
      : storedQuestion;
    await scanQuestion(question, config, apiKey, null);
    const findings = await AIQuestionAuditFinding.find({ questionId, status: "pending" }).sort({ severity: 1, createdAt: -1 }).lean();
    return { questionId, findings };
  },

  async getJob(jobId) {
    if (!mongoose.isValidObjectId(jobId)) throw new AppError("Invalid AI audit job", 400);
    const job = await AIQuestionAuditJob.findById(jobId).lean();
    if (!job) throw new AppError("AI audit job not found", 404);
    return job;
  },

  async listFindings(params = {}) {
    const filter = await findingsFilter(params);
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.max(10, Math.min(1000, Number(params.limit || 20)));
    const [rows, total] = await Promise.all([
      AIQuestionAuditFinding.find(filter).sort({ severity: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AIQuestionAuditFinding.countDocuments(filter),
    ]);
    const data = await decorateFindings(rows);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async issueTypes(params = {}) {
    const filter = await findingsFilter({ ...params, issueType: "" });
    return AIQuestionAuditFinding.distinct("issueType", filter);
  },

  async summary() {
    const [totalQuestions, auditedQuestions, statusCounts, draftCounts, rollbackCount, processingQueueCount] = await Promise.all([
      Question.countDocuments({}),
      AIQuestionAuditFinding.distinct("questionId", {}),
      AIQuestionAuditFinding.aggregate([
      { $group: { _id: "$auditStatus", count: { $sum: 1 } } },
      ]),
      AIQuestionAuditFinding.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      AIFixHistory.countDocuments({ rolledBackAt: { $ne: null } }),
      AIQuestionAuditJob.countDocuments({ status: { $in: ["queued", "processing"] } }),
    ]);
    const byStatus = Object.fromEntries(statusCounts.map((item) => [item._id, item.count]));
    const byDraft = Object.fromEntries(draftCounts.map((item) => [item._id, item.count]));
    return {
      totalQuestions,
      auditedQuestions: auditedQuestions.length,
      draftQuestions: byDraft.pending || 0,
      fixedQuestions: byDraft.applied || 0,
      approvedQuestions: byDraft.applied || 0,
      rollbackCount,
      processingQueueCount,
      pendingAudit: byDraft.pending || 0,
      minorIssues: byStatus.MINOR_ISSUE || 0,
      answerMismatch: byStatus.ANSWER_MISMATCH || 0,
      explanationMismatch: byStatus.EXPLANATION_MISMATCH || 0,
      questionErrors: byStatus.QUESTION_ERROR || 0,
      critical: byStatus.CRITICAL || 0,
      approvedFixes: byDraft.approved || 0,
      rejectedFixes: byDraft.rejected || 0,
    };
  },

  async approveFindings({ findingIds = [] } = {}) {
    const ids = [...new Set(findingIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    const result = await AIQuestionAuditFinding.updateMany({ _id: { $in: ids }, status: "pending" }, { $set: { status: "approved" } });
    return { requested: findingIds.length, approved: result.modifiedCount || 0 };
  },

  async refixFindings({ findingIds = [] } = {}) {
    const ids = [...new Set(findingIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    const { config, apiKey } = await getConfig("");
    const findings = await AIQuestionAuditFinding.find({ _id: { $in: ids }, status: { $in: ["approved", "rejected"] } }).lean();
    let movedToDraft = 0;
    for (const finding of findings) {
      const question = await Question.findById(finding.questionId).lean();
      if (!question) continue;
      await AIQuestionAuditFinding.findByIdAndUpdate(finding._id, { $set: { status: "rejected" } });
      movedToDraft += await scanQuestion(question, config, apiKey, null);
    }
    return { requested: findingIds.length, movedToDraft };
  },

  async rejectFindings({ findingIds = [] } = {}) {
    const ids = [...new Set(findingIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    const result = await AIQuestionAuditFinding.updateMany({ _id: { $in: ids }, status: { $in: ["pending", "approved"] } }, { $set: { status: "rejected" } });
    return { requested: findingIds.length, rejected: result.modifiedCount || 0 };
  },

  async editFinding(findingId, payload = {}) {
    if (!mongoose.isValidObjectId(findingId)) throw new AppError("Invalid finding id", 400);
    const finding = await AIQuestionAuditFinding.findById(findingId);
    if (!finding) throw new AppError("AI finding not found", 404);
    if (payload.description !== undefined) finding.description = String(payload.description || "");
    if (payload.suggestedValue !== undefined) {
      finding.suggestedValue = String(payload.suggestedValue || "");
      finding.suggestedFixes = [{ field: finding.field, oldValue: finding.oldValue, newValue: finding.suggestedValue }];
    }
    if (AI_AUDIT_STATUSES.includes(payload.auditStatus)) finding.auditStatus = payload.auditStatus;
    await finding.save();
    return finding;
  },

  async applyApprovedFixes({ findingIds = [] } = {}, admin) {
    const ids = [...new Set(findingIds.map(String).filter((id) => mongoose.isValidObjectId(id)))];
    let applied = 0;
    for (const finding of await AIQuestionAuditFinding.find({ _id: { $in: ids }, status: "approved" })) {
      const question = await Question.findById(finding.questionId);
      if (!question) continue;
      const fixes = finding.suggestedFixes?.length ? finding.suggestedFixes : [{ field: finding.field, oldValue: finding.oldValue, newValue: finding.suggestedValue }];
      for (const fix of fixes) {
        if (!AUDIT_FIELDS.includes(fix.field) || !String(fix.newValue || "")) continue;
        const oldValue = String(question[fix.field] ?? "");
        if (oldValue === String(fix.newValue)) continue;
        question[fix.field] = fix.newValue;
        await AIFixHistory.create({ questionId: question._id, findingId: finding._id, field: fix.field, oldValue, newValue: fix.newValue, provider: finding.provider, model: finding.model, appliedBy: admin?._id || undefined });
        applied += 1;
      }
      await question.save();
      finding.status = "applied";
      finding.fixedAt = new Date();
      finding.fixedBy = admin?._id || undefined;
      await finding.save();
    }
    return { requested: findingIds.length, applied };
  },

  async history(params = {}) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.max(10, Math.min(1000, Number(params.limit || 20)));
    const [data, total] = await Promise.all([
      AIFixHistory.find({}).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AIFixHistory.countDocuments({}),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async rollback(historyId, admin) {
    if (!mongoose.isValidObjectId(historyId)) throw new AppError("Invalid history id", 400);
    const history = await AIFixHistory.findById(historyId);
    if (!history) throw new AppError("AI fix history not found", 404);
    if (history.rolledBackAt) throw new AppError("Fix already rolled back", 400);
    const question = await Question.findById(history.questionId);
    if (!question) throw new AppError("Question not found", 404);
    question[history.field] = history.oldValue;
    await question.save();
    history.rolledBackAt = new Date();
    history.rolledBackBy = admin?._id || undefined;
    await history.save();
    if (history.findingId) await AIQuestionAuditFinding.findByIdAndUpdate(history.findingId, { $set: { status: "rolled_back" } });
    return history;
  },

  async exportHistory() {
    const rows = await AIFixHistory.find({}).sort({ createdAt: -1 }).limit(20000).lean();
    return { contentType: "text/csv; charset=utf-8", filename: "ai-fix-history.csv", body: toCsv(rows) };
  },

  async exportFindings(params = {}, format = "csv") {
    const rows = await AIQuestionAuditFinding.find(await findingsFilter(params)).sort({ severity: 1, createdAt: -1 }).limit(20000).lean();
    if (format === "json") {
      return { contentType: "application/json; charset=utf-8", filename: "ai-draft-queue.json", body: Buffer.from(JSON.stringify(rows, null, 2)) };
    }
    if (format === "xlsx") {
      const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
        questionId: String(row.questionId),
        auditStatus: row.auditStatus,
        confidence: row.confidence,
        issueType: row.issueType,
        severity: row.severity,
        description: row.description,
        field: row.field,
        oldValue: row.oldValue,
        suggestedValue: row.suggestedValue,
        status: row.status,
        provider: row.provider,
        model: row.model,
        createdAt: row.createdAt,
      })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Draft Queue");
      return { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "ai-draft-queue.xlsx", body: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) };
    }
    return { contentType: "text/csv; charset=utf-8", filename: "ai-draft-queue.csv", body: findingsToCsv(rows) };
  },
};
