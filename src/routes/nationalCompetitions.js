import { Router } from "express";
import * as XLSX from "xlsx";
import {
  NationalCompetition,
  NationalCompetitionAttempt,
  NationalCompetitionAuditLog,
  NationalCompetitionNotification,
  NationalCompetitionRegistration,
  NationalCompetitionReward,
  NationalLeaderboardEntry,
  Chapter,
  Difficulty,
  Question,
  QuestionType,
  Subject,
  Topic,
  User,
  Year,
} from "../models/index.js";
import { requireAdmin, requireModulePermission } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { competitionSummary, refreshAdminLeaderboards, slugifyCompetition } from "../services/nationalLeaderboardAdminService.js";

export const nationalCompetitionsAdminRouter = Router();
nationalCompetitionsAdminRouter.use(requireAdmin);

function arrayFromInput(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function buildQuestionPoolFilter(filters = {}) {
  const query = {};
  const search = String(filters.search || "").trim();
  const exactFields = ["subjectId", "chapterId", "topicId", "yearId", "difficultyId", "questionTypeId", "difficulty", "responseType", "questionStatus", "reviewStatus"];
  exactFields.forEach((field) => {
    if (filters[field]) query[field] = String(filters[field]);
  });
  if (filters.examType && filters.examType !== "BOTH") {
    query.$or = [
      { examMode: String(filters.examType) },
      { exam: String(filters.examType) === "JEE" ? { $in: ["JEE_MAIN", "JEE_ADVANCED"] } : String(filters.examType) },
    ];
  }
  if (filters.visibleOnly !== false) query.isVisibleToUsers = true;
  if (search) {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { question: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          { conceptTags: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        ],
      },
    ];
  }
  return query;
}

async function selectAutomaticQuestions(selection = {}, fallbackExamType = "BOTH") {
  const filters = { ...(selection.filters || {}), examType: selection.filters?.examType || fallbackExamType };
  const targetCount = Math.max(1, Number(selection.targetCount || 0));
  const query = buildQuestionPoolFilter(filters);
  const questions = await Question.find(query)
    .select("_id")
    .sort({ reviewStatus: 1, questionStatus: 1, updatedAt: -1, createdAt: -1 })
    .limit(targetCount);
  if (questions.length < targetCount) {
    throw new AppError(`Only ${questions.length} questions matched automatic filters. Required ${targetCount}.`, 400);
  }
  return questions.map((item) => String(item._id));
}

async function sanitizeCompetitionPayload(body = {}, adminId = "") {
  const title = String(body.title || "").trim();
  if (!title) throw new AppError("Competition title is required", 400);
  const startsAt = new Date(body.startsAt || Date.now() + 86400000);
  const durationMinutes = Math.max(1, Number(body.durationMinutes || 180));
  const examType = ["NEET", "JEE", "BOTH"].includes(body.examType) ? body.examType : "BOTH";
  const selectionMode = body.questionSelection?.mode === "automatic" ? "automatic" : "manual";
  const selectionFilters = body.questionSelection?.filters || {};
  const manualQuestionIds = arrayFromInput(body.questionIds);
  const automaticTargetCount = Math.max(1, Number(body.questionSelection?.targetCount || body.totalQuestions || 180));
  const questionIds = selectionMode === "automatic"
    ? await selectAutomaticQuestions({ filters: selectionFilters, targetCount: automaticTargetCount }, examType)
    : manualQuestionIds;
  return {
    title,
    slug: slugifyCompetition(body.slug || title),
    description: String(body.description || ""),
    examType,
    status: body.status || "draft",
    registrationOpensAt: new Date(body.registrationOpensAt || Date.now()),
    registrationClosesAt: new Date(body.registrationClosesAt || startsAt.getTime() - 3600000),
    startsAt,
    endsAt: new Date(body.endsAt || startsAt.getTime() + durationMinutes * 60000),
    durationMinutes,
    totalQuestions: Math.max(1, Number(body.totalQuestions || questionIds.length || 180)),
    marksPerQuestion: Number(body.marksPerQuestion || 4),
    negativeMarks: Number(body.negativeMarks || 1),
    questionIds,
    questionSelection: {
      mode: selectionMode,
      filters: selectionFilters,
      targetCount: selectionMode === "automatic" ? automaticTargetCount : questionIds.length,
      lastGeneratedAt: selectionMode === "automatic" ? new Date() : undefined,
    },
    rules: Array.isArray(body.rules) ? body.rules.map(String).filter(Boolean) : [],
    rewardsSummary: String(body.rewardsSummary || ""),
    terms: String(body.terms || ""),
    eligibility: {
      premiumRequired: Boolean(body.eligibility?.premiumRequired),
      allowedStates: Array.isArray(body.eligibility?.allowedStates) ? body.eligibility.allowedStates.map(String).filter(Boolean) : [],
      allowedDistricts: Array.isArray(body.eligibility?.allowedDistricts) ? body.eligibility.allowedDistricts.map(String).filter(Boolean) : [],
      participantLimit: Math.max(0, Number(body.eligibility?.participantLimit || 0)),
      approvalRequired: Boolean(body.eligibility?.approvalRequired),
    },
    leaderboard: {
      enabled: body.leaderboard?.enabled !== false,
      refreshSeconds: Math.max(5, Number(body.leaderboard?.refreshSeconds || 30)),
      rankingPriority: Array.isArray(body.leaderboard?.rankingPriority) ? body.leaderboard.rankingPriority.map(String) : undefined,
      rankingWeights: body.leaderboard?.rankingWeights || {},
      publishWeekly: body.leaderboard?.publishWeekly !== false,
      publishMonthly: body.leaderboard?.publishMonthly !== false,
    },
    security: {
      oneAttemptOnly: body.security?.oneAttemptOnly !== false,
      deviceValidation: body.security?.deviceValidation !== false,
      duplicateLoginDetection: body.security?.duplicateLoginDetection !== false,
      autosaveIntervalSeconds: Math.max(5, Number(body.security?.autosaveIntervalSeconds || 20)),
    },
    notificationEvents: Array.isArray(body.notificationEvents) ? body.notificationEvents.map(String).filter(Boolean) : [],
    isActive: body.isActive !== false,
    updatedBy: adminId,
  };
}

async function audit(req, action, competitionId, metadata = {}) {
  await NationalCompetitionAuditLog.create({
    competitionId: competitionId || "",
    actorId: String(req.admin?._id || ""),
    actorRole: "admin",
    action,
    metadata,
    ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
  });
}

nationalCompetitionsAdminRouter.get(
  "/national-competitions/question-pool/meta",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (_req, res) => {
    const [subjects, chapters, topics, years, difficulties, questionTypes] = await Promise.all([
      Subject.find({}).select("_id name examType examMode").sort({ name: 1 }).limit(1000),
      Chapter.find({}).select("_id name subjectId").sort({ name: 1 }).limit(2000),
      Topic.find({}).select("_id name chapterId").sort({ name: 1 }).limit(3000),
      Year.find({}).select("_id year label name examType").sort({ year: -1 }).limit(500),
      Difficulty.find({}).select("_id name key label").sort({ sortOrder: 1, name: 1 }),
      QuestionType.find({}).select("_id name key label responseType").sort({ name: 1 }),
    ]);
    res.json({ success: true, data: { subjects, chapters, topics, years, difficulties, questionTypes } });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/question-pool",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const filter = buildQuestionPoolFilter(req.query);
    const [items, total] = await Promise.all([
      Question.find(filter)
        .populate("subjectId", "name")
        .populate("chapterId", "name")
        .populate("topicId", "name")
        .populate("yearId", "year label name")
        .populate("difficultyId", "name key")
        .populate("questionTypeId", "name key label")
        .select("_id question subjectId chapterId topicId yearId difficulty difficultyId questionTypeId responseType exam examMode questionStatus reviewStatus isVisibleToUsers updatedAt")
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Question.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/dashboard",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (_req, res) => {
    const [summary, upcoming, live, recentLeaderboard] = await Promise.all([
      competitionSummary(),
      NationalCompetition.find({ startsAt: { $gte: new Date() }, status: { $nin: ["archived", "cancelled"] } }).sort({ startsAt: 1 }).limit(8),
      NationalCompetition.find({ status: "live" }).sort({ startsAt: -1 }).limit(5),
      NationalLeaderboardEntry.find({ scope: "national" }).sort({ updatedAt: -1, rank: 1 }).limit(10),
    ]);
    res.json({ success: true, data: { summary, upcoming, live, recentLeaderboard } });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const search = String(req.query.search || "").trim();
    const filter = {};
    if (req.query.status && req.query.status !== "all") filter.status = String(req.query.status);
    if (search) filter.$or = [{ title: new RegExp(search, "i") }, { description: new RegExp(search, "i") }];
    const [items, total] = await Promise.all([
      NationalCompetition.find(filter).sort({ startsAt: -1 }).skip((page - 1) * limit).limit(limit),
      NationalCompetition.countDocuments(filter),
    ]);
    res.json({ success: true, data: items, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  }),
);

nationalCompetitionsAdminRouter.post(
  "/national-competitions",
  requireModulePermission("national-competitions", "create"),
  asyncHandler(async (req, res) => {
    const payload = await sanitizeCompetitionPayload(req.body, String(req.admin?._id || ""));
    payload.createdBy = String(req.admin?._id || "");
    const item = await NationalCompetition.create(payload);
    await audit(req, "competition_create", String(item._id), { title: item.title });
    res.status(201).json({ success: true, data: item });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/:id",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const [competition, registrationCount, submissionCount, rewards] = await Promise.all([
      NationalCompetition.findById(req.params.id),
      NationalCompetitionRegistration.countDocuments({ competitionId: req.params.id }),
      NationalCompetitionAttempt.countDocuments({ competitionId: req.params.id, status: { $in: ["submitted", "auto_submitted"] } }),
      NationalCompetitionReward.find({ competitionId: req.params.id }).sort({ rankFrom: 1 }),
    ]);
    if (!competition) throw new AppError("Competition not found", 404);
    res.json({ success: true, data: { competition, registrationCount, submissionCount, rewards } });
  }),
);

nationalCompetitionsAdminRouter.put(
  "/national-competitions/:id",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const payload = await sanitizeCompetitionPayload(req.body, String(req.admin?._id || ""));
    const item = await NationalCompetition.findByIdAndUpdate(req.params.id, payload, { new: true });
    if (!item) throw new AppError("Competition not found", 404);
    await audit(req, "competition_update", String(item._id));
    res.json({ success: true, data: item });
  }),
);

nationalCompetitionsAdminRouter.patch(
  "/national-competitions/:id/status",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const item = await NationalCompetition.findByIdAndUpdate(req.params.id, { status: req.body.status, archivedAt: req.body.status === "archived" ? new Date() : undefined }, { new: true });
    if (!item) throw new AppError("Competition not found", 404);
    await audit(req, "competition_status", String(item._id), { status: req.body.status });
    res.json({ success: true, data: item });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/:id/participants",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || "all");
    const filter = { competitionId: req.params.id };
    if (status !== "all") filter.status = status;
    const registrations = await NationalCompetitionRegistration.find(filter).sort({ createdAt: -1 }).limit(500);
    const users = await User.find({ _id: { $in: registrations.map((item) => item.userId) } }).select("_id name email mobile isPremium").lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    res.json({ success: true, data: registrations.map((item) => ({ registration: item, user: userMap.get(String(item.userId)) || null })) });
  }),
);

nationalCompetitionsAdminRouter.patch(
  "/national-competitions/participants/:registrationId",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const status = ["pending", "approved", "rejected", "locked", "cancelled"].includes(req.body.status) ? req.body.status : "approved";
    const item = await NationalCompetitionRegistration.findByIdAndUpdate(
      req.params.registrationId,
      { status, approvedBy: String(req.admin?._id || ""), approvedAt: status === "approved" ? new Date() : undefined, lockedAt: status === "locked" ? new Date() : undefined },
      { new: true },
    );
    if (!item) throw new AppError("Registration not found", 404);
    await audit(req, "participant_status", item.competitionId, { registrationId: req.params.registrationId, status });
    res.json({ success: true, data: item });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/:id/leaderboard",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const scope = String(req.query.scope || "national");
    const entries = await NationalLeaderboardEntry.find({ competitionId: req.params.id, scope }).sort({ rank: 1 }).limit(500);
    res.json({ success: true, data: entries });
  }),
);

nationalCompetitionsAdminRouter.post(
  "/national-competitions/:id/leaderboard/refresh",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const result = await refreshAdminLeaderboards(req.params.id);
    await audit(req, "leaderboard_refresh", req.params.id, result);
    res.json({ success: true, data: result });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/:id/reports",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const [registrations, attempts, stateRows, districtRows, topPerformers] = await Promise.all([
      NationalCompetitionRegistration.countDocuments({ competitionId: req.params.id }),
      NationalCompetitionAttempt.find({ competitionId: req.params.id, status: { $in: ["submitted", "auto_submitted"] } }),
      NationalLeaderboardEntry.aggregate([{ $match: { competitionId: req.params.id, scope: "state" } }, { $group: { _id: "$state", averageMarks: { $avg: "$score" }, participants: { $sum: 1 } } }, { $sort: { averageMarks: -1 } }]),
      NationalLeaderboardEntry.aggregate([{ $match: { competitionId: req.params.id, scope: "district" } }, { $group: { _id: { state: "$state", district: "$district" }, averageMarks: { $avg: "$score" }, participants: { $sum: 1 } } }, { $sort: { averageMarks: -1 } }]),
      NationalLeaderboardEntry.find({ competitionId: req.params.id, scope: "national" }).sort({ rank: 1 }).limit(25),
    ]);
    const submitted = attempts.length;
    const averageMarks = submitted ? Math.round((attempts.reduce((sum, item) => sum + Number(item.score || 0), 0) / submitted) * 100) / 100 : 0;
    res.json({ success: true, data: { participation: { registrations, submitted, attendanceRate: registrations ? Math.round((submitted / registrations) * 10000) / 100 : 0 }, averageMarks, statePerformance: stateRows, districtPerformance: districtRows, topPerformers } });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/:id/export/:format",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const rows = await NationalLeaderboardEntry.find({ competitionId: req.params.id, scope: "national" }).sort({ rank: 1 }).lean();
    if (req.params.format === "pdf") {
      const text = rows.map((row) => `${row.rank}. ${row.userName} - ${row.score}`).join("\n");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=national-leaderboard.pdf");
      return res.end(Buffer.from(`%PDF-1.3\n1 0 obj\n<<>>\nstream\n${text}\nendstream\nendobj\n%%EOF`));
    }
    const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({ Rank: row.rank, Name: row.userName, State: row.state, District: row.district, Score: row.score, Accuracy: row.accuracy })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Leaderboard");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=national-leaderboard.xlsx");
    return res.end(buffer);
  }),
);

nationalCompetitionsAdminRouter.use(
  "/national-competitions/:competitionId/rewards",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res, next) => {
    if (req.method === "GET") {
      const rewards = await NationalCompetitionReward.find({ competitionId: req.params.competitionId }).sort({ rankFrom: 1 });
      return res.json({ success: true, data: rewards });
    }
    return next();
  }),
);

nationalCompetitionsAdminRouter.post(
  "/national-competitions/:competitionId/rewards",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const reward = await NationalCompetitionReward.create({ ...req.body, competitionId: req.params.competitionId });
    await audit(req, "reward_create", req.params.competitionId, { rewardId: String(reward._id) });
    res.status(201).json({ success: true, data: reward });
  }),
);

nationalCompetitionsAdminRouter.patch(
  "/national-competitions/rewards/:rewardId",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const reward = await NationalCompetitionReward.findByIdAndUpdate(req.params.rewardId, req.body, { new: true });
    if (!reward) throw new AppError("Reward not found", 404);
    await audit(req, "reward_update", reward.competitionId, { rewardId: req.params.rewardId });
    res.json({ success: true, data: reward });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions/:id/notifications",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const items = await NationalCompetitionNotification.find({ competitionId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: items });
  }),
);

nationalCompetitionsAdminRouter.post(
  "/national-competitions/:id/notifications",
  requireModulePermission("national-competitions", "edit"),
  asyncHandler(async (req, res) => {
    const item = await NationalCompetitionNotification.create({ ...req.body, competitionId: req.params.id });
    await audit(req, "notification_create", req.params.id, { notificationId: String(item._id) });
    res.status(201).json({ success: true, data: item });
  }),
);

nationalCompetitionsAdminRouter.get(
  "/national-competitions-audit-logs",
  requireModulePermission("national-competitions", "view"),
  asyncHandler(async (req, res) => {
    const items = await NationalCompetitionAuditLog.find(req.query.competitionId ? { competitionId: String(req.query.competitionId) } : {}).sort({ createdAt: -1 }).limit(300);
    res.json({ success: true, data: items });
  }),
);
