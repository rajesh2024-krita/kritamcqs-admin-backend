import mongoose from "mongoose";
import {
  Chapter,
  ChapterPerformance,
  Mistake,
  Question,
  QuestionAttempt,
  SessionAttempt,
  Subject,
  Subscription,
  User,
  Year,
  QuestionType,
} from "../models/index.js";
import { AppError } from "../utils/AppError.js";

function ensureObjectId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError("Invalid user id", 400);
  }
}

function average(items, key) {
  const values = items.map((item) => Number(item[key] || 0)).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function makeMap(list) {
  return new Map(list.map((item) => [String(item._id), item]));
}

function normalizeRevisionQuestion(item, subjectMap, chapterMap) {
  if (!item) return null;
  const subject = subjectMap.get(String(item.subjectId));
  const chapter = chapterMap.get(String(item.chapterId));
  return {
    id: String(item._id),
    question: item.question || "Question unavailable",
    subjectName: subject?.name || "-",
    chapterName: chapter?.name || "-",
    difficulty: item.difficulty || null,
    examMode: item.examMode || null,
  };
}

export const userInsightsService = {
  async getOverview(userId) {
    ensureObjectId(userId);
    const user = await User.findById(userId);
    if (!user) throw new AppError("User not found", 404);

    const id = String(user._id);

    const [
      sessionAttempts,
      questionAttempts,
      subscriptions,
      mistakes,
      weakAreas,
      subjects,
      chapters,
      questions,
      years,
      questionTypes,
    ] = await Promise.all([
      SessionAttempt.find({ userId: id }).sort({ createdAt: -1 }).limit(30),
      QuestionAttempt.find({ userId: id }).sort({ createdAt: -1 }).limit(40),
      Subscription.find({ userId: id }).sort({ createdAt: -1 }),
      Mistake.find({ userId: id }).sort({ updatedAt: -1 }).limit(30),
      ChapterPerformance.find({ userId: id }).sort({ accuracy: 1, updatedAt: -1 }).limit(20),
      Subject.find(),
      Chapter.find(),
      Question.find().select("_id question subjectId chapterId yearId questionTypeId difficulty responseType examMode exam"),
      Year.find(),
      QuestionType.find(),
    ]);

    const subjectMap = makeMap(subjects);
    const chapterMap = makeMap(chapters);
    const questionMap = makeMap(questions);
    const yearMap = makeMap(years);
    const questionTypeMap = makeMap(questionTypes);

    const mistakeSummary = {
      total: mistakes.length,
      weak: mistakes.filter((item) => item.status === "weak").length,
      improving: mistakes.filter((item) => item.status === "improving").length,
      fresh: mistakes.filter((item) => item.status === "new").length,
    };

    const activeSubscription =
      subscriptions.find((item) => item.status === "active") ||
      subscriptions.find((item) => item.endDate && new Date(item.endDate) > new Date()) ||
      null;

    const reports = sessionAttempts.map((attempt) => ({
      ...attempt.toJSON(),
      attendanceStatus: attempt.completedAt ? "completed" : "started",
    }));

    const submissions = questionAttempts.map((attempt) => {
      const question = questionMap.get(String(attempt.questionId));
      const subject = subjectMap.get(String(attempt.subjectId || question?.subjectId));
      const chapter = chapterMap.get(String(attempt.chapterId || question?.chapterId));
      const year = yearMap.get(String(attempt.yearId || question?.yearId));
      const questionType = questionTypeMap.get(String(attempt.questionTypeId || question?.questionTypeId));

      return {
        ...attempt.toJSON(),
        question: question?.question || "Question unavailable",
        subjectName: subject?.name || "-",
        chapterName: chapter?.name || "-",
        yearLabel: year?.name || "-",
        questionTypeLabel: questionType?.label || "-",
      };
    });

    const enrichedMistakes = mistakes.map((mistake) => {
      const question = questionMap.get(String(mistake.questionId));
      const chapter = chapterMap.get(String(question?.chapterId));
      const subject = subjectMap.get(String(question?.subjectId));
      return {
        ...mistake.toJSON(),
        question: question?.question || "Question unavailable",
        chapterName: chapter?.name || "-",
        subjectName: subject?.name || "-",
      };
    });

    const enrichedWeakAreas = weakAreas.map((area) => {
      const chapter = chapterMap.get(String(area.chapterId));
      const subject = subjectMap.get(String(area.subjectId));
      return {
        ...area.toJSON(),
        chapterName: chapter?.name || "-",
        subjectName: subject?.name || "-",
      };
    });

    const performance = {
      attendanceCount: sessionAttempts.length,
      reportCount: sessionAttempts.filter((item) => item.completedAt).length,
      submissionCount: questionAttempts.length,
      averageScore: average(sessionAttempts, "score"),
      averageAccuracy: average(sessionAttempts, "accuracy"),
      averageTimeTaken: average(sessionAttempts, "timeTaken"),
      latestActivityAt:
        sessionAttempts[0]?.createdAt ||
        questionAttempts[0]?.createdAt ||
        mistakes[0]?.updatedAt ||
        user.updatedAt,
    };

    const solvedQuestionsFromReports = sessionAttempts.reduce(
      (total, attempt) => total + Number(attempt.totalQuestions || 0),
      0,
    );
    const revisionPendingCount = user.onboardingComplete
      ? Math.min(15, Math.max(weakAreas.length * 3, Math.floor(solvedQuestionsFromReports * 0.15)))
      : 0;

    let wrongRevisionQuestions = [];
    let oldCorrectRevisionQuestions = [];

    if (user.isPremium) {
      const mistakeEntries = await Mistake.find({ userId: id }).sort({ lastAttemptDate: -1 }).limit(10);
      wrongRevisionQuestions = mistakeEntries
        .map((entry) => questionMap.get(String(entry.questionId)))
        .filter(Boolean)
        .map((question) => normalizeRevisionQuestion(question, subjectMap, chapterMap))
        .filter(Boolean);

      const correctAttemptQuestionIds = await QuestionAttempt.find({ userId: id, isCorrect: true })
        .sort({ createdAt: 1 })
        .limit(5)
        .distinct("questionId");

      oldCorrectRevisionQuestions = correctAttemptQuestionIds
        .map((questionId) => questionMap.get(String(questionId)))
        .filter(Boolean)
        .map((question) => normalizeRevisionQuestion(question, subjectMap, chapterMap))
        .filter(Boolean);
    }

    const revisionTotalCount = user.isPremium
      ? wrongRevisionQuestions.length + oldCorrectRevisionQuestions.length
      : null;

    return {
      profile: user.toJSON(),
      performance,
      subscriptionSummary: {
        totalSubscriptions: subscriptions.length,
        activeSubscription,
        history: subscriptions.map((item) => item.toJSON()),
      },
      mistakeSummary,
      reports,
      submissions,
      mistakes: enrichedMistakes,
      weakAreas: enrichedWeakAreas,
      revisionSummary: {
        isPremiumEnabled: Boolean(user.isPremium),
        wrongQuestions: wrongRevisionQuestions,
        oldCorrectQuestions: oldCorrectRevisionQuestions,
        wrongQuestionCount: wrongRevisionQuestions.length,
        oldCorrectQuestionCount: oldCorrectRevisionQuestions.length,
        totalCount: revisionTotalCount,
        revisionPendingCount,
      },
    };
  },
};
