import { z } from "zod";
import { EXAM_CATEGORIES, EXAM_MODES, EXAM_TYPES, EXAMS, QUESTION_DIFFICULTIES, QUESTION_RESPONSE_TYPES, USER_LEVELS } from "../types/constants.js";

export const examModeSchema = z.enum(EXAM_MODES);
export const examTypeSchema = z.enum(EXAM_TYPES);
export const userLevelSchema = z.enum(USER_LEVELS);
export const examCategorySchema = z.enum(EXAM_CATEGORIES).optional();
export const examSchema = z.enum(EXAMS);
export const difficultySchema = z.enum(QUESTION_DIFFICULTIES);
export const responseTypeSchema = z.enum(QUESTION_RESPONSE_TYPES);
export const passwordSchema = z.string().min(6).max(128);
export const paginationQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});
