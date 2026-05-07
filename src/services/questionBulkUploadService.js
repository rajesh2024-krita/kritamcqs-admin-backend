import mongoose from "mongoose";
import * as XLSX from "xlsx";
import {
  Chapter,
  Difficulty,
  ExamType,
  Question,
  QuestionBulkUploadBatch,
  QuestionBulkUploadRow,
  QuestionType,
  Subject,
  Topic,
  Year,
} from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { deriveExamType, getDefaultExamForExamType, isQuestionModeCompatible } from "../utils/examStructure.js";
import { ownQuestionAssetUrl } from "../utils/questionAssetOwner.js";

const REQUIRED_HEADERS = ["question", "option_a", "option_b", "option_c", "option_d", "correct_answer", "subject", "chapter", "topic", "difficulty", "exam_type", "year"];
const HEADER_ALIASES = {
  question: ["question", "question_text"],
  question_image: ["question_image", "question_image_url", "questionimage", "questionimageurl"],
  option_a: ["option_a", "optiona", "a"],
  option_a_image: ["option_a_image", "option_a_image_url", "optionaimage", "optionaimageurl"],
  option_b: ["option_b", "optionb", "b"],
  option_b_image: ["option_b_image", "option_b_image_url", "optionbimage", "optionbimageurl"],
  option_c: ["option_c", "optionc", "c"],
  option_c_image: ["option_c_image", "option_c_image_url", "optioncimage", "optioncimageurl"],
  option_d: ["option_d", "optiond", "d"],
  option_d_image: ["option_d_image", "option_d_image_url", "optiondimage", "optiondimageurl"],
  correct_answer: ["correct_answer", "correct_option", "correctoption", "correct", "answer", "answer_key"],
  numeric_answer: ["numeric_answer", "numericanswer", "text_answer", "blank_answer"],
  subject: ["subject", "subject_name"],
  chapter: ["chapter", "chapter_name"],
  topic: ["topic", "topic_name"],
  difficulty: ["difficulty", "difficulty_level", "level"],
  exam_type: ["exam_type", "examtype"],
  year: ["year", "year_label", "year_value"],
  question_type: ["question_type", "questiontype", "type"],
  response_type: ["response_type", "responsetype", "answer_type"],
  explanation: ["explanation", "solution"],
  passage: ["passage", "paragraph"],
  concept_tags: ["concept_tags", "concepttags", "tags"],
  has_diagram: ["has_diagram", "hasdiagram"],
  is_numerical: ["is_numerical", "isnumerical"],
};

const KNOWN_QUESTION_TYPES = new Set(["MCQ", "TRUE_FALSE", "FILL_BLANKS", "MATCH_FOLLOWING", "DESCRIPTIVE", "NUMERICAL"]);
const NUMERIC_LIKE_TYPES = new Set(["FILL_BLANKS", "MATCH_FOLLOWING", "DESCRIPTIVE", "NUMERICAL"]);

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function slugify(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeExamType(value) {
  const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "NEET") return "NEET";
  if (normalized === "JEE" || normalized === "JEE_MAIN" || normalized === "JEE_ADVANCED" || normalized === "JEE_MAIN") return "JEE";
  return normalized;
}

function normalizeQuestionType(value) {
  const normalized = normalizeHeader(value || "MCQ");
  if (["mcq", "single_choice", "single_correct", "multiple_choice", "multiple_choice_question"].includes(normalized)) return "MCQ";
  if (["true_false", "true_or_false"].includes(normalized)) return "TRUE_FALSE";
  if (["fill_blank", "fill_blanks", "fill_in_the_blank", "fill_in_the_blanks"].includes(normalized)) return "FILL_BLANKS";
  if (["match", "match_following", "match_the_following"].includes(normalized)) return "MATCH_FOLLOWING";
  if (["descriptive", "description"].includes(normalized)) return "DESCRIPTIVE";
  if (["numeric", "numerical", "integer", "integer_type"].includes(normalized)) return "NUMERICAL";
  return normalized ? normalized.toUpperCase() : "";
}

function normalizeResponseType(value) {
  const normalized = normalizeHeader(value);
  if (["numeric", "numerical", "integer", "integer_type"].includes(normalized)) return "numeric";
  if (["multiple", "multi", "multiple_correct", "multi_correct"].includes(normalized)) return "multiple";
  if (["text", "blank", "fill_blank", "fill_in_the_blank"].includes(normalized)) return "numeric";
  if (["boolean", "true_false", "true_or_false"].includes(normalized)) return "single";
  if (["single", "single_select", "single_correct", "mcq", "objective"].includes(normalized)) return "single";
  return "";
}

function normalizeBoolean(value) {
  const normalized = normalizeHeader(value);
  return ["1", "true", "yes", "y"].includes(normalized);
}

function parseConceptTags(value) {
  return normalizeText(value)
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function percent(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Math.round((Number(part || 0) / denominator) * 100);
}

function getQuestionTypeLabel(type, rawValue) {
  return {
    MCQ: "MCQ",
    TRUE_FALSE: "True / False",
    FILL_BLANKS: "Fill in the Blanks",
    MATCH_FOLLOWING: "Match the Following",
    DESCRIPTIVE: "Descriptive",
    NUMERICAL: "Numerical",
  }[type] || normalizeText(rawValue) || type;
}

function getQuestionTypeKey(type, rawValue) {
  return slugify(getQuestionTypeLabel(type, rawValue) || type || "question_type");
}

function normalizeCorrectAnswer(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (["A", "B", "C", "D"].includes(normalized)) return normalized;
  if (["1", "OPTION A", "A.", "A)"].includes(normalized)) return "A";
  if (["2", "OPTION B", "B.", "B)"].includes(normalized)) return "B";
  if (["3", "OPTION C", "C.", "C)"].includes(normalized)) return "C";
  if (["4", "OPTION D", "D.", "D)"].includes(normalized)) return "D";
  if (["TRUE", "T"].includes(normalized)) return "A";
  if (["FALSE", "F"].includes(normalized)) return "B";
  return normalized;
}

function resolveHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const map = {};
  const missing = [];

  for (const required of REQUIRED_HEADERS) {
    const match = HEADER_ALIASES[required].find((alias) => normalizedHeaders.includes(normalizeHeader(alias)));
    if (!match) missing.push(required);
    else map[required] = headers[normalizedHeaders.indexOf(normalizeHeader(match))];
  }

  for (const optional of [
    "question_image",
    "option_a_image",
    "option_b_image",
    "option_c_image",
    "option_d_image",
    "question_type",
    "response_type",
    "numeric_answer",
    "explanation",
    "passage",
    "concept_tags",
    "has_diagram",
    "is_numerical",
  ]) {
    const match = HEADER_ALIASES[optional].find((alias) => normalizedHeaders.includes(normalizeHeader(alias)));
    if (match) map[optional] = headers[normalizedHeaders.indexOf(normalizeHeader(match))];
  }

  return { map, missing };
}

function parseSheet(sheetFile) {
  if (!sheetFile) throw new AppError("Spreadsheet file is required", 400);
  const workbook = XLSX.read(sheetFile.buffer, { type: "buffer" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new AppError("Spreadsheet must contain at least one sheet", 400);

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
  const headers = Object.keys(rawRows[0] || {});
  const { map, missing } = resolveHeaderMap(headers);
  if (missing.length) {
    throw new AppError(`Invalid file format / headers not matching. Missing: ${missing.join(", ")}`, 400);
  }

  return rawRows
    .filter((row) => Object.values(row).some((value) => normalizeText(value)))
    .map((row) => ({
      question: row[map.question],
      questionImageUrl: map.question_image ? row[map.question_image] : "",
      optionA: row[map.option_a],
      optionAImageUrl: map.option_a_image ? row[map.option_a_image] : "",
      optionB: row[map.option_b],
      optionBImageUrl: map.option_b_image ? row[map.option_b_image] : "",
      optionC: row[map.option_c],
      optionCImageUrl: map.option_c_image ? row[map.option_c_image] : "",
      optionD: row[map.option_d],
      optionDImageUrl: map.option_d_image ? row[map.option_d_image] : "",
      correctAnswer: row[map.correct_answer],
      numericAnswer: map.numeric_answer ? row[map.numeric_answer] : "",
      subject: row[map.subject],
      chapter: row[map.chapter],
      topic: row[map.topic],
      difficulty: row[map.difficulty],
      examType: row[map.exam_type],
      year: row[map.year],
      questionType: map.question_type ? row[map.question_type] : "MCQ",
      responseType: map.response_type ? row[map.response_type] : "",
      explanation: map.explanation ? row[map.explanation] : "",
      passage: map.passage ? row[map.passage] : "",
      conceptTags: map.concept_tags ? row[map.concept_tags] : "",
      hasDiagram: map.has_diagram ? row[map.has_diagram] : "",
      isNumerical: map.is_numerical ? row[map.is_numerical] : "",
    }));
}

async function loadCatalog() {
  const [examTypes, subjects, chapters, topics, difficulties, questionTypes, years] = await Promise.all([
    ExamType.find().lean(),
    Subject.find().lean(),
    Chapter.find().lean(),
    Topic.find().lean(),
    Difficulty.find().lean(),
    QuestionType.find().lean(),
    Year.find().lean(),
  ]);

  return { examTypes, subjects, chapters, topics, difficulties, questionTypes, years };
}

function findSubject(catalog, name, examType) {
  return catalog.subjects.find((item) => normalizeKey(item.name) === normalizeKey(name) && item.examType === examType);
}

function findChapter(catalog, name, subjectId) {
  return catalog.chapters.find((item) => normalizeKey(item.name) === normalizeKey(name) && String(item.subjectId) === String(subjectId));
}

function findTopic(catalog, name, subjectId, chapterId) {
  return catalog.topics.find((item) =>
    normalizeKey(item.name) === normalizeKey(name)
    && String(item.subjectId) === String(subjectId)
    && String(item.chapterId) === String(chapterId),
  );
}

function findDifficulty(catalog, value) {
  const normalized = normalizeKey(value) === "medium" ? "moderate" : normalizeKey(value);
  return catalog.difficulties.find((item) => normalizeKey(item.key) === normalized || normalizeKey(item.name) === normalized);
}

function findQuestionType(catalog, type, examType, rawValue = "") {
  const label = getQuestionTypeLabel(type, rawValue);
  const key = getQuestionTypeKey(type, rawValue);
  return catalog.questionTypes.find((item) =>
    item.examType === examType
    && [item.name, item.label, item.key].some((entry) =>
      normalizeKey(entry) === normalizeKey(label)
      || normalizeKey(entry) === normalizeKey(type)
      || normalizeKey(entry) === normalizeKey(rawValue)
      || normalizeKey(entry) === normalizeKey(key),
    ),
  );
}

function findYear(catalog, value, examType) {
  return catalog.years.find((item) => normalizeKey(item.name) === normalizeKey(value) && (!item.examType || item.examType === examType));
}

function buildQuestionPayload(raw, matches) {
  const questionType = normalizeQuestionType(raw.questionType);
  const responseType = normalizeResponseType(raw.responseType);
  const isNumericLike = responseType === "numeric" || NUMERIC_LIKE_TYPES.has(questionType);
  const correctOption = normalizeCorrectAnswer(raw.correctAnswer);
  const answerText = normalizeText(raw.numericAnswer) || normalizeText(raw.correctAnswer);
  const examType = normalizeExamType(raw.examType);

  return {
    examType,
    subjectId: String(matches.subject._id),
    chapterId: String(matches.chapter._id),
    topicId: String(matches.topic._id),
    ...(matches.year ? { yearId: String(matches.year._id) } : {}),
    difficultyId: String(matches.difficulty._id),
    difficulty: normalizeKey(matches.difficulty.key || matches.difficulty.name),
    questionTypeId: String(matches.questionType._id),
    question: normalizeText(raw.question),
    questionImageUrl: normalizeText(raw.questionImageUrl),
    optionA: isNumericLike ? "" : normalizeText(raw.optionA),
    optionAImageUrl: normalizeText(raw.optionAImageUrl),
    optionB: isNumericLike ? "" : normalizeText(raw.optionB),
    optionBImageUrl: normalizeText(raw.optionBImageUrl),
    optionC: isNumericLike ? "" : normalizeText(raw.optionC),
    optionCImageUrl: normalizeText(raw.optionCImageUrl),
    optionD: isNumericLike ? "" : normalizeText(raw.optionD),
    optionDImageUrl: normalizeText(raw.optionDImageUrl),
    correctOption: isNumericLike ? undefined : correctOption,
    numericAnswer: isNumericLike ? answerText : "",
    explanation: normalizeText(raw.explanation),
    examMode: examType,
    exam: getDefaultExamForExamType(examType),
    responseType: isNumericLike ? "numeric" : responseType || "single",
    conceptTags: parseConceptTags(raw.conceptTags),
    passage: normalizeText(raw.passage),
    hasDiagram: normalizeBoolean(raw.hasDiagram),
    isNumerical: isNumericLike || normalizeBoolean(raw.isNumerical),
  };
}

function validateRawRow(raw, catalog) {
  const errors = [];
  const questionType = normalizeQuestionType(raw.questionType);
  const examType = normalizeExamType(raw.examType);

  if (!normalizeText(raw.question)) errors.push("Missing Question");
  if (!normalizeText(raw.subject)) errors.push("Missing Subject");
  if (!normalizeText(raw.chapter)) errors.push("Missing Chapter");
  if (!normalizeText(raw.topic)) errors.push("Missing Topic");
  if (!normalizeText(raw.difficulty)) errors.push("Missing Difficulty");
  if (!examType) errors.push("Invalid Exam Type");
  if (!questionType) errors.push("Invalid Question Type");

  const responseType = normalizeResponseType(raw.responseType);
  const needsOptions = responseType !== "numeric" && !NUMERIC_LIKE_TYPES.has(questionType);
  if (needsOptions) {
    if (!normalizeText(raw.correctAnswer)) errors.push("Missing Correct Answer");
    if (!normalizeText(raw.optionA)) errors.push("Missing Option A");
    if (!normalizeText(raw.optionB)) errors.push("Missing Option B");
    if (questionType !== "TRUE_FALSE" && !normalizeText(raw.optionC)) errors.push("Missing Option C");
    if (questionType !== "TRUE_FALSE" && !normalizeText(raw.optionD)) errors.push("Missing Option D");
    if (!["A", "B", "C", "D"].includes(normalizeCorrectAnswer(raw.correctAnswer))) errors.push("Invalid Correct Answer");
  }

  const subject = examType ? findSubject(catalog, raw.subject, examType) : null;
  const chapter = subject ? findChapter(catalog, raw.chapter, subject._id) : null;
  const topic = subject && chapter ? findTopic(catalog, raw.topic, subject._id, chapter._id) : null;
  const difficulty = findDifficulty(catalog, raw.difficulty);
  const questionTypeDoc = examType && questionType ? findQuestionType(catalog, questionType, examType, raw.questionType) : null;
  const year = normalizeText(raw.year) && examType ? findYear(catalog, raw.year, examType) : null;

  if (normalizeText(raw.subject) && !subject) errors.push("Missing Subject");
  if (normalizeText(raw.chapter) && !chapter) errors.push("Missing Chapter");
  if (normalizeText(raw.topic) && !topic) errors.push("Missing Topic");
  if (normalizeText(raw.difficulty) && !difficulty) errors.push("Invalid Difficulty");
  if (questionType && !questionTypeDoc) errors.push("Question Type not configured");
  if (normalizeText(raw.year) && !year) errors.push("Missing Year");

  const matches = { subject, chapter, topic, difficulty, questionType: questionTypeDoc, year };
  let payload = null;
  if (!errors.length) {
    payload = buildQuestionPayload(raw, matches);
    if (!isQuestionModeCompatible(payload.examMode, payload.exam)) errors.push("Question exam mode must match selected exam");
  }

  return { errors: [...new Set(errors)], payload, matches, questionType, examType };
}

function summarizeMissing(rows) {
  const seen = new Set();
  const missing = [];
  rows.forEach((row) => {
    const raw = row.raw || {};
    const message = row.errorMessage || "";
    [
      ["Subject", raw.subject, raw.examType],
      ["Exam Type", raw.examType, ""],
      ["Chapter", raw.chapter, raw.subject],
      ["Topic", raw.topic, raw.chapter],
      ["Year", raw.year, raw.examType],
      ["Difficulty", raw.difficulty, ""],
      ["Question Type", raw.questionType || "MCQ", raw.examType],
    ].forEach(([type, name, parent]) => {
      if (!normalizeText(name) || (!message.includes(`Missing ${type}`) && !message.includes(`Invalid ${type}`) && !message.includes(`${type} not configured`))) return;
      const key = `${type}:${normalizeKey(parent)}:${normalizeKey(name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      missing.push({ type, name: normalizeText(name), parent: normalizeText(parent) });
    });
  });
  return missing;
}

async function buildPreview(batchId) {
  const rows = await QuestionBulkUploadRow.find({ batchId }).sort({ rowNumber: 1 }).lean();
  const totalRows = rows.length;
  const validRows = rows.filter((row) => row.status === "valid");
  const invalidRows = rows.filter((row) => row.status !== "valid");
  const missingCategories = summarizeMissing(rows);

  await QuestionBulkUploadBatch.findByIdAndUpdate(batchId, {
    totalRows,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    missingCategoriesCount: missingCategories.length,
    validPercent: percent(validRows.length, totalRows),
  });

  return {
    batchId: String(batchId),
    totalRows,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    missingCategoriesCount: missingCategories.length,
    validPercent: percent(validRows.length, totalRows),
    missingCategories,
    rows: rows.slice(0, 500).map((row) => ({
      id: String(row._id),
      row: row.rowNumber,
      question: row.question || "",
      status: row.status === "valid" ? "Valid" : "Failed",
      error: row.errorMessage || "",
    })),
  };
}

async function validateRowsForBatch(batchId, catalog) {
  const rows = await QuestionBulkUploadRow.find({ batchId }).sort({ rowNumber: 1 });
  for (const row of rows) {
    const validation = validateRawRow(row.raw, catalog);
    row.payload = validation.payload || {};
    row.status = validation.errors.length ? "invalid" : "valid";
    row.errorMessage = validation.errors.join(", ");
    row.question = normalizeText(row.raw.question).slice(0, 300);
    await row.save();
  }
}

function sanitizeQuestionPayload(payload = {}) {
  const sanitized = { ...payload };
  for (const field of ["yearId", "chapterId", "topicId", "subjectId", "difficultyId", "questionTypeId"]) {
    if (sanitized[field] === "") delete sanitized[field];
  }
  return sanitized;
}

async function ownQuestionPayloadAssetUrls(payload = {}) {
  const nextPayload = { ...payload };
  for (const field of ["questionImageUrl", "optionAImageUrl", "optionBImageUrl", "optionCImageUrl", "optionDImageUrl"]) {
    if (!normalizeText(nextPayload[field])) continue;
    nextPayload[field] = await ownQuestionAssetUrl(nextPayload[field]);
  }
  return nextPayload;
}

async function createDifficultyIfMissing(catalog, raw) {
  if (!normalizeText(raw.difficulty) || findDifficulty(catalog, raw.difficulty)) return;
  const key = normalizeKey(raw.difficulty) === "medium" ? "moderate" : slugify(raw.difficulty);
  const maxSortOrder = Math.max(0, ...catalog.difficulties.map((item) => Number(item.sortOrder || 0)));
  const difficulty = (await Difficulty.create({
    key,
    name: normalizeText(raw.difficulty),
    sortOrder: maxSortOrder + 10,
  })).toObject();
  catalog.difficulties.push(difficulty);
}

async function createExamTypeIfMissing(catalog, examType) {
  if (!examType || catalog.examTypes.some((item) => normalizeExamType(item.name || item.key || item.label) === examType)) return;
  const examTypeDoc = (await ExamType.create({ name: examType, key: examType, label: examType })).toObject();
  catalog.examTypes.push(examTypeDoc);
}

async function createYearIfMissing(catalog, raw, examType) {
  if (!normalizeText(raw.year) || findYear(catalog, raw.year, examType)) return;
  const year = (await Year.create({ name: normalizeText(raw.year), examType })).toObject();
  catalog.years.push(year);
}

async function createQuestionTypeIfMissing(catalog, raw, examType) {
  const questionType = normalizeQuestionType(raw.questionType);
  if (!questionType || findQuestionType(catalog, questionType, examType, raw.questionType)) return;

  const label = getQuestionTypeLabel(questionType, raw.questionType);
  const baseKey = getQuestionTypeKey(questionType, raw.questionType);
  const nameExists = catalog.questionTypes.some((item) => normalizeKey(item.name) === normalizeKey(label));
  const keyExists = catalog.questionTypes.some((item) => normalizeKey(item.key) === normalizeKey(baseKey));
  const name = nameExists ? `${label} - ${examType}` : label;
  const key = keyExists ? `${baseKey}_${examType.toLowerCase()}` : baseKey;
  const description = KNOWN_QUESTION_TYPES.has(questionType) ? "" : "Created from bulk question upload.";

  const created = (await QuestionType.create({
    name,
    label,
    key,
    examType,
    examCategory: examType,
    description,
  })).toObject();
  catalog.questionTypes.push(created);
}

export const questionBulkUploadService = {
  async validateFile({ sheetFile, uploadedBy }) {
    const parsedRows = parseSheet(sheetFile);
    const batch = await QuestionBulkUploadBatch.create({
      fileName: sheetFile.originalname || "questions-upload",
      uploadedBy: uploadedBy || undefined,
      status: "pending",
      totalRows: parsedRows.length,
    });

    const catalog = await loadCatalog();
    await QuestionBulkUploadRow.insertMany(parsedRows.map((raw, index) => {
      const validation = validateRawRow(raw, catalog);
      return {
        batchId: batch._id,
        rowNumber: index + 2,
        raw,
        payload: validation.payload || {},
        question: normalizeText(raw.question).slice(0, 300),
        status: validation.errors.length ? "invalid" : "valid",
        errorMessage: validation.errors.join(", "),
      };
    }), { ordered: false });

    return buildPreview(batch._id);
  },

  async createMissingCategories({ batchId }) {
    if (!mongoose.isValidObjectId(batchId)) throw new AppError("Invalid upload batch", 400);
    const batch = await QuestionBulkUploadBatch.findById(batchId);
    if (!batch) throw new AppError("Upload batch not found", 404);
    const rows = await QuestionBulkUploadRow.find({ batchId }).lean();

    let catalog = await loadCatalog();
    for (const row of rows) {
      const raw = row.raw || {};
      const examType = normalizeExamType(raw.examType);
      if (!examType) continue;

      await createExamTypeIfMissing(catalog, examType);
      await createDifficultyIfMissing(catalog, raw);
      await createYearIfMissing(catalog, raw, examType);
      await createQuestionTypeIfMissing(catalog, raw, examType);

      if (!normalizeText(raw.subject)) continue;
      let subject = findSubject(catalog, raw.subject, examType);
      if (!subject) {
        subject = (await Subject.create({ name: normalizeText(raw.subject), examType })).toObject();
        catalog.subjects.push(subject);
      }

      if (!normalizeText(raw.chapter)) continue;
      let chapter = findChapter(catalog, raw.chapter, subject._id);
      if (!chapter) {
        chapter = (await Chapter.create({ subjectId: subject._id, name: normalizeText(raw.chapter) })).toObject();
        catalog.chapters.push(chapter);
      }

      if (!normalizeText(raw.topic)) continue;
      let topic = findTopic(catalog, raw.topic, subject._id, chapter._id);
      if (!topic) {
        topic = (await Topic.create({ subjectId: subject._id, chapterId: chapter._id, name: normalizeText(raw.topic) })).toObject();
        catalog.topics.push(topic);
      }
    }

    catalog = await loadCatalog();
    await validateRowsForBatch(batch._id, catalog);
    batch.status = "categories_created";
    await batch.save();
    return buildPreview(batch._id);
  },

  async approve({ batchId }) {
    if (!mongoose.isValidObjectId(batchId)) throw new AppError("Invalid upload batch", 400);
    const batch = await QuestionBulkUploadBatch.findById(batchId);
    if (!batch) throw new AppError("Upload batch not found", 404);

    const rows = await QuestionBulkUploadRow.find({ batchId, status: "valid" }).sort({ rowNumber: 1 });
    let inserted = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const payload = await ownQuestionPayloadAssetUrls(sanitizeQuestionPayload(row.payload));
        const exists = await Question.exists({
          question: payload.question,
          subjectId: payload.subjectId,
          chapterId: payload.chapterId,
          topicId: payload.topicId,
          exam: payload.exam,
        });
        if (exists) {
          row.status = "duplicate";
          row.errorMessage = "Duplicate Question";
          failed += 1;
          await row.save();
          continue;
        }
        await Question.create(payload);
        row.status = "approved";
        row.errorMessage = "";
        inserted += 1;
        await row.save();
      } catch (error) {
        row.status = "failed";
        row.errorMessage = error.message || "Question upload failed";
        failed += 1;
        await row.save();
      }
    }

    batch.status = failed > 0 && inserted === 0 ? "failed" : "approved";
    batch.insertedCount = inserted;
    batch.failedCount = Number(batch.invalidCount || 0) + failed;
    await batch.save();

    return {
      batchId: String(batch._id),
      totalRows: batch.totalRows,
      successCount: inserted,
      failedCount: batch.failedCount,
      progressPercent: percent(inserted + failed, batch.totalRows),
      successPercent: percent(inserted, batch.totalRows),
      failedPercent: percent(batch.failedCount, batch.totalRows),
      rows: (await QuestionBulkUploadRow.find({ batchId }).sort({ rowNumber: 1 }).lean()).slice(0, 500).map((row) => ({
        row: row.rowNumber,
        question: row.question || "",
        status: row.status,
        error: row.errorMessage || "",
      })),
    };
  },
};
