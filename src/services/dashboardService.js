import { Chapter, ChapterPerformance, DailyAssignment, ExamType, LearningSession, Mistake, Mode, Question, QuestionAttempt, QuestionType, SessionAttempt, Subject, Subscription, Test, User, Year } from "../models/index.js";

function normalizeModeKey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "NEET" || normalized === "JEE" || normalized === "BOTH") return normalized;
  return "ALL";
}

function normalizePeriod(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["day", "week", "month", "year"].includes(normalized)) return normalized;
  return "week";
}

function getPeriodWindow(period, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (period === "day") start.setDate(start.getDate() - 0);
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(start.getDate() - 29);
  if (period === "year") start.setDate(start.getDate() - 364);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildAccuracyRange(accuracy) {
  const safeAccuracy = Number(accuracy || 0);
  if (safeAccuracy >= 80) return "Strong";
  if (safeAccuracy >= 60) return "Progressing";
  if (safeAccuracy >= 40) return "Developing";
  return "At Risk";
}

async function buildSummaryForPeriod(period, modeKey = "ALL") {
  const { start, end } = getPeriodWindow(period);
  const filters = {
    dateKey: { $gte: toDateKey(start), $lte: toDateKey(end) },
  };
  if (modeKey !== "ALL") filters.modeKey = modeKey;

  const assignmentSummary = await DailyAssignment.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        totalAssignments: { $sum: 1 },
        assignedQuestions: { $sum: "$assignedCount" },
        completedQuestions: { $sum: "$completedCount" },
        assignedUsersSet: { $addToSet: "$userId" },
        attendedUsersSet: {
          $addToSet: {
            $cond: [{ $gt: ["$completedCount", 0] }, "$userId", "$$REMOVE"],
          },
        },
      },
    },
  ]);

  const data = assignmentSummary[0] || {};
  const assignedUsers = Array.isArray(data.assignedUsersSet) ? data.assignedUsersSet.length : 0;
  const attendedUsers = Array.isArray(data.attendedUsersSet) ? data.attendedUsersSet.length : 0;
  const assignedQuestions = Number(data.assignedQuestions || 0);
  const completedQuestions = Number(data.completedQuestions || 0);

  return {
    period,
    assignedUsers,
    attendedUsers,
    totalAssignments: Number(data.totalAssignments || 0),
    assignedQuestions,
    completedQuestions,
    attendanceRate: assignedUsers > 0 ? Number(((attendedUsers / assignedUsers) * 100).toFixed(2)) : 0,
    completionRate: assignedQuestions > 0 ? Number(((completedQuestions / assignedQuestions) * 100).toFixed(2)) : 0,
  };
}

export const dashboardService = {
  async getStats() {
    const [
      totalUsers,
      premiumUsers,
      totalQuestions,
      totalSubjects,
      totalChapters,
      totalSessions,
      totalTests,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isPremium: true }),
      Question.countDocuments(),
      Subject.countDocuments(),
      Chapter.countDocuments(),
      LearningSession.countDocuments(),
      Test.countDocuments(),
    ]);

    return {
      totalUsers,
      premiumUsers,
      totalQuestions,
      totalSubjects,
      totalChapters,
      totalSessions,
      totalTests,
    };
  },

  async getDashboard() {
    const [stats, recentUsers, recentQuestions, recentSessions, totalReports, totalSubmissions, totalSubscriptions, totalMistakes, totalWeakAreas] = await Promise.all([
      this.getStats(),
      User.find().sort({ createdAt: -1 }).limit(5),
      Question.find().populate(["subjectId", "chapterId", "yearId", "questionTypeId"]).sort({ createdAt: -1 }).limit(5),
      LearningSession.find().populate("userId").sort({ createdAt: -1 }).limit(5),
      SessionAttempt.countDocuments(),
      QuestionAttempt.countDocuments(),
      Subscription.countDocuments(),
      Mistake.countDocuments(),
      ChapterPerformance.countDocuments({ isWeak: true }),
    ]);

    return {
      ...stats,
      userDataSummary: {
        totalReports,
        totalSubmissions,
        totalSubscriptions,
        totalMistakes,
        totalWeakAreas,
      },
      recentActivity: {
        users: recentUsers,
        questions: recentQuestions,
        sessions: recentSessions,
      },
    };
  },

  async getCatalogOverview() {
    const [modes, examTypes, subjects, chapters, years, questionTypes, questions] = await Promise.all([
      Mode.countDocuments(),
      ExamType.countDocuments(),
      Subject.countDocuments(),
      Chapter.countDocuments(),
      Year.countDocuments(),
      QuestionType.countDocuments(),
      Question.countDocuments(),
    ]);

    return { modes, examTypes, subjects, chapters, years, questionTypes, questions };
  },

  async getDailyTestAnalytics(query = {}) {
    const modeKey = normalizeModeKey(query.modeKey);
    const period = normalizePeriod(query.period);
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 10), 1), 50);
    const search = String(query.search || "").trim();

    const summaryByPeriodEntries = await Promise.all([
      buildSummaryForPeriod("day", modeKey),
      buildSummaryForPeriod("week", modeKey),
      buildSummaryForPeriod("month", modeKey),
      buildSummaryForPeriod("year", modeKey),
    ]);
    const summaryByPeriod = Object.fromEntries(summaryByPeriodEntries.map((item) => [item.period, item]));

    const { start, end } = getPeriodWindow(period);
    const startKey = toDateKey(start);
    const endKey = toDateKey(end);
    const assignmentFilters = { dateKey: { $gte: startKey, $lte: endKey } };
    if (modeKey !== "ALL") assignmentFilters.modeKey = modeKey;

    const trend = await DailyAssignment.aggregate([
      { $match: assignmentFilters },
      {
        $group: {
          _id: "$dateKey",
          assignedUsersSet: { $addToSet: "$userId" },
          attendedUsersSet: {
            $addToSet: {
              $cond: [{ $gt: ["$completedCount", 0] }, "$userId", "$$REMOVE"],
            },
          },
          assignedQuestions: { $sum: "$assignedCount" },
          completedQuestions: { $sum: "$completedCount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailySessionLookupMatch = {
      $expr: { $eq: [{ $toString: "$_id" }, "$$sessionId"] },
      origin: "daily_set",
    };
    if (modeKey !== "ALL") {
      dailySessionLookupMatch.modeKey = modeKey;
    }

    const baseAttemptMatch = {
      completedAt: { $gte: start, $lte: end },
    };

    let eligibleUserIds = null;
    if (search) {
      const users = await User.find({
        $or: [
          { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          { mobile: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        ],
      })
        .select("_id")
        .lean();
      eligibleUserIds = users.map((item) => String(item._id));
      if (!eligibleUserIds.length) {
        return {
          modeKey,
          period,
          summaryByPeriod,
          trend: trend.map((item) => ({
            dateKey: item._id,
            assignedUsers: item.assignedUsersSet?.length || 0,
            attendedUsers: item.attendedUsersSet?.length || 0,
            assignedQuestions: Number(item.assignedQuestions || 0),
            completedQuestions: Number(item.completedQuestions || 0),
          })),
          predictionRanges: [],
          userHistory: {
            data: [],
            meta: { page, limit, total: 0, totalPages: 1 },
          },
        };
      }
    }

    const attemptMatch = { ...baseAttemptMatch };
    if (eligibleUserIds) attemptMatch.userId = { $in: eligibleUserIds };

    const attemptPipelineBase = [
      { $match: attemptMatch },
      {
        $lookup: {
          from: "learningsessions",
          let: { sessionId: "$sessionId" },
          pipeline: [{ $match: dailySessionLookupMatch }],
          as: "dailySession",
        },
      },
      { $match: { "dailySession.0": { $exists: true } } },
    ];

    const groupedAttempts = await SessionAttempt.aggregate([
      ...attemptPipelineBase,
      {
        $group: {
          _id: "$userId",
          totalAttempts: { $sum: 1 },
          avgScore: { $avg: "$score" },
          avgAccuracy: { $avg: "$accuracy" },
          bestScore: { $max: "$score" },
          latestCompletedAt: { $max: "$completedAt" },
        },
      },
      { $sort: { totalAttempts: -1, latestCompletedAt: -1 } },
    ]);

    const total = groupedAttempts.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pagedGrouped = groupedAttempts.slice((page - 1) * limit, page * limit);
    const userIds = pagedGrouped.map((item) => String(item._id));
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select("_id name email mobile examMode isPremium").lean()
      : [];
    const userMap = new Map(users.map((item) => [String(item._id), item]));

    const predictionRangesMap = new Map();
    groupedAttempts.forEach((item) => {
      const key = buildAccuracyRange(item.avgAccuracy);
      predictionRangesMap.set(key, Number(predictionRangesMap.get(key) || 0) + 1);
    });
    const predictionRanges = ["Strong", "Progressing", "Developing", "At Risk"].map((key) => ({
      key,
      count: Number(predictionRangesMap.get(key) || 0),
    }));

    return {
      modeKey,
      period,
      summaryByPeriod,
      trend: trend.map((item) => ({
        dateKey: item._id,
        assignedUsers: item.assignedUsersSet?.length || 0,
        attendedUsers: item.attendedUsersSet?.length || 0,
        assignedQuestions: Number(item.assignedQuestions || 0),
        completedQuestions: Number(item.completedQuestions || 0),
      })),
      predictionRanges,
      userHistory: {
        data: pagedGrouped.map((item) => {
          const user = userMap.get(String(item._id));
          return {
            userId: String(item._id),
            name: user?.name || "-",
            email: user?.email || "",
            mobile: user?.mobile || "",
            examMode: user?.examMode || "",
            isPremium: Boolean(user?.isPremium),
            totalAttempts: Number(item.totalAttempts || 0),
            avgScore: Number((item.avgScore || 0).toFixed(2)),
            avgAccuracy: Number((item.avgAccuracy || 0).toFixed(2)),
            bestScore: Number(item.bestScore || 0),
            latestCompletedAt: item.latestCompletedAt || null,
            predictionRange: buildAccuracyRange(item.avgAccuracy),
          };
        }),
        meta: { page, limit, total, totalPages },
      },
    };
  },
};
