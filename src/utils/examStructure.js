export const EXAM_SUBJECTS = {
  NEET: ["Biology", "Physics", "Chemistry"],
  JEE: ["Physics", "Chemistry", "Mathematics"],
};

export function deriveExamType(examMode, exam) {
  if (String(exam || "").startsWith("JEE")) return "JEE";
  if (exam === "NEET") return "NEET";
  if (exam && examMode === exam) return examMode;
  if (examMode === "JEE") return "JEE";
  if (examMode) return examMode;
  return "NEET";
}

export function normalizeSubjectName(name) {
  return String(name || "").trim().toLowerCase();
}

export function getSubjectCatalog(examType) {
  return EXAM_SUBJECTS[examType] || [];
}

export function isValidSubjectForExamType(name, examType) {
  const normalizedName = normalizeSubjectName(name);
  return getSubjectCatalog(examType).some((item) => normalizeSubjectName(item) === normalizedName);
}

export function isQuestionModeCompatible(examMode, exam) {
  if (examMode === "BOTH") return true;
  if (examMode && examMode === exam) return true;
  return deriveExamType(examMode, exam) === examMode;
}

export function getDefaultExamForExamType(examType) {
  if (examType === "JEE") return "JEE_MAIN";
  if (examType && examType !== "NEET") return examType;
  return "NEET";
}

export function normalizeQuestionExamFields(payload) {
  const examType = payload.examType || deriveExamType(payload.examMode, payload.exam);
  return {
    ...payload,
    examType,
    examMode: payload.examMode || examType,
    exam: payload.exam || getDefaultExamForExamType(examType),
  };
}
