import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  Chapter,
  CmsMenuItem,
  CmsPage,
  ContactMessage,
  DashboardCarouselBanner,
  EmailTemplate,
  ExplanationPreviewTemplate,
  InvoiceSettings,
  ListStyle,
  OfferTimerSettings,
  PolicyPage,
  PushDeviceToken,
  Question,
  Subject,
  SubscriptionPageTemplate,
  Topic,
  User,
  WebsiteContent,
  WebsiteSettings,
} from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendEmail } from "../utils/simpleEmail.js";
import { DEFAULT_TEMPLATES, EMAIL_TEMPLATE_KEYS } from "../utils/templatedEmail.js";
import { verifyToken } from "../utils/token.js";

const router = Router();

const testGenerateSchema = z.object({
  mode: z.string().optional(),
  chapterId: z.string().optional(),
  chapterIds: z.array(z.string()).optional(),
  subjectId: z.string().optional(),
  subjectIds: z.array(z.string()).optional(),
  topicIds: z.array(z.string()).optional().default([]),
  selectionMode: z.enum(["manual", "automatic"]).optional(),
  testMode: z.enum(["manual", "automatic"]).optional(),
  examPattern: z.string().optional(),
  questionCount: z.coerce.number().int().min(1).max(200).optional(),
  difficulty: z.string().optional(),
});

const testSubmitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedOption: z.string().optional(),
      selectedOptions: z.array(z.string()).optional(),
      numericAnswer: z.string().optional(),
      skipped: z.boolean().optional(),
      timeSpent: z.number().optional(),
    }),
  ).default([]),
  timeTaken: z.coerce.number().int().min(0).optional().default(0),
});

const contactMessageSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().email("Valid email is required").max(180),
  interest: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().min(5, "Message is required").max(3000),
});

const pushTokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(["android", "ios", "web", "unknown"]).optional().default("unknown"),
  mode: z.string().trim().max(80).optional().default(""),
  appVersion: z.string().trim().max(80).optional().default(""),
  deviceId: z.string().trim().max(160).optional().default(""),
});

async function requireAppUser(req, _res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    if (!token) throw new AppError("Authentication required", 401);

    const decoded = verifyToken(token);
    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      throw new AppError("Invalid token payload", 401);
    }

    const user = await User.findById(decoded.userId).lean();
    if (!user || user.isBlocked === true || user.isActive === false) {
      throw new AppError("User account is inactive", 403);
    }

    req.appUser = user;
    req.auth = decoded;
    next();
  } catch (error) {
    next(error.statusCode ? error : new AppError("Invalid or expired token", 401));
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => String(values[key] ?? ""));
}

function buildHtmlFallback(textContent) {
  const safeText = escapeHtml(textContent || "").replace(/\r?\n/g, "<br/>");
  return `<html><body><div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.5;">${safeText}</div></body></html>`;
}

function escapedValues(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escapeHtml(value)]));
}

async function renderEmailTemplate(templateKey, values) {
  const template = await EmailTemplate.findOne({ key: templateKey }).lean();
  if (template && template.isActive === false) {
    return { skipped: true, reason: `Email template '${templateKey}' is inactive` };
  }

  const fallback = DEFAULT_TEMPLATES[templateKey] || {};
  const subjectTemplate = template?.subject || fallback.subject || "";
  const textTemplate = template?.textContent || fallback.text || "";
  const htmlTemplate = template?.htmlContent || fallback.html || "";
  const text = renderTemplate(textTemplate, values);
  const html = renderTemplate(htmlTemplate, escapedValues(values)).trim() || buildHtmlFallback(text);

  return {
    skipped: false,
    subject: renderTemplate(subjectTemplate, values),
    text,
    html,
  };
}

function assertObjectId(value, message = "Invalid id") {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(message, 400);
  }
}

function normalizeDifficulty(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "medium") return "moderate";
  return normalized;
}

function objectId(value) {
  return new mongoose.Types.ObjectId(String(value));
}

function publicQuestionFilter(extra = {}) {
  return {
    isVisibleToUsers: { $ne: false },
    questionStatus: { $ne: "incomplete" },
    reviewStatus: { $ne: "needs_review" },
    ...extra,
  };
}

function isAnswerCorrect(question, answer) {
  if (answer?.skipped) return false;
  if (question.responseType === "numeric") {
    const submitted = String(answer?.numericAnswer || "").trim().toLowerCase();
    const expected = String(question.numericAnswer || "").trim().toLowerCase();
    return Boolean(submitted) && submitted === expected;
  }
  if (question.responseType === "multiple") {
    const expected = new Set((question.correctOptions || []).map((item) => String(item).trim().toUpperCase()).filter(Boolean));
    const selected = new Set((answer?.selectedOptions || []).map((item) => String(item).trim().toUpperCase()).filter(Boolean));
    if (!expected.size) return false;
    if (selected.size !== expected.size) return false;
    return [...selected].every((item) => expected.has(item));
  }
  const submitted = String(answer?.selectedOption || "").trim().toUpperCase();
  const expected = String(question.correctOption || "").trim().toUpperCase();
  return Boolean(submitted) && submitted === expected;
}

router.get("/subjects", asyncHandler(async (req, res) => {
  const requestedExamType = String(req.query.examType || req.query.mode || "").trim().toUpperCase();
  const examFilter = requestedExamType && requestedExamType !== "BOTH" ? { examType: requestedExamType } : {};
  const subjects = await Subject.find(examFilter).sort({ name: 1 }).lean();
  const subjectIds = subjects.map((item) => item._id);

  const [chapterRows, questionRows] = await Promise.all([
    subjectIds.length ? Chapter.aggregate([{ $match: { subjectId: { $in: subjectIds } } }, { $group: { _id: "$subjectId", count: { $sum: 1 } } }]) : [],
    subjectIds.length ? Question.aggregate([{ $match: publicQuestionFilter({ subjectId: { $in: subjectIds } }) }, { $group: { _id: "$subjectId", count: { $sum: 1 } } }]) : [],
  ]);

  const chapterCountMap = new Map(chapterRows.map((item) => [String(item._id), Number(item.count || 0)]));
  const questionCountMap = new Map(questionRows.map((item) => [String(item._id), Number(item.count || 0)]));

  res.json({
    success: true,
    data: subjects.map((item) => ({
      id: String(item._id),
      name: item.name,
      examType: item.examType,
      totalChapters: chapterCountMap.get(String(item._id)) || 0,
      questionsCount: questionCountMap.get(String(item._id)) || 0,
      icon: item.icon,
      iconUrl: item.iconUrl || "",
      imageUrl: item.imageUrl || "",
      color: item.color,
    })),
  });
}));

router.get("/dashboard-carousel", asyncHandler(async (_req, res) => {
  const banners = await DashboardCarouselBanner.find({ enabled: true }).sort({ displayOrder: 1, createdAt: 1 }).lean();
  res.json({ success: true, data: banners.map((item) => ({ ...item, id: String(item._id), _id: undefined })) });
}));

router.get("/website-content", asyncHandler(async (_req, res) => {
  const document = await WebsiteContent.findOne({ key: "landing", status: "published" }).lean();
  res.json({ success: true, data: document?.content || {} });
}));

router.get("/website-content/settings", asyncHandler(async (_req, res) => {
  const settings = await WebsiteSettings.findOne({ key: "default", active: { $ne: false } }).lean();
  res.json({ success: true, data: settings || null });
}));

router.get("/website-content/menus", asyncHandler(async (_req, res) => {
  const items = await CmsMenuItem.find({ active: true, visible: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  res.json({ success: true, data: items.map((item) => ({ ...item, id: String(item._id), _id: undefined })) });
}));

router.get("/website-content/pages", asyncHandler(async (_req, res) => {
  const pages = await CmsPage.find({ active: true, status: "published", deletedAt: { $exists: false } }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  res.json({ success: true, data: pages.map((page) => ({ ...page, id: String(page._id), _id: undefined })) });
}));

router.get("/website-content/pages/:slug", asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").replace(/^\/+|\/+$/g, "");
  const page = await CmsPage.findOne({ slug, active: true, status: "published", deletedAt: { $exists: false } }).lean();
  res.json({ success: true, data: page ? { ...page, id: String(page._id), _id: undefined } : null });
}));

router.get("/website-content/policies", asyncHandler(async (_req, res) => {
  const policies = await PolicyPage.find({ active: true, status: "published" }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  res.json({ success: true, data: policies.map((policy) => ({ ...policy, id: String(policy._id), _id: undefined })) });
}));

router.get("/website-content/policies/:slug", asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").replace(/^\/+|\/+$/g, "");
  const policy = await PolicyPage.findOne({ slug, active: true, status: "published" }).lean();
  res.json({ success: true, data: policy ? { ...policy, id: String(policy._id), _id: undefined } : null });
}));

router.get("/offer-timer", asyncHandler(async (_req, res) => {
  const document = await OfferTimerSettings.findOne({ key: "app-offer-timer" }).lean();
  res.json({ success: true, data: document || null });
}));

router.get("/subscription-page-template", asyncHandler(async (_req, res) => {
  const template = await SubscriptionPageTemplate.findOne({ status: "published" }).sort({ publishedAt: -1, updatedAt: -1 }).lean();
  res.json({ success: true, data: template ? { ...template, id: String(template._id), _id: undefined } : null });
}));

router.get("/explanation-preview-template", asyncHandler(async (_req, res) => {
  const template = await ExplanationPreviewTemplate.findOne({ status: "published" }).sort({ publishedAt: -1, updatedAt: -1 }).lean();
  res.json({ success: true, data: template ? { ...template, id: String(template._id), _id: undefined } : null });
}));

router.get("/app-settings", asyncHandler(async (_req, res) => {
  const settings = await InvoiceSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.json({
    appName: settings.companyName || "Krita NEET JEE",
    logoUrl: settings.logoUrl || "",
    updatedAt: settings.updatedAt,
  });
}));

router.post("/contact-messages", asyncHandler(async (req, res) => {
  const payload = contactMessageSchema.parse(req.body || {});
  const settings = await InvoiceSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const message = await ContactMessage.create({
    name: payload.name,
    email: payload.email.toLowerCase(),
    interest: payload.interest,
    message: payload.message,
    ipAddress: req.ip || "",
    userAgent: req.get("user-agent") || "",
  });

  const adminRecipient = String(settings.companyEmail || settings.smtp?.fromEmail || "").trim();
  if (!adminRecipient) {
    message.adminEmailStatus = "skipped";
    message.adminEmailError = "Admin recipient email is not configured";
  } else {
    try {
      const submittedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const rendered = await renderEmailTemplate(EMAIL_TEMPLATE_KEYS.CONTACT_ADMIN_NOTIFICATION, {
        contact_name: payload.name,
        contact_email: payload.email,
        contact_interest: payload.interest || "Not specified",
        contact_message: payload.message,
        contact_submitted_at: submittedAt,
        admin_email: adminRecipient,
        company_name: settings.companyName || "Krita MCQs",
        support_email: settings.companyEmail || settings.smtp?.fromEmail || "support@krita.com",
      });
      if (rendered.skipped) {
        message.adminEmailStatus = "skipped";
        message.adminEmailError = rendered.reason;
        await message.save();
        return res.status(201).json({
          success: true,
          message: "Your message has been sent successfully.",
          data: { id: message.id, emailStatus: message.adminEmailStatus },
        });
      }
      const result = await sendEmail({
        smtp: settings.smtp,
        to: adminRecipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      message.adminEmailStatus = result.skipped ? "skipped" : "sent";
      message.adminEmailError = result.reason || "";
    } catch (error) {
      message.adminEmailStatus = "failed";
      message.adminEmailError = error.message || "Failed to send admin notification email";
    }
  }

  await message.save();
  res.status(201).json({
    success: true,
    message: "Your message has been sent successfully.",
    data: { id: message.id, emailStatus: message.adminEmailStatus },
  });
}));

router.get("/list-styles", asyncHandler(async (_req, res) => {
  const styles = await ListStyle.find({ isActive: { $ne: false } })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  res.json({
    success: true,
    data: styles.map((item) => ({
      id: String(item._id),
      name: item.name,
      key: item.key,
      category: item.category,
      listStyleType: item.listStyleType,
      markerTemplate: item.markerTemplate,
      markerSuffix: item.markerSuffix,
      startAt: item.startAt,
      levels: Array.isArray(item.levels) ? item.levels : [],
      isDefault: Boolean(item.isDefault),
      sortOrder: Number(item.sortOrder || 0),
      updatedAt: item.updatedAt,
    })),
  });
}));

router.get("/subjects/:subjectId/chapters", asyncHandler(async (req, res) => {
  const { subjectId } = req.params;
  assertObjectId(subjectId, "Invalid subject id");

  const chapters = await Chapter.find({ subjectId }).sort({ name: 1 }).lean();
  const chapterIds = chapters.map((item) => item._id);

  const [questionRows, topicRows] = await Promise.all([
    chapterIds.length
      ? Question.aggregate([
          { $match: publicQuestionFilter({ chapterId: { $in: chapterIds } }) },
          { $group: { _id: { chapterId: "$chapterId", difficulty: "$difficulty" }, count: { $sum: 1 } } },
        ])
      : [],
    chapterIds.length
      ? Topic.aggregate([{ $match: { chapterId: { $in: chapterIds } } }, { $group: { _id: "$chapterId", count: { $sum: 1 } } }])
      : [],
  ]);

  const topicCountMap = new Map(topicRows.map((item) => [String(item._id), Number(item.count || 0)]));
  const statsMap = new Map();
  questionRows.forEach((item) => {
    const key = String(item._id.chapterId);
    const difficulty = normalizeDifficulty(item._id.difficulty);
    const existing = statsMap.get(key) || { easy: 0, medium: 0, hard: 0, mixed: 0 };
    if (difficulty === "easy") existing.easy += Number(item.count || 0);
    else if (difficulty === "hard") existing.hard += Number(item.count || 0);
    else existing.medium += Number(item.count || 0);
    existing.mixed += Number(item.count || 0);
    statsMap.set(key, existing);
  });

  res.json({
    success: true,
    data: chapters.map((item) => {
      const stats = statsMap.get(String(item._id)) || { easy: 0, medium: 0, hard: 0, mixed: 0 };
      return {
        id: String(item._id),
        subjectId: String(item.subjectId),
        name: item.name,
        questionsCount: stats.mixed,
        topicsCount: topicCountMap.get(String(item._id)) || 0,
        iconUrl: item.iconUrl || "",
        imageUrl: item.imageUrl || "",
        difficultyCounts: stats,
      };
    }),
  });
}));

router.get("/chapters/:chapterId/topics", asyncHandler(async (req, res) => {
  const { chapterId } = req.params;
  assertObjectId(chapterId, "Invalid chapter id");

  const [topics, questionRows] = await Promise.all([
    Topic.find({ chapterId }).sort({ name: 1 }).lean(),
    Question.aggregate([{ $match: publicQuestionFilter({ chapterId: objectId(chapterId) }) }, { $group: { _id: "$topicId", count: { $sum: 1 } } }]),
  ]);

  const questionCountMap = new Map(questionRows.map((item) => [String(item._id), Number(item.count || 0)]));
  res.json({
    success: true,
    data: topics.map((item) => ({
      id: String(item._id),
      name: item.name,
      chapterId: String(item.chapterId),
      subjectId: String(item.subjectId),
      questionsCount: questionCountMap.get(String(item._id)) || 0,
    })),
  });
}));

router.post("/tests/generate", asyncHandler(async (req, res) => {
  const payload = testGenerateSchema.parse(req.body || {});
  const chapterId = payload.chapterId || payload.chapterIds?.[0];
  const requestedSelectionMode = payload.selectionMode || payload.testMode;
  const selectionMode = requestedSelectionMode || (payload.topicIds?.length ? "manual" : "automatic");
  const requestedTopicIds = (payload.topicIds || []).filter((item) => mongoose.isValidObjectId(item));
  const mode = String(payload.mode || "").trim().toLowerCase();

  const match = publicQuestionFilter();
  let chapter = null;
  let topicIds = [];
  let origin = selectionMode === "manual" ? "practice_filter_manual" : "practice_filter_auto";
  let title = selectionMode === "manual" ? "Custom Topic Practice Test" : "Auto Chapter Practice Test";

  if (chapterId) {
    assertObjectId(chapterId, "Invalid chapter id");
    chapter = await Chapter.findById(chapterId).lean();
    if (!chapter) throw new AppError("Selected chapter was not found", 404);

    if (selectionMode === "manual") {
      if (!requestedTopicIds.length) throw new AppError("Select at least one topic for manual mode", 400);
      topicIds = requestedTopicIds;
    } else {
      const autoTopics = await Topic.find({ chapterId }).select("_id").lean();
      topicIds = autoTopics.map((item) => String(item._id));
    }

    if (!topicIds.length) {
      throw new AppError("No topics found under this chapter", 400);
    }

    match.chapterId = objectId(chapterId);
    match.topicId = { $in: topicIds.map((item) => objectId(item)) };
    if (payload.subjectId && mongoose.isValidObjectId(payload.subjectId)) {
      match.subjectId = objectId(payload.subjectId);
    }
  } else if (mode === "smart") {
    const examPattern = String(payload.examPattern || "").trim().toUpperCase();
    if (examPattern === "NEET") {
      match.examMode = { $in: ["NEET", "BOTH"] };
    } else if (examPattern === "JEE") {
      match.examMode = { $in: ["JEE", "BOTH"] };
    }
    if (Array.isArray(payload.subjectIds) && payload.subjectIds.length) {
      const subjectIds = payload.subjectIds.filter((item) => mongoose.isValidObjectId(item)).map((item) => objectId(item));
      if (subjectIds.length) match.subjectId = { $in: subjectIds };
    }
    origin = "smart_test";
    title = "Smart Adaptive Test";
  } else {
    throw new AppError("chapterId is required for practice generation", 400);
  }

  if (payload.subjectId && mongoose.isValidObjectId(payload.subjectId) && !match.subjectId) {
    match.subjectId = objectId(payload.subjectId);
  }
  const difficulty = normalizeDifficulty(payload.difficulty);
  if (difficulty && difficulty !== "mixed") {
    match.difficulty = difficulty;
  }

  const availableQuestions = await Question.countDocuments(match);
  if (availableQuestions === 0) {
    throw new AppError("No questions found for this chapter/topic selection", 404);
  }

  const requestedCount = Number(payload.questionCount || 20);
  const finalCount = Math.max(1, Math.min(requestedCount, availableQuestions));
  const sessionId = new mongoose.Types.ObjectId().toString();

  const questions = await Question.aggregate([
    { $match: match },
    { $sample: { size: finalCount } },
    { $lookup: { from: "subjects", localField: "subjectId", foreignField: "_id", as: "subjectRef" } },
    { $lookup: { from: "chapters", localField: "chapterId", foreignField: "_id", as: "chapterRef" } },
    { $lookup: { from: "topics", localField: "topicId", foreignField: "_id", as: "topicRef" } },
    { $lookup: { from: "questiontypes", localField: "questionTypeId", foreignField: "_id", as: "questionTypeRef" } },
    {
      $project: {
        id: { $toString: "$_id" },
        _id: 0,
        question: 1,
        questionImageUrl: 1,
        optionA: 1,
        optionAImageUrl: 1,
        optionB: 1,
        optionBImageUrl: 1,
        optionC: 1,
        optionCImageUrl: 1,
        optionD: 1,
        optionDImageUrl: 1,
        correctOption: 1,
        correctOptions: 1,
        explanation: 1,
        numericAnswer: 1,
        passage: 1,
        responseType: 1,
        questionTypeId: { $toString: "$questionTypeId" },
        questionType: { $ifNull: [{ $arrayElemAt: ["$questionTypeRef.key", 0] }, { $arrayElemAt: ["$questionTypeRef.name", 0] }] },
        questionTypeLabel: { $ifNull: [{ $arrayElemAt: ["$questionTypeRef.name", 0] }, { $arrayElemAt: ["$questionTypeRef.label", 0] }] },
        displayVariant: { $arrayElemAt: ["$questionTypeRef.displayVariant", 0] },
        difficulty: 1,
        examMode: 1,
        exam: 1,
        subjectId: { $toString: "$subjectId" },
        chapterId: { $toString: "$chapterId" },
        topicId: { $toString: "$topicId" },
        subjectName: { $ifNull: [{ $arrayElemAt: ["$subjectRef.name", 0] }, "Subject"] },
        chapterName: { $ifNull: [{ $arrayElemAt: ["$chapterRef.name", 0] }, "Chapter"] },
        topicName: { $ifNull: [{ $arrayElemAt: ["$topicRef.name", 0] }, "Topic"] },
      },
    },
  ]);

  res.json({
    sessionId,
    id: sessionId,
    mode: mode || "practice",
    origin,
    title,
    selectionMode,
    chapterId: chapter ? String(chapter._id) : null,
    topicIds,
    requestedQuestions: requestedCount,
    availableQuestions,
    totalQuestions: questions.length,
    submitPath: `/api/tests/${sessionId}/submit`,
    questions,
  });
}));

router.post("/tests/:sessionId/submit", asyncHandler(async (req, res) => {
  const payload = testSubmitSchema.parse(req.body || {});
  const answers = payload.answers || [];
  const questionIds = [...new Set(answers.map((item) => String(item.questionId)).filter((item) => mongoose.isValidObjectId(item)))];
  if (!questionIds.length) {
    throw new AppError("No valid answers submitted", 400);
  }

  const questions = await Question.find(publicQuestionFilter({ _id: { $in: questionIds.map((item) => objectId(item)) } }))
    .select("_id subjectId chapterId topicId correctOption correctOptions numericAnswer responseType")
    .populate("subjectId", "name")
    .populate("chapterId", "name")
    .populate("topicId", "name")
    .lean();

  const questionMap = new Map(questions.map((item) => [String(item._id), item]));

  let correctCount = 0;
  let incorrectCount = 0;
  let skippedCount = 0;
  const topicAccumulator = new Map();

  answers.forEach((answer) => {
    const question = questionMap.get(String(answer.questionId));
    if (!question) return;

    const skipped = Boolean(answer.skipped);
    const isCorrect = skipped ? false : isAnswerCorrect(question, answer);
    if (skipped) skippedCount += 1;
    else if (isCorrect) correctCount += 1;
    else incorrectCount += 1;

    const topicKey = String(question.topicId?._id || question.topicId || "");
    const topicRow = topicAccumulator.get(topicKey) || {
      subjectId: String(question.subjectId?._id || question.subjectId || ""),
      subjectName: question.subjectId?.name || "Subject",
      chapterId: String(question.chapterId?._id || question.chapterId || ""),
      chapterName: question.chapterId?.name || "Chapter",
      topicId: String(question.topicId?._id || question.topicId || ""),
      topicName: question.topicId?.name || "Topic",
      attempted: 0,
      correct: 0,
    };
    if (!skipped) {
      topicRow.attempted += 1;
      if (isCorrect) topicRow.correct += 1;
    }
    topicAccumulator.set(topicKey, topicRow);
  });

  const totalQuestions = answers.length;
  const score = correctCount * 4 - incorrectCount;
  const maxScore = totalQuestions * 4;
  const attempted = totalQuestions - skippedCount;
  const accuracy = attempted > 0 ? (correctCount / attempted) * 100 : 0;

  const topicBreakdown = [...topicAccumulator.values()].map((item) => ({
    ...item,
    accuracy: item.attempted > 0 ? (item.correct / item.attempted) * 100 : 0,
  }));

  res.json({
    score,
    maxScore,
    totalQuestions,
    correctCount,
    incorrectCount,
    skippedCount,
    accuracy: Math.round(accuracy * 100) / 100,
    timeTaken: Number(payload.timeTaken || 0),
    completionStatus: "Completed",
    topicBreakdown,
  });
}));

router.post("/notifications/register-token", requireAppUser, asyncHandler(async (req, res) => {
  const payload = pushTokenSchema.parse(req.body || {});
  const user = req.appUser;
  const userId = String(user._id);

  const tokenDoc = await PushDeviceToken.findOneAndUpdate(
    { token: payload.token },
    {
      $set: {
        userId,
        platform: payload.platform,
        mode: payload.mode || user.examMode || "",
        subscriptionType: user.isPremium ? "premium" : "free",
        deviceId: payload.deviceId,
        appVersion: payload.appVersion,
        enabled: true,
        active: true,
        lastSeenAt: new Date(),
        lastUpdated: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.json({
    success: true,
    message: "Push token registered",
    data: { id: String(tokenDoc._id), token: tokenDoc.token, platform: tokenDoc.platform },
  });
}));

router.delete("/notifications/remove-token", requireAppUser, asyncHandler(async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) throw new AppError("Push token is required", 400);

  await PushDeviceToken.updateOne(
    { token, userId: String(req.appUser._id) },
    { $set: { enabled: false, active: false, lastUpdated: new Date() } },
  );

  res.json({ success: true, message: "Push token removed" });
}));

export default router;
