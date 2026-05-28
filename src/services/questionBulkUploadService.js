// questionBulkUpload.js
import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
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
import { buildPublicUploadPath, ensureDir, questionUploadsRoot, sanitizeFileName } from "../utils/uploadStorage.js";

const REQUIRED_HEADERS = ["question", "subject", "chapter", "topic", "difficulty", "exam_type", "year"];
const IMAGE_FIELDS = ["questionImageUrl", "optionAImageUrl", "optionBImageUrl", "optionCImageUrl", "optionDImageUrl", "explanationImageUrl"];
const HEADER_ALIASES = {
  question: ["question", "question_text", "question_title", "question_statement"],
  question_image: ["question_image", "question_image_url", "questionimage", "questionimageurl", "image", "image_url", "diagram", "diagram_url", "question_diagram", "question_media", "question_media_url"],
  option_a: ["option_a", "optiona", "a", "option_a_text", "option_a_text"],
  option_a_image: ["option_a_image", "option_a_image_url", "optionaimage", "optionaimageurl", "a_image", "a_image_url", "image_a", "image_a_url"],
  option_b: ["option_b", "optionb", "b", "option_b_text", "option_b_text"],
  option_b_image: ["option_b_image", "option_b_image_url", "optionbimage", "optionbimageurl", "b_image", "b_image_url", "image_b", "image_b_url"],
  option_c: ["option_c", "optionc", "c", "option_c_text", "option_c_text"],
  option_c_image: ["option_c_image", "option_c_image_url", "optioncimage", "optioncimageurl", "c_image", "c_image_url", "image_c", "image_c_url"],
  option_d: ["option_d", "optiond", "d", "option_d_text", "option_d_text"],
  option_d_image: ["option_d_image", "option_d_image_url", "optiondimage", "optiondimageurl", "d_image", "d_image_url", "image_d", "image_d_url"],
  correct_answer: ["correct_answer", "correct_option", "correctoption", "correct", "answer", "answer_key", "correct_ans", "correct_choice", "correct_choice_text"],
  numeric_answer: ["numeric_answer", "numericanswer", "text_answer", "blank_answer"],
  subject: ["subject", "subject_name"],
  chapter: ["chapter", "chapter_name"],
  topic: ["topic", "topic_name"],
  difficulty: ["difficulty", "difficulty_level", "level"],
  exam_type: ["exam_type", "examtype", "category", "exam_category"],
  year: ["year", "year_label", "year_value"],
  question_type: ["question_type", "questiontype", "type"],
  response_type: ["response_type", "responsetype", "answer_type"],
  explanation: ["explanation", "solution", "answer_explanation", "reason"],
  explanation_image: ["explanation_image", "explanation_image_url", "solution_image", "solution_image_url", "explanation_media", "explanation_media_url"],
  video_url: ["video_url", "video", "solution_video", "solution_video_url", "media_url", "reference_url", "youtube_url"],
  passage: ["passage", "paragraph"],
  concept_tags: ["concept_tags", "concepttags", "tags"],
  has_diagram: ["has_diagram", "hasdiagram"],
  is_numerical: ["is_numerical", "isnumerical"],
};

const KNOWN_QUESTION_TYPES = new Set(["MCQ", "TRUE_FALSE", "FILL_BLANKS", "MATCH_FOLLOWING", "DESCRIPTIVE", "NUMERICAL"]);
const NUMERIC_LIKE_TYPES = new Set(["FILL_BLANKS", "MATCH_FOLLOWING", "DESCRIPTIVE", "NUMERICAL"]);
const OBJECTIVE_RESPONSE_TYPES = new Set(["single", "multiple"]);

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
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
  if (["mcq", "image_mcq", "mcq_image", "diagram_mcq", "image_based_mcq", "single_choice", "single_correct", "multiple_choice", "multiple_choice_question"].includes(normalized)) return "MCQ";
  if (["true_false", "true_or_false"].includes(normalized)) return "TRUE_FALSE";
  if (["fill_blank", "fill_blanks", "fill_in_the_blank", "fill_in_the_blanks"].includes(normalized)) return "FILL_BLANKS";
  if (["match", "match_following", "match_the_following"].includes(normalized)) return "MATCH_FOLLOWING";
  if (["descriptive", "description"].includes(normalized)) return "DESCRIPTIVE";
  if (["numeric", "numerical", "integer", "integer_type"].includes(normalized)) return "NUMERICAL";
  return normalized ? normalized.toUpperCase() : "";
}

function getEffectiveQuestionType(raw = {}) {
  const questionType = normalizeQuestionType(raw.questionType);
  if (!questionType || KNOWN_QUESTION_TYPES.has(questionType)) return questionType;

  const responseType = normalizeResponseType(raw.responseType);
  const hasObjectiveOptions = ["optionA", "optionB", "optionC", "optionD", "optionAImageUrl", "optionBImageUrl", "optionCImageUrl", "optionDImageUrl"]
    .some((field) => normalizeText(raw[field]));

  // Sheets often use question_type for labels such as Conceptual, NCERT Direct,
  // or Statement Based. If the response type/options show an objective question,
  // store it under the configured MCQ type instead of requiring every label to
  // exist as a separate Question Type.
  if (OBJECTIVE_RESPONSE_TYPES.has(responseType) || hasObjectiveOptions) return "MCQ";
  return questionType;
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

function isBooleanLike(value) {
  return ["1", "0", "true", "false", "yes", "no", "y", "n"].includes(normalizeHeader(value));
}

function parseConceptTags(value) {
  return normalizeText(value)
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function makeEmptySummary() {
  return {
    categories: 0,
    subjects: 0,
    chapters: 0,
    topics: 0,
    tags: 0,
    difficulties: 0,
    questionTypes: 0,
    years: 0,
    relatedEntities: 0,
  };
}

function percent(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Math.round((Number(part || 0) / denominator) * 100);
}

function countRawImages(raw = {}) {
  return IMAGE_FIELDS.reduce((sum, field) => sum + (normalizeText(raw[field]) ? 1 : 0), 0);
}

function buildDuplicateKeyFromRaw(raw = {}) {
  return [
    normalizeExamType(raw.examType),
    normalizeKey(raw.subject),
    normalizeKey(raw.chapter),
    normalizeKey(raw.topic),
    normalizeKey(raw.question) || normalizeKey(raw.questionImageUrl),
  ].join("|");
}

function buildDuplicateQuery(payload = {}) {
  return {
    question: payload.question,
    subjectId: payload.subjectId,
    chapterId: payload.chapterId,
    topicId: payload.topicId,
    exam: payload.exam,
  };
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

function normalizeCorrectAnswer(value, options = {}) {
  const normalized = normalizeText(value).toUpperCase();
  if (["A", "B", "C", "D"].includes(normalized)) return normalized;
  if (["1", "OPTION A", "A.", "A)"].includes(normalized)) return "A";
  if (["2", "OPTION B", "B.", "B)"].includes(normalized)) return "B";
  if (["3", "OPTION C", "C.", "C)"].includes(normalized)) return "C";
  if (["4", "OPTION D", "D.", "D)"].includes(normalized)) return "D";
  if (["TRUE", "T"].includes(normalized)) return "A";
  if (["FALSE", "F"].includes(normalized)) return "B";
  const answerKey = normalizeKey(value);
  for (const [letter, optionValue] of Object.entries(options)) {
    if (answerKey && normalizeKey(optionValue) === answerKey) return letter;
  }
  return normalized;
}

function normalizeCorrectOptions(value, options = {}) {
  return [
    ...new Set(
      normalizeText(value)
        .split(/[,;|/]+|\s+and\s+/i)
        .map((item) => normalizeCorrectAnswer(item, options))
        .filter((item) => ["A", "B", "C", "D"].includes(item)),
    ),
  ];
}

function isValidUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/") || trimmed.startsWith("data:image/");
}

function isDataUri(value) {
  const trimmed = String(value ?? "").trim();
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(trimmed);
}

function isImageValue(value) {
  if (!value || typeof value !== "string") return false;
  const lower = normalizeText(value).toLowerCase();
  if (!lower) return false;
  if (isDataUri(lower)) return true;
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/.test(lower)) return true;
  if (/^(https?:)?\/\//.test(lower) || /^www\./.test(lower)) return true;
  return lower.includes("/uploads/") || lower.includes("cloudinary") || lower.includes("firebase");
}

function extractImageUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  
  if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) return "";
  if (!isImageValue(normalized)) return "";
  return normalized;
}

function splitTextImageValue(value) {
  const text = normalizeText(value);
  if (!text) return { text: "", image: "" };
  if (isImageValue(text)) return { text: "", image: extractImageUrl(text) };
  return { text, image: "" };
}

function mergeTextImagePair(textValue, imageValue) {
  const textPart = splitTextImageValue(textValue);
  const imagePart = splitTextImageValue(imageValue);
  return {
    text: textPart.text || imagePart.text,
    image: imagePart.image || textPart.image,
  };
}

function normalizeMixedMediaFields(parsed = {}) {
  const question = mergeTextImagePair(parsed.question, parsed.questionImageUrl);
  const optionA = mergeTextImagePair(parsed.optionA, parsed.optionAImageUrl);
  const optionB = mergeTextImagePair(parsed.optionB, parsed.optionBImageUrl);
  const optionC = mergeTextImagePair(parsed.optionC, parsed.optionCImageUrl);
  const optionD = mergeTextImagePair(parsed.optionD, parsed.optionDImageUrl);
  const explanation = mergeTextImagePair(parsed.explanation, parsed.explanationImageUrl);

  return {
    ...parsed,
    question: question.text,
    questionImageUrl: question.image,
    optionA: optionA.text,
    optionAImageUrl: optionA.image,
    optionB: optionB.text,
    optionBImageUrl: optionB.image,
    optionC: optionC.text,
    optionCImageUrl: optionC.image,
    optionD: optionD.text,
    optionDImageUrl: optionD.image,
    explanation: explanation.text,
    explanationImageUrl: explanation.image,
  };
}

function getCellDisplayValue(cell) {
  if (cell === undefined || cell === null) return "";
  if (typeof cell !== "object" || cell instanceof Date) return cell;
  if (cell.text !== undefined) return cell.text;
  if (cell.v !== undefined) return cell.v;
  if (cell.w !== undefined) return cell.w;
  if (cell.richText && Array.isArray(cell.richText)) return cell.richText.map((item) => item.text || "").join("");
  return "";
}

function columnIndexToName(index) {
  let value = Number(index || 0) + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function columnNameToIndex(name) {
  return String(name || "").toUpperCase().split("").reduce((sum, char) => (sum * 26) + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value = "") {
  return String(value)
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function getXmlAttribute(fragment = "", name) {
  const match = String(fragment).match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function listZipEntries(buffer) {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === endSignature) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) return [];

  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  let centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(centralDirectoryOffset) !== 0x02014b50) break;
    const compressedSize = buffer.readUInt32LE(centralDirectoryOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralDirectoryOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirectoryOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirectoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirectoryOffset + 42);
    const fileName = buffer.slice(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + fileNameLength).toString("utf8");
    entries.push({ fileName, compressedSize, localHeaderOffset });
    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer, entries, fileName) {
  const entry = entries.find((item) => item.fileName === fileName);
  if (!entry) return null;
  const method = buffer.readUInt16LE(entry.localHeaderOffset + 8);
  const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return zlib.inflateRawSync(compressed);
  return null;
}

function parseRelationships(xml = "") {
  const rels = new Map();
  for (const match of String(xml).matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const fragment = match[0];
    rels.set(getXmlAttribute(fragment, "Id"), {
      id: getXmlAttribute(fragment, "Id"),
      type: getXmlAttribute(fragment, "Type"),
      target: getXmlAttribute(fragment, "Target"),
    });
  }
  return rels;
}

function normalizeXlsxPath(basePath, target) {
  if (!target) return "";
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const baseDir = path.posix.dirname(basePath);
  return path.posix.normalize(path.posix.join(baseDir, target)).replace(/^\/+/, "");
}

function relsPathForPart(partPath) {
  return path.posix.join(path.posix.dirname(partPath), "_rels", `${path.posix.basename(partPath)}.rels`);
}

function contentTypeForImagePath(fileName = "") {
  const ext = path.extname(fileName).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  }[ext] || "image/png";
}

async function saveEmbeddedExcelImage(buffer, originalName) {
  ensureDir(questionUploadsRoot);
  const safeName = sanitizeFileName(originalName || "excel-image.png");
  const dotIndex = safeName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : ".png";
  const fileName = `${baseName || "excel-image"}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  await fs.writeFile(path.join(questionUploadsRoot, fileName), buffer);
  return buildPublicUploadPath(fileName);
}

function findFirstWorksheetPath(buffer, entries, sheetName) {
  const workbookXml = readZipEntry(buffer, entries, "xl/workbook.xml")?.toString("utf8") || "";
  const workbookRels = parseRelationships(readZipEntry(buffer, entries, "xl/_rels/workbook.xml.rels")?.toString("utf8") || "");
  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)].map((match) => ({
    name: getXmlAttribute(match[0], "name"),
    relId: getXmlAttribute(match[0], "r:id"),
  }));
  const selectedSheet = sheets.find((sheet) => sheet.name === sheetName) || sheets[0];
  const rel = selectedSheet ? workbookRels.get(selectedSheet.relId) : null;
  if (rel?.target) return normalizeXlsxPath("xl/workbook.xml", rel.target);
  return "xl/worksheets/sheet1.xml";
}

async function extractEmbeddedExcelImages(buffer, sheetName) {
  const entries = listZipEntries(buffer);
  if (!entries.length) return new Map();

  const worksheetPath = findFirstWorksheetPath(buffer, entries, sheetName);
  const sheetRels = parseRelationships(readZipEntry(buffer, entries, relsPathForPart(worksheetPath))?.toString("utf8") || "");
  const drawingRel = [...sheetRels.values()].find((rel) => rel.type.includes("/drawing"));
  if (!drawingRel) return new Map();

  const drawingPath = normalizeXlsxPath(worksheetPath, drawingRel.target);
  const drawingXml = readZipEntry(buffer, entries, drawingPath)?.toString("utf8") || "";
  const drawingRels = parseRelationships(readZipEntry(buffer, entries, relsPathForPart(drawingPath))?.toString("utf8") || "");
  const imageMap = new Map();

  for (const match of drawingXml.matchAll(/<xdr:(?:oneCellAnchor|twoCellAnchor)[\s\S]*?<\/xdr:(?:oneCellAnchor|twoCellAnchor)>/g)) {
    const anchor = match[0];
    const fromMatch = anchor.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/);
    const embedMatch = anchor.match(/r:embed="([^"]+)"/);
    if (!fromMatch || !embedMatch) continue;

    const col = Number(fromMatch[1].match(/<xdr:col>(\d+)<\/xdr:col>/)?.[1]);
    const row = Number(fromMatch[1].match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1]);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;

    const rel = drawingRels.get(embedMatch[1]);
    if (!rel?.target) continue;
    const imagePath = normalizeXlsxPath(drawingPath, rel.target);
    const imageBuffer = readZipEntry(buffer, entries, imagePath);
    if (!imageBuffer?.length) continue;

    try {
      const imageUrl = await saveEmbeddedExcelImage(imageBuffer, path.basename(imagePath));
      const key = `${row + 1}:${col}`;
      const existing = imageMap.get(key) || [];
      existing.push({ url: imageUrl, path: imagePath, contentType: contentTypeForImagePath(imagePath) });
      imageMap.set(key, existing);
    } catch {
      const key = `${row + 1}:${col}`;
      const existing = imageMap.get(key) || [];
      existing.push({ url: "", path: imagePath, error: "Embedded image upload failed" });
      imageMap.set(key, existing);
    }
  }

  return imageMap;
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
    "option_a",
    "option_a_image",
    "option_b",
    "option_b_image",
    "option_c",
    "option_c_image",
    "option_d",
    "option_d_image",
    "correct_answer",
    "question_image",
    "question_type",
    "response_type",
    "numeric_answer",
    "explanation",
    "explanation_image",
    "video_url",
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

function detectAndHandleImageMCQRows(row, headers, map) {
  // Check if this is an image-based MCQ row
  const hasImageColumns = map.question_image && row[map.question_image];
  const hasImageInOptions = (map.option_a_image && row[map.option_a_image]) ||
                            (map.option_b_image && row[map.option_b_image]) ||
                            (map.option_c_image && row[map.option_c_image]) ||
                            (map.option_d_image && row[map.option_d_image]);
  
  if (!hasImageColumns && !hasImageInOptions) return row;
  
  // Process question image
  if (map.question_image && row[map.question_image]) {
    const imageUrl = extractImageUrl(row[map.question_image]);
    if (imageUrl) {
      row.questionImageUrl = imageUrl;
      row.hasDiagram = true;
    }
  }
  
  // Process option images
  if (map.option_a_image && row[map.option_a_image]) {
    row.optionAImageUrl = extractImageUrl(row[map.option_a_image]);
  }
  
  if (map.option_b_image && row[map.option_b_image]) {
    row.optionBImageUrl = extractImageUrl(row[map.option_b_image]);
  }
  
  if (map.option_c_image && row[map.option_c_image]) {
    row.optionCImageUrl = extractImageUrl(row[map.option_c_image]);
  }
  
  if (map.option_d_image && row[map.option_d_image]) {
    row.optionDImageUrl = extractImageUrl(row[map.option_d_image]);
  }
  
  return row;
}

function takeEmbeddedImageUrl(imageMap, rowNumber, columnIndex) {
  if (!Number.isFinite(columnIndex)) return { url: "", errors: [] };
  const images = imageMap.get(`${rowNumber}:${columnIndex}`) || [];
  const firstUrl = images.find((image) => image.url)?.url || "";
  const errors = images.filter((image) => image.error).map((image) => image.error);
  return { url: firstUrl, errors };
}

function mergeEmbeddedImages(parsed, { rowNumber, map, headerColumnIndexes, imageMap }) {
  const errors = [];
  const imageTargets = [
    { textKey: "question", imageKey: "question_image", outputKey: "questionImageUrl" },
    { textKey: "option_a", imageKey: "option_a_image", outputKey: "optionAImageUrl" },
    { textKey: "option_b", imageKey: "option_b_image", outputKey: "optionBImageUrl" },
    { textKey: "option_c", imageKey: "option_c_image", outputKey: "optionCImageUrl" },
    { textKey: "option_d", imageKey: "option_d_image", outputKey: "optionDImageUrl" },
    { textKey: "explanation", imageKey: "explanation_image", outputKey: "explanationImageUrl" },
  ];

  for (const target of imageTargets) {
    const candidateColumns = [map[target.imageKey], map[target.textKey]]
      .map((header) => headerColumnIndexes.get(header))
      .filter((columnIndex) => Number.isFinite(columnIndex));

    for (const columnIndex of candidateColumns) {
      const result = takeEmbeddedImageUrl(imageMap, rowNumber, columnIndex);
      errors.push(...result.errors.map((message) => `${columnIndexToName(columnIndex)}: ${message}`));
      if (result.url && !parsed[target.outputKey]) {
        parsed[target.outputKey] = result.url;
      }
    }
  }

  parsed.hasDiagram = Boolean(parsed.hasDiagram) || IMAGE_FIELDS.some((field) => normalizeText(parsed[field]));
  parsed.__imageErrors = errors;
  return parsed;
}

function getRowCellByColumn(row, columnIndex) {
  return row.__cellsByColumn?.[String(columnIndex)] ?? "";
}

function applyShiftedImageQuestionColumns(parsed, { row, map, headerColumnIndexes, imageMap }) {
  const questionType = normalizeHeader(parsed.questionType);
  const optionAColumn = headerColumnIndexes.get(map.option_a);
  if (!Number.isFinite(optionAColumn) || !questionType.includes("image")) return parsed;
  if (!isBooleanLike(getRowCellByColumn(row, optionAColumn))) return parsed;

  const imageColumn = optionAColumn + 1;
  const embeddedImage = takeEmbeddedImageUrl(imageMap, row.__excelRowNumber, imageColumn);
  const hasImageInNextColumn = Boolean(embeddedImage.url || parsed.optionBImageUrl);
  if (!hasImageInNextColumn) return parsed;

  parsed.hasDiagram = true;
  parsed.questionImageUrl = parsed.questionImageUrl || embeddedImage.url || parsed.optionBImageUrl;
  parsed.optionBImageUrl = "";
  parsed.optionA = getRowCellByColumn(row, optionAColumn + 2);
  parsed.optionB = getRowCellByColumn(row, optionAColumn + 3);
  parsed.optionC = getRowCellByColumn(row, optionAColumn + 4);
  parsed.optionD = getRowCellByColumn(row, optionAColumn + 5);
  parsed.correctAnswer = getRowCellByColumn(row, optionAColumn + 6) || parsed.correctAnswer;
  parsed.explanation = getRowCellByColumn(row, optionAColumn + 7) || parsed.explanation;
  parsed.videoUrl = getRowCellByColumn(row, optionAColumn + 8) || parsed.videoUrl;
  return parsed;
}

async function parseSheet(sheetFile) {
  if (!sheetFile) throw new AppError("Spreadsheet file is required", 400);
  const fileName = String(sheetFile.originalname || "").toLowerCase();
  if (fileName.endsWith(".json") || String(sheetFile.mimetype || "").includes("json")) {
    let parsedJson;
    try {
      parsedJson = JSON.parse(sheetFile.buffer.toString("utf8"));
    } catch {
      throw new AppError("JSON upload must contain valid JSON", 400);
    }
    const rows = Array.isArray(parsedJson) ? parsedJson : Array.isArray(parsedJson?.questions) ? parsedJson.questions : [];
    if (!rows.length) throw new AppError("JSON upload must contain a non-empty array or questions array", 400);
    return rows.map((row) => normalizeMixedMediaFields({
      __rowNumber: row.__rowNumber,
      question: row.question ?? row.question_text ?? "",
      questionImageUrl: row.questionImageUrl ?? row.question_image ?? row.question_image_url ?? "",
      optionA: row.optionA ?? row.option_a ?? row.a ?? "",
      optionAImageUrl: row.optionAImageUrl ?? row.option_a_image ?? row.option_a_image_url ?? "",
      optionB: row.optionB ?? row.option_b ?? row.b ?? "",
      optionBImageUrl: row.optionBImageUrl ?? row.option_b_image ?? row.option_b_image_url ?? "",
      optionC: row.optionC ?? row.option_c ?? row.c ?? "",
      optionCImageUrl: row.optionCImageUrl ?? row.option_c_image ?? row.option_c_image_url ?? "",
      optionD: row.optionD ?? row.option_d ?? row.d ?? "",
      optionDImageUrl: row.optionDImageUrl ?? row.option_d_image ?? row.option_d_image_url ?? "",
      correctAnswer: row.correctAnswer ?? row.correct_answer ?? row.answer ?? "",
      numericAnswer: row.numericAnswer ?? row.numeric_answer ?? "",
      subject: row.subject ?? row.subject_name ?? "",
      chapter: row.chapter ?? row.chapter_name ?? "",
      topic: row.topic ?? row.topic_name ?? "",
      difficulty: row.difficulty ?? row.difficulty_level ?? "",
      examType: row.examType ?? row.exam_type ?? row.category ?? "",
      year: row.year ?? "",
      questionType: row.questionType ?? row.question_type ?? "MCQ",
      responseType: row.responseType ?? row.response_type ?? "",
      explanation: row.explanation ?? row.solution ?? "",
      explanationImageUrl: extractImageUrl(row.explanationImageUrl ?? row.explanation_image ?? row.explanation_image_url ?? ""),
      passage: row.passage ?? row.paragraph ?? "",
      conceptTags: Array.isArray(row.conceptTags) ? row.conceptTags.join(",") : (row.conceptTags ?? row.concept_tags ?? row.tags ?? ""),
      hasDiagram: row.hasDiagram ?? row.has_diagram ?? "",
      isNumerical: row.isNumerical ?? row.is_numerical ?? "",
      videoUrl: row.videoUrl ?? row.video_url ?? "",
    }));
  }

  const workbook = XLSX.read(sheetFile.buffer, { type: "buffer", cellHTML: true, cellNF: false, cellText: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new AppError("Spreadsheet must contain at least one sheet", 400);

  const worksheet = workbook.Sheets[firstSheet];
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  const headers = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    headers.push(normalizeText(getCellDisplayValue(worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })])));
  }
  const { map, missing } = resolveHeaderMap(headers);
  
  if (missing.length) {
    throw new AppError(`Invalid file format / headers not matching. Missing: ${missing.join(", ")}`, 400);
  }

  const headerColumnIndexes = new Map(headers.map((header, index) => [header, index + range.s.c]));
  const embeddedImageMap = await extractEmbeddedExcelImages(sheetFile.buffer, firstSheet);
  const rawRows = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row = {};
    row.__cellsByColumn = {};
    headers.forEach((header, headerIndex) => {
      const columnIndex = range.s.c + headerIndex;
      const value = getCellDisplayValue(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]);
      row[header] = value;
      row.__cellsByColumn[String(columnIndex)] = value;
    });
    row.__excelRowNumber = rowIndex + 1;
    rawRows.push(row);
  }

  return rawRows
    .filter((row) => headers.some((header) => normalizeText(row[header])) || [...embeddedImageMap.keys()].some((key) => key.startsWith(`${row.__excelRowNumber}:`)))
    .map((row) => {
      // Parse basic row data
      let parsed = {
        __rowNumber: row.__excelRowNumber,
        question: row[map.question],
        questionImageUrl: map.question_image ? extractImageUrl(row[map.question_image]) : "",
        optionA: map.option_a ? row[map.option_a] : "",
        optionAImageUrl: map.option_a_image ? extractImageUrl(row[map.option_a_image]) : "",
        optionB: map.option_b ? row[map.option_b] : "",
        optionBImageUrl: map.option_b_image ? extractImageUrl(row[map.option_b_image]) : "",
        optionC: map.option_c ? row[map.option_c] : "",
        optionCImageUrl: map.option_c_image ? extractImageUrl(row[map.option_c_image]) : "",
        optionD: map.option_d ? row[map.option_d] : "",
        optionDImageUrl: map.option_d_image ? extractImageUrl(row[map.option_d_image]) : "",
        correctAnswer: map.correct_answer ? row[map.correct_answer] : "",
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
        explanationImageUrl: map.explanation_image ? extractImageUrl(row[map.explanation_image]) : "",
        passage: map.passage ? row[map.passage] : "",
        conceptTags: map.concept_tags ? row[map.concept_tags] : "",
        hasDiagram: map.has_diagram ? row[map.has_diagram] : "",
        isNumerical: map.is_numerical ? row[map.is_numerical] : "",
        videoUrl: map.video_url ? row[map.video_url] : "",
      };
      parsed = mergeEmbeddedImages(parsed, {
        rowNumber: row.__excelRowNumber,
        map,
        headerColumnIndexes,
        imageMap: embeddedImageMap,
      });
      parsed = applyShiftedImageQuestionColumns(parsed, {
        row,
        map,
        headerColumnIndexes,
        imageMap: embeddedImageMap,
      });
      
      // Handle image-based rows
      parsed = detectAndHandleImageMCQRows(parsed, headers, map);
      parsed = normalizeMixedMediaFields(parsed);
      
      // Handle shifted image rows (special case where image is in wrong column)
      const tailValues = ["__EMPTY", "__EMPTY_1", "__EMPTY_2", "__EMPTY_3", "__EMPTY_4"].map((key) => row[key]);
      const looksShiftedImageRow =
        normalizeHeader(parsed.questionType).includes("image") ||
        (parsed.questionImageUrl && !normalizeText(parsed.optionA) && normalizeText(tailValues[0]));
      
      if (looksShiftedImageRow && tailValues.length) {
        // If the row has an image and options are shifted, re-arrange
        if (!normalizeText(parsed.optionA) && normalizeText(tailValues[0])) {
          parsed.hasDiagram = parsed.hasDiagram || "yes";
          parsed.questionImageUrl = parsed.questionImageUrl || extractImageUrl(tailValues[0]);
          parsed.optionA = tailValues[1] || "";
          parsed.optionB = tailValues[2] || "";
          parsed.optionC = tailValues[3] || "";
          parsed.optionD = tailValues[4] || "";
          parsed.correctAnswer = parsed.correctAnswer || tailValues[5] || "";
          parsed.explanation = parsed.explanation || tailValues[6] || "";
          parsed.videoUrl = parsed.videoUrl || tailValues[7] || "";
        }
      }
      
      // Handle case where correct answer might be in an unexpected column
      if (!normalizeText(parsed.correctAnswer) && normalizeText(tailValues[0]) && 
          ["A", "B", "C", "D"].includes(normalizeCorrectAnswer(tailValues[0]))) {
        parsed.correctAnswer = tailValues[0];
        parsed.explanation = parsed.explanation || tailValues[1] || "";
        parsed.videoUrl = parsed.videoUrl || tailValues[2] || "";
      }
      
      // Set hasDiagram flag if there are any image URLs
      parsed.hasDiagram = Boolean(parsed.hasDiagram) || 
                         !!parsed.questionImageUrl ||
                         !!parsed.optionAImageUrl ||
                         !!parsed.optionBImageUrl ||
                         !!parsed.optionCImageUrl ||
                         !!parsed.optionDImageUrl;
      
      // Convert hasDiagram to boolean
      if (typeof parsed.hasDiagram === "string") {
        parsed.hasDiagram = normalizeBoolean(parsed.hasDiagram);
      } else {
        parsed.hasDiagram = Boolean(parsed.hasDiagram);
      }
      
      return parsed;
    });
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
  const questionType = getEffectiveQuestionType(raw);
  const responseType = normalizeResponseType(raw.responseType);
  const isNumericLike = responseType === "numeric" || NUMERIC_LIKE_TYPES.has(questionType);
  const isMultiple = responseType === "multiple";
  const correctOption = normalizeCorrectAnswer(raw.correctAnswer, {
    A: raw.optionA,
    B: raw.optionB,
    C: raw.optionC,
    D: raw.optionD,
  });
  const correctOptions = isMultiple
    ? normalizeCorrectOptions(raw.correctAnswer, {
      A: raw.optionA,
      B: raw.optionB,
      C: raw.optionC,
      D: raw.optionD,
    })
    : [];
  const answerText = normalizeText(raw.numericAnswer) || normalizeText(raw.correctAnswer);
  const examType = normalizeExamType(raw.examType);
  
  // Handle image URLs - ensure they are valid
  const hasAnyImage = Boolean(
    raw.questionImageUrl ||
    raw.optionAImageUrl ||
    raw.optionBImageUrl ||
    raw.optionCImageUrl ||
    raw.optionDImageUrl ||
    raw.explanationImageUrl,
  );

  return {
    examType,
    subjectId: String(matches.subject._id),
    chapterId: String(matches.chapter._id),
    topicId: String(matches.topic._id),
    ...(matches.year ? { yearId: String(matches.year._id) } : {}),
    difficultyId: String(matches.difficulty._id),
    difficulty: normalizeKey(matches.difficulty.key || matches.difficulty.name),
    questionTypeId: String(matches.questionType._id),
    question: normalizeText(raw.question) || "[Image Question]",
    questionImageUrl: raw.questionImageUrl || "",
    optionA: isNumericLike ? "" : normalizeText(raw.optionA),
    optionAImageUrl: raw.optionAImageUrl || "",
    optionB: isNumericLike ? "" : normalizeText(raw.optionB),
    optionBImageUrl: raw.optionBImageUrl || "",
    optionC: isNumericLike ? "" : normalizeText(raw.optionC),
    optionCImageUrl: raw.optionCImageUrl || "",
    optionD: isNumericLike ? "" : normalizeText(raw.optionD),
    optionDImageUrl: raw.optionDImageUrl || "",
    correctOption: isNumericLike ? undefined : (isMultiple ? correctOptions[0] : correctOption),
    correctOptions,
    numericAnswer: isNumericLike ? answerText : "",
    explanation: [normalizeText(raw.explanation), normalizeText(raw.videoUrl) ? `Media: ${normalizeText(raw.videoUrl)}` : ""].filter(Boolean).join("\n\n"),
    explanationImageUrl: raw.explanationImageUrl || "",
    examMode: examType,
    exam: getDefaultExamForExamType(examType),
    responseType: isNumericLike ? "numeric" : responseType || "single",
    conceptTags: parseConceptTags(raw.conceptTags),
    passage: normalizeText(raw.passage),
    hasDiagram: hasAnyImage || normalizeBoolean(raw.hasDiagram),
    isNumerical: isNumericLike || normalizeBoolean(raw.isNumerical),
  };
}

function validateRawRow(raw, catalog) {
  const errors = [];
  const questionType = getEffectiveQuestionType(raw);
  const examType = normalizeExamType(raw.examType);

  if (!normalizeText(raw.question) && !normalizeText(raw.questionImageUrl)) errors.push("Missing Question");
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
    
    // Check if options have either text OR image
    const hasOptionAText = normalizeText(raw.optionA);
    const hasOptionAImage = raw.optionAImageUrl;
    const hasOptionBText = normalizeText(raw.optionB);
    const hasOptionBImage = raw.optionBImageUrl;
    const hasOptionCText = normalizeText(raw.optionC);
    const hasOptionCImage = raw.optionCImageUrl;
    const hasOptionDText = normalizeText(raw.optionD);
    const hasOptionDImage = raw.optionDImageUrl;
    
    if (!hasOptionAText && !hasOptionAImage) errors.push("Missing Option A (text or image)");
    if (!hasOptionBText && !hasOptionBImage) errors.push("Missing Option B (text or image)");
    if (questionType !== "TRUE_FALSE") {
      if (!hasOptionCText && !hasOptionCImage) errors.push("Missing Option C (text or image)");
      if (!hasOptionDText && !hasOptionDImage) errors.push("Missing Option D (text or image)");
    }
    
    const options = { 
      A: raw.optionA || (hasOptionAImage ? "[Image]" : ""), 
      B: raw.optionB || (hasOptionBImage ? "[Image]" : ""), 
      C: raw.optionC || (hasOptionCImage ? "[Image]" : ""), 
      D: raw.optionD || (hasOptionDImage ? "[Image]" : "")
    };
    
    if (responseType === "multiple") {
      if (!normalizeCorrectOptions(raw.correctAnswer, options).length) errors.push("Invalid Correct Answer");
    } else if (!["A", "B", "C", "D"].includes(normalizeCorrectAnswer(raw.correctAnswer, options))) {
      errors.push("Invalid Correct Answer");
    }
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

function countMissingByType(missing = []) {
  return missing.reduce((summary, item) => {
    const key = `${slugify(item.type)}s`;
    summary[key] = Number(summary[key] || 0) + 1;
    return summary;
  }, {});
}

function rowDto(row) {
  return {
    id: String(row._id),
    row: row.rowNumber,
    question: row.question || "",
    status: row.status === "valid" ? "Valid" : row.status,
    error: row.errorMessage || "",
    imageCount: row.imageCount || 0,
  };
}

async function buildPreview(batchId) {
  const [batch, rows] = await Promise.all([
    QuestionBulkUploadBatch.findById(batchId).lean(),
    QuestionBulkUploadRow.find({ batchId }).sort({ rowNumber: 1 }).lean(),
  ]);
  const totalRows = rows.length;
  const validRows = rows.filter((row) => row.status === "valid");
  const invalidRows = rows.filter((row) => row.status === "invalid" || row.status === "failed");
  const missingCategories = summarizeMissing(rows);
  const duplicateCount = rows.filter((row) => row.status === "duplicate" || row.errorMessage?.includes("Duplicate")).length;
  const imageCount = rows.reduce((sum, row) => sum + Number(row.imageCount || countRawImages(row.raw)), 0);

  await QuestionBulkUploadBatch.findByIdAndUpdate(batchId, {
    ...(batch?.status === "pending" || batch?.status === "validating" ? { status: "validated" } : {}),
    totalRows,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    missingCategoriesCount: missingCategories.length,
    duplicateCount,
    imageCount,
    validPercent: percent(validRows.length, totalRows),
  });

  return {
    batchId: String(batchId),
    totalRows,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    missingCategoriesCount: missingCategories.length,
    missingFieldsCount: missingCategories.length,
    missingCounts: countMissingByType(missingCategories),
    duplicateCount,
    imageCount,
    imageProcessingCount: imageCount,
    batchSize: APPROVAL_CHUNK_SIZE,
    totalBatches: Math.ceil(validRows.length / APPROVAL_CHUNK_SIZE),
    createdSummary: batch?.createdSummary || {},
    imageSummary: batch?.imageSummary || { detected: imageCount, uploaded: 0, failed: 0 },
    validPercent: percent(validRows.length, totalRows),
    missingCategories,
    rows: rows.slice(0, 500).map(rowDto),
  };
}

async function validateRowsForBatch(batchId, catalog) {
  const rows = await QuestionBulkUploadRow.find({ batchId }).sort({ rowNumber: 1 });
  const seenKeys = new Set();
  for (const row of rows) {
    const validation = validateRawRow(row.raw, catalog);
    const duplicateKey = buildDuplicateKeyFromRaw(row.raw);
    const errors = [...validation.errors];
    const warnings = Array.isArray(row.raw?.__imageErrors)
      ? row.raw.__imageErrors.map((message) => `Image warning: ${message}`)
      : [];
    if (seenKeys.has(duplicateKey)) errors.push("Duplicate Question in upload file");
    else seenKeys.add(duplicateKey);
    if (!errors.length && validation.payload) {
      const exists = await Question.exists(buildDuplicateQuery(validation.payload));
      if (exists) errors.push("Duplicate Question");
    }
    row.payload = validation.payload || {};
    row.status = errors.some((error) => error.includes("Duplicate")) ? "duplicate" : (errors.length ? "invalid" : "valid");
    row.errorMessage = [...errors, ...warnings].join(", ");
    row.question = (normalizeText(row.raw.question) || "[Image Question]").slice(0, 300);
    row.duplicateKey = duplicateKey;
    row.imageCount = countRawImages(row.raw);
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
  let uploadedImageCount = 0;
  for (const field of IMAGE_FIELDS) {
    if (!normalizeText(nextPayload[field])) continue;
    const before = nextPayload[field];
    nextPayload[field] = await ownQuestionAssetUrl(nextPayload[field]);
    if (before !== nextPayload[field] || String(nextPayload[field]).startsWith("/uploads/")) uploadedImageCount += 1;
  }
  return { payload: nextPayload, uploadedImageCount };
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
  const questionType = getEffectiveQuestionType(raw);
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

const APPROVAL_CHUNK_SIZE = 200;
const activeApprovalJobs = new Set();

async function ensureCategoriesCreatedForBatch(batchId) {
  const batch = await QuestionBulkUploadBatch.findById(batchId);
  if (!batch) throw new AppError("Upload batch not found", 404);

  const rows = await QuestionBulkUploadRow.find({ batchId }).lean();
  if (!rows.length) return;

  let catalog = await loadCatalog();
  const createdSummary = makeEmptySummary();
  for (const row of rows) {
    const raw = row.raw || {};
    const examType = normalizeExamType(raw.examType);
    if (!examType) continue;

    const beforeExamTypes = catalog.examTypes.length;
    await createExamTypeIfMissing(catalog, examType);
    if (catalog.examTypes.length > beforeExamTypes) createdSummary.categories += 1;
    const beforeDifficulties = catalog.difficulties.length;
    await createDifficultyIfMissing(catalog, raw);
    if (catalog.difficulties.length > beforeDifficulties) createdSummary.difficulties += 1;
    const beforeYears = catalog.years.length;
    await createYearIfMissing(catalog, raw, examType);
    if (catalog.years.length > beforeYears) createdSummary.years += 1;
    const beforeQuestionTypes = catalog.questionTypes.length;
    await createQuestionTypeIfMissing(catalog, raw, examType);
    if (catalog.questionTypes.length > beforeQuestionTypes) createdSummary.questionTypes += 1;

    if (!normalizeText(raw.subject)) continue;
    let subject = findSubject(catalog, raw.subject, examType);
    if (!subject) {
      subject = (await Subject.create({ name: normalizeText(raw.subject), examType })).toObject();
      catalog.subjects.push(subject);
      createdSummary.subjects += 1;
    }

    if (!normalizeText(raw.chapter)) continue;
    let chapter = findChapter(catalog, raw.chapter, subject._id);
    if (!chapter) {
      chapter = (await Chapter.create({ subjectId: subject._id, name: normalizeText(raw.chapter) })).toObject();
      catalog.chapters.push(chapter);
      createdSummary.chapters += 1;
    }

    if (!normalizeText(raw.topic)) continue;
    let topic = findTopic(catalog, raw.topic, subject._id, chapter._id);
    if (!topic) {
      topic = (await Topic.create({ subjectId: subject._id, chapterId: chapter._id, name: normalizeText(raw.topic) })).toObject();
      catalog.topics.push(topic);
      createdSummary.topics += 1;
    }
    const tags = parseConceptTags(raw.conceptTags);
    createdSummary.tags += tags.length;
  }

  catalog = await loadCatalog();
  await validateRowsForBatch(batchId, catalog);
  batch.status = "categories_created";
  createdSummary.relatedEntities = createdSummary.categories + createdSummary.subjects + createdSummary.chapters + createdSummary.topics + createdSummary.difficulties + createdSummary.questionTypes + createdSummary.years;
  batch.createdSummary = createdSummary;
  await batch.save();
  return createdSummary;
}

async function processApprovalJob(batchId) {
  const batch = await QuestionBulkUploadBatch.findById(batchId);
  if (!batch) throw new AppError("Upload batch not found", 404);

  batch.status = "processing";
  batch.startedAt = batch.startedAt || new Date();
  batch.batchSize = APPROVAL_CHUNK_SIZE;
  await batch.save();

  const rows = await QuestionBulkUploadRow.find({ batchId, status: "valid" }).sort({ rowNumber: 1 });
  let inserted = await QuestionBulkUploadRow.countDocuments({ batchId, status: "approved" });
  let failed = 0;
  let skipped = await QuestionBulkUploadRow.countDocuments({ batchId, status: { $in: ["duplicate", "skipped"] } });
  let uploadedImageCount = Number(batch.uploadedImageCount || 0);

  for (let index = 0; index < rows.length; index += APPROVAL_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + APPROVAL_CHUNK_SIZE);
    await QuestionBulkUploadBatch.findByIdAndUpdate(batchId, {
      currentBatch: Math.floor(index / APPROVAL_CHUNK_SIZE) + 1,
      totalBatches: Math.ceil(rows.length / APPROVAL_CHUNK_SIZE),
      processedCount: inserted + failed + skipped + Number(batch.invalidCount || 0),
    });
    for (const row of chunk) {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          row.status = "processing";
          row.attempts = attempt;
          await row.save();
          const owned = await ownQuestionPayloadAssetUrls(sanitizeQuestionPayload(row.payload));
          const payload = owned.payload;
          uploadedImageCount += owned.uploadedImageCount;
          row.uploadedImageCount = owned.uploadedImageCount;

          const exists = await Question.exists(buildDuplicateQuery(payload));
          if (exists) {
            row.status = "duplicate";
            row.errorMessage = "Duplicate Question";
            skipped += 1;
            await row.save();
            lastError = null;
            break;
          }

          const created = await Question.create(payload);
          row.status = "approved";
          row.uploadedQuestionId = created._id;
          row.errorMessage = "";
          inserted += 1;
          await row.save();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) {
        row.status = "failed";
        row.errorMessage = lastError.message || "Question upload failed";
        failed += 1;
        await row.save();
      }
    }
  }

  const latestBatch = await QuestionBulkUploadBatch.findById(batchId);
  const failedRows = await QuestionBulkUploadRow.countDocuments({ batchId, status: "failed" });
  const approvedRows = await QuestionBulkUploadRow.countDocuments({ batchId, status: "approved" });
  const duplicateRows = await QuestionBulkUploadRow.countDocuments({ batchId, status: "duplicate" });
  latestBatch.status = failedRows > 0 && approvedRows === 0 ? "failed" : "approved";
  latestBatch.insertedCount = approvedRows;
  latestBatch.skippedCount = duplicateRows;
  latestBatch.uploadedImageCount = uploadedImageCount;
  latestBatch.failedCount = Number(latestBatch.invalidCount || 0) + failedRows;
  latestBatch.processedCount = approvedRows + failedRows + duplicateRows + Number(latestBatch.invalidCount || 0);
  latestBatch.completedAt = new Date();
  latestBatch.imageSummary = {
    detected: Number(latestBatch.imageCount || 0),
    uploaded: uploadedImageCount,
    failed: Math.max(0, Number(latestBatch.imageCount || 0) - uploadedImageCount),
  };
  await latestBatch.save();
}

export const questionBulkUploadService = {
  async validateFile({ sheetFile, uploadedBy }) {
    const parsedRows = await parseSheet(sheetFile);
    const batch = await QuestionBulkUploadBatch.create({
      fileName: sheetFile.originalname || "questions-upload",
      uploadedBy: uploadedBy || undefined,
      status: "validating",
      totalRows: parsedRows.length,
      batchSize: APPROVAL_CHUNK_SIZE,
      totalBatches: Math.ceil(parsedRows.length / APPROVAL_CHUNK_SIZE),
    });

    const catalog = await loadCatalog();
    await QuestionBulkUploadRow.insertMany(parsedRows.map((raw, index) => ({
        batchId: batch._id,
        rowNumber: Number(raw.__rowNumber) || index + 2,
        raw,
        payload: {},
        question: normalizeText(raw.question).slice(0, 300),
        status: "invalid",
        errorMessage: "Queued for validation",
        duplicateKey: buildDuplicateKeyFromRaw(raw),
        imageCount: countRawImages(raw),
      })), { ordered: false });

    await validateRowsForBatch(batch._id, catalog);

    return buildPreview(batch._id);
  },

  async createMissingCategories({ batchId }) {
    if (!mongoose.isValidObjectId(batchId)) throw new AppError("Invalid upload batch", 400);
    const batch = await QuestionBulkUploadBatch.findById(batchId);
    if (!batch) throw new AppError("Upload batch not found", 404);
    await ensureCategoriesCreatedForBatch(batch._id);
    return buildPreview(batch._id);
  },

  async approve({ batchId }) {
    if (!mongoose.isValidObjectId(batchId)) throw new AppError("Invalid upload batch", 400);
    const batch = await QuestionBulkUploadBatch.findById(batchId);
    if (!batch) throw new AppError("Upload batch not found", 404);

    await ensureCategoriesCreatedForBatch(batchId);

    await QuestionBulkUploadBatch.findByIdAndUpdate(batchId, {
      status: "processing",
      startedAt: batch.startedAt || new Date(),
      batchSize: APPROVAL_CHUNK_SIZE,
    });

    const jobKey = String(batchId);
    if (!activeApprovalJobs.has(jobKey)) {
      activeApprovalJobs.add(jobKey);
      setImmediate(async () => {
        try {
          await processApprovalJob(batchId);
        } catch (error) {
          await QuestionBulkUploadBatch.findByIdAndUpdate(batchId, {
            status: "failed",
            completedAt: new Date(),
          });
          console.error("[BULK_UPLOAD] Approval job failed", error);
        } finally {
          activeApprovalJobs.delete(jobKey);
        }
      });
    }

    return this.getStatus({ batchId });
  },

  async getStatus({ batchId }) {
    if (!mongoose.isValidObjectId(batchId)) throw new AppError("Invalid upload batch", 400);
    const batch = await QuestionBulkUploadBatch.findById(batchId).lean();
    if (!batch) throw new AppError("Upload batch not found", 404);
    const rows = await QuestionBulkUploadRow.find({ batchId }).sort({ rowNumber: 1 }).lean();
    const approved = rows.filter((row) => row.status === "approved").length;
    const failed = rows.filter((row) => row.status === "failed" || row.status === "invalid").length;
    const duplicates = rows.filter((row) => row.status === "duplicate").length;
    const processed = approved + failed + duplicates;
    const completedAt = batch.completedAt ? new Date(batch.completedAt) : null;
    const startedAt = batch.startedAt ? new Date(batch.startedAt) : null;
    const processingTimeMs = completedAt && startedAt ? completedAt.getTime() - startedAt.getTime() : 0;
    return {
      batchId: String(batch._id),
      status: batch.status,
      totalRows: batch.totalRows,
      validCount: batch.validCount,
      invalidCount: batch.invalidCount,
      successCount: approved,
      failedCount: failed,
      skippedDuplicatesCount: duplicates,
      imageCount: batch.imageCount,
      uploadedImageCount: batch.uploadedImageCount,
      processingTimeMs,
      processingTimeSeconds: Math.round(processingTimeMs / 1000),
      currentBatch: batch.currentBatch,
      totalBatches: batch.totalBatches,
      progressPercent: percent(processed, batch.totalRows),
      successPercent: percent(approved, batch.totalRows),
      failedPercent: percent(failed, batch.totalRows),
      createdSummary: batch.createdSummary || {},
      imageSummary: batch.imageSummary || {},
      rows: rows.slice(0, 500).map(rowDto),
    };
  },
};
