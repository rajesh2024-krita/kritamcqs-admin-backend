import {
  NationalCompetition,
  NationalCompetitionAttempt,
  NationalCompetitionRegistration,
  NationalLeaderboardEntry,
  User,
} from "../models/index.js";

const DEFAULT_RANKING_PRIORITY = ["marks", "negativeMarks", "totalTime", "averageTimePerQuestion", "accuracy", "submissionTime", "attendance"];

function normalizePriority(priority = []) {
  const configured = Array.isArray(priority) ? priority.filter((item) => DEFAULT_RANKING_PRIORITY.includes(item)) : [];
  return [...configured, ...DEFAULT_RANKING_PRIORITY.filter((item) => !configured.includes(item))];
}

function compareAttempts(a, b, priority) {
  for (const key of priority) {
    if (key === "marks" && Number(b.score) !== Number(a.score)) return Number(b.score) - Number(a.score);
    if (key === "negativeMarks" && Number(a.negativeMarksApplied) !== Number(b.negativeMarksApplied)) return Number(a.negativeMarksApplied) - Number(b.negativeMarksApplied);
    if (key === "totalTime" && Number(a.totalTimeSeconds) !== Number(b.totalTimeSeconds)) return Number(a.totalTimeSeconds) - Number(b.totalTimeSeconds);
    if (key === "averageTimePerQuestion" && Number(a.averageTimePerQuestion) !== Number(b.averageTimePerQuestion)) return Number(a.averageTimePerQuestion) - Number(b.averageTimePerQuestion);
    if (key === "accuracy" && Number(b.accuracy) !== Number(a.accuracy)) return Number(b.accuracy) - Number(a.accuracy);
    if (key === "submissionTime") {
      const aTime = new Date(a.submittedAt || a.autoSubmittedAt || a.updatedAt || 0).getTime();
      const bTime = new Date(b.submittedAt || b.autoSubmittedAt || b.updatedAt || 0).getTime();
      if (aTime !== bTime) return aTime - bTime;
    }
    if (key === "attendance") {
      const aAttendance = a.startedAt ? 1 : 0;
      const bAttendance = b.startedAt ? 1 : 0;
      if (aAttendance !== bAttendance) return bAttendance - aAttendance;
    }
  }
  return String(a.userId).localeCompare(String(b.userId));
}

export function slugifyCompetition(value) {
  return String(value || "competition")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function refreshAdminLeaderboards(competitionId) {
  const competition = await NationalCompetition.findById(competitionId);
  if (!competition) throw new Error("Competition not found");
  const attempts = await NationalCompetitionAttempt.find({ competitionId: String(competition._id), status: { $in: ["submitted", "auto_submitted"] } }).lean();
  const registrations = await NationalCompetitionRegistration.find({ competitionId: String(competition._id) }).lean();
  const users = await User.find({ _id: { $in: attempts.map((attempt) => attempt.userId) } }).select("_id name email mobile").lean();
  const registrationMap = new Map(registrations.map((item) => [String(item.userId), item]));
  const userMap = new Map(users.map((item) => [String(item._id), item]));
  const priority = normalizePriority(competition.leaderboard?.rankingPriority);
  const scopes = ["national", "state", "district", "weekly", "monthly", competition.status === "archived" ? "archived" : null].filter(Boolean);
  const writes = [];

  for (const scope of scopes) {
    const groups = new Map();
    attempts.forEach((attempt) => {
      const registration = registrationMap.get(String(attempt.userId));
      const groupKey = scope === "state" ? registration?.state || "" : scope === "district" ? `${registration?.state || ""}:${registration?.district || ""}` : "all";
      if ((scope === "state" || scope === "district") && !groupKey.replace(":", "")) return;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(attempt);
    });
    groups.forEach((items) => {
      items.sort((a, b) => compareAttempts(a, b, priority));
      items.forEach((attempt, index) => {
        const registration = registrationMap.get(String(attempt.userId));
        const user = userMap.get(String(attempt.userId));
        writes.push({
          updateOne: {
            filter: { competitionId: String(competition._id), userId: String(attempt.userId), scope, periodKey: "" },
            update: {
              $set: {
                competitionId: String(competition._id),
                attemptId: String(attempt._id),
                userId: String(attempt.userId),
                userName: user?.name || user?.email || user?.mobile || "Learner",
                state: registration?.state || "",
                district: registration?.district || "",
                school: registration?.school || "",
                scope,
                periodKey: "",
                rank: index + 1,
                score: attempt.score,
                negativeMarksApplied: attempt.negativeMarksApplied,
                totalTimeSeconds: attempt.totalTimeSeconds,
                averageTimePerQuestion: attempt.averageTimePerQuestion,
                accuracy: attempt.accuracy,
                submittedAt: attempt.submittedAt || attempt.autoSubmittedAt,
                attendanceScore: attempt.startedAt ? 1 : 0,
                tieBreakSnapshot: { priority, refreshedAt: new Date().toISOString() },
              },
            },
            upsert: true,
          },
        });
      });
    });
  }
  if (writes.length) await NationalLeaderboardEntry.bulkWrite(writes);
  return { entries: writes.length, attempts: attempts.length };
}

export async function competitionSummary() {
  const [total, live, upcoming, registrations, attempts, rewardsPending] = await Promise.all([
    NationalCompetition.countDocuments({}),
    NationalCompetition.countDocuments({ status: "live" }),
    NationalCompetition.countDocuments({ startsAt: { $gte: new Date() }, status: { $nin: ["archived", "cancelled"] } }),
    NationalCompetitionRegistration.countDocuments({ status: { $in: ["approved", "pending", "locked"] } }),
    NationalCompetitionAttempt.countDocuments({ status: { $in: ["submitted", "auto_submitted"] } }),
    NationalLeaderboardEntry.countDocuments({ rank: { $lte: 10 } }),
  ]);
  return { total, live, upcoming, registrations, submissions: attempts, topRankedEntries: rewardsPending };
}
