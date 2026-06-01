import { z } from "zod";
import {
  difficultySchema,
  examModeSchema,
  examTypeSchema,
  examSchema,
  paginationQuerySchema,
  passwordSchema,
  responseTypeSchema,
  userLevelSchema,
} from "./common.js";

export const listQuerySchema = z.object({
  query: paginationQuerySchema.extend({
    examMode: z.string().optional(),
    examType: z.string().optional(),
    mode: z.string().optional(),
    modeId: z.string().optional(),
    _id: z.string().optional(),
    subjectId: z.string().optional(),
    chapterId: z.string().optional(),
    topicId: z.string().optional(),
    yearId: z.string().optional(),
    questionTypeId: z.string().optional(),
    examCategory: z.string().optional(),
    difficulty: z.string().optional(),
    responseType: z.string().optional(),
    questionStatus: z.string().optional(),
    reviewStatus: z.string().optional(),
    isVisibleToUsers: z.string().optional(),
    exact: z.string().optional(),
    displayVariant: z.string().optional(),
    isPremium: z.string().optional(),
    isAdmin: z.string().optional(),
    onboardingComplete: z.string().optional(),
    active: z.string().optional(),
    type: z.string().optional(),
  }),
});

export const bulkDeleteSchema = z.object({
  body: z.object({
    ids: z.array(z.string().trim().min(1)).min(1).max(1000),
  }),
});

export const modeBodySchema = z.object({
  key: z.string().trim().min(2).max(80),
  label: z.string().min(2).max(80),
  description: z.string().max(500).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const learningLevelBodySchema = z.object({
  key: z.string().trim().min(2).max(80),
  label: z.string().trim().min(2).max(80),
  description: z.string().max(500).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const examTypeBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const subjectBodySchema = z.object({
  name: z.string().min(2).max(120),
  examType: examTypeSchema,
  icon: z.string().max(80).optional().or(z.literal("")),
  color: z.string().max(32).optional().or(z.literal("")),
});

export const chapterBodySchema = z.object({
  subjectId: z.string().min(1),
  name: z.string().min(2).max(120),
  isLockedForFreeUsers: z.boolean().optional(),
});

export const topicBodySchema = z.object({
  subjectId: z.string().min(1),
  chapterId: z.string().min(1),
  name: z.string().min(1).max(120),
});

export const difficultyBodySchema = z.object({
  key: z.string().min(2).max(40),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const yearBodySchema = z.object({
  name: z.string().min(2).max(80),
  examType: examTypeSchema,
});

export const emailTemplateBodySchema = z.object({
  key: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  type: z.enum([
    "forgot_password",
    "otp_verification",
    "welcome",
    "notification",
    "offer",
    "announcement",
    "update",
    "invoice",
    "registration",
    "verification",
    "subscription",
    "payment_success",
    "reminder",
    "broadcast",
    "expiry",
    "helpdesk",
    "admin_notification",
  ]),
  module: z.string().trim().max(80).optional().or(z.literal("")),
  subject: z.string().trim().min(2).max(180),
  htmlContent: z.string().optional().or(z.literal("")),
  textContent: z.string().optional().or(z.literal("")),
  variables: z.array(z.string().trim().min(1)).optional().default([]),
  sampleData: z.record(z.any()).optional().default({}),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

export const questionTypeBodySchema = z.object({
  name: z.string().min(2).max(120),
  examType: z.string().trim().min(2).max(80),
  key: z.string().min(2).max(80).optional(),
  label: z.string().min(2).max(120).optional(),
  examCategory: z.string().trim().min(2).max(80).optional(),
  responseType: responseTypeSchema.optional().default("single"),
  displayVariant: z.string().trim().min(2).max(80).optional().or(z.literal("")),
  exampleQuestion: z.string().max(2000).optional().or(z.literal("")),
  exampleOptions: z.string().max(2000).optional().or(z.literal("")),
  exampleAnswer: z.string().max(500).optional().or(z.literal("")),
  exampleExplanation: z.string().max(2000).optional().or(z.literal("")),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const questionBodySchema = z.object({
  examType: examTypeSchema,
  subjectId: z.string().min(1),
  chapterId: z.string().min(1),
  topicId: z.string().min(1),
  yearId: z.string().min(1).optional().or(z.literal("")),
  difficultyId: z.string().min(1).optional().or(z.literal("")),
  questionTypeId: z.string().min(1),
  question: z.string().trim().min(1),
  questionImageUrl: z.string().optional().or(z.literal("")),
  optionA: z.string().optional().or(z.literal("")),
  optionAImageUrl: z.string().optional().or(z.literal("")),
  optionB: z.string().optional().or(z.literal("")),
  optionBImageUrl: z.string().optional().or(z.literal("")),
  optionC: z.string().optional().or(z.literal("")),
  optionCImageUrl: z.string().optional().or(z.literal("")),
  optionD: z.string().optional().or(z.literal("")),
  optionDImageUrl: z.string().optional().or(z.literal("")),
  correctOption: z.enum(["A", "B", "C", "D"]).optional(),
  correctOptions: z.array(z.enum(["A", "B", "C", "D"])).optional().default([]),
  explanation: z.string().optional().or(z.literal("")),
  explanationImageUrl: z.string().optional().or(z.literal("")),
  difficulty: difficultySchema.optional(),
  examMode: examModeSchema.optional(),
  exam: examSchema.optional(),
  responseType: responseTypeSchema,
  conceptTags: z.array(z.string().min(1)).optional().default([]),
  numericAnswer: z.string().optional().or(z.literal("")),
  passage: z.string().optional().or(z.literal("")),
  hasDiagram: z.boolean().optional().default(false),
  isNumerical: z.boolean().optional().default(false),
  questionStatus: z.enum(["complete", "incomplete"]).optional().default("complete"),
  reviewStatus: z.enum(["ready", "needs_review"]).optional().default("ready"),
  isVisibleToUsers: z.boolean().optional().default(true),
  uploadWarnings: z.array(z.string()).optional().default([]),
  extraFields: z.record(z.any()).optional().default({}),
}).superRefine((value, ctx) => {
  const allowIncomplete = value.questionStatus === "incomplete" || value.reviewStatus === "needs_review" || value.isVisibleToUsers === false;
  const isNumeric = value.responseType === "numeric" || value.isNumerical === true;
  if (value.examType === "NEET" && isNumeric) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["responseType"], message: "NEET supports MCQ questions only." });
  }
  if (!value.difficultyId && !value.difficulty) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["difficultyId"], message: "Difficulty is required." });
  }
  if (!allowIncomplete && !value.question) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["question"], message: "Question text is required." });
  }
  if (value.responseType === "numeric" && !value.numericAnswer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numericAnswer"], message: "Numeric answer is required." });
  }
  if (value.responseType === "numeric" && value.numericAnswer && !/^-?\d+(\.\d+)?$/.test(String(value.numericAnswer).trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numericAnswer"], message: "Numeric answer must be a valid integer or decimal." });
  }
  if (!allowIncomplete && value.responseType !== "numeric" && !value.correctOption) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["correctOption"], message: "Correct option is required." });
  }
  if (!allowIncomplete && value.responseType !== "numeric") {
    ["A", "B", "C", "D"].forEach((optionKey) => {
      const textValue = value[`option${optionKey}`];
      if (!textValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`option${optionKey}`],
          message: `Option ${optionKey} is required.`,
        });
      }
    });
  }
});

export const questionUpdateBodySchema = z.object({
  examType: examTypeSchema.optional(),
  subjectId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional().or(z.literal("")),
  topicId: z.string().min(1).optional().or(z.literal("")),
  yearId: z.string().min(1).optional().or(z.literal("")),
  difficultyId: z.string().min(1).optional().or(z.literal("")),
  questionTypeId: z.string().min(1).optional(),
  question: z.string().trim().optional(),
  questionImageUrl: z.string().optional().or(z.literal("")),
  optionA: z.string().optional().or(z.literal("")),
  optionAImageUrl: z.string().optional().or(z.literal("")),
  optionB: z.string().optional().or(z.literal("")),
  optionBImageUrl: z.string().optional().or(z.literal("")),
  optionC: z.string().optional().or(z.literal("")),
  optionCImageUrl: z.string().optional().or(z.literal("")),
  optionD: z.string().optional().or(z.literal("")),
  optionDImageUrl: z.string().optional().or(z.literal("")),
  correctOption: z.enum(["A", "B", "C", "D"]).optional(),
  correctOptions: z.array(z.enum(["A", "B", "C", "D"])).optional(),
  explanation: z.string().optional().or(z.literal("")),
  explanationImageUrl: z.string().optional().or(z.literal("")),
  difficulty: difficultySchema.optional(),
  examMode: examModeSchema.optional(),
  exam: examSchema.optional(),
  responseType: responseTypeSchema.optional(),
  conceptTags: z.array(z.string().min(1)).optional(),
  numericAnswer: z.string().optional().or(z.literal("")),
  passage: z.string().optional().or(z.literal("")),
  hasDiagram: z.boolean().optional(),
  isNumerical: z.boolean().optional(),
  questionStatus: z.enum(["complete", "incomplete"]).optional(),
  reviewStatus: z.enum(["ready", "needs_review"]).optional(),
  isVisibleToUsers: z.boolean().optional(),
  uploadWarnings: z.array(z.string()).optional(),
  extraFields: z.record(z.any()).optional(),
}).superRefine((value, ctx) => {
  const allowIncomplete = value.questionStatus === "incomplete" || value.reviewStatus === "needs_review" || value.isVisibleToUsers === false;
  const isNumeric = value.responseType === "numeric" || value.isNumerical === true;
  if (value.examType === "NEET" && isNumeric) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["responseType"], message: "NEET supports MCQ questions only." });
  }
  if (!allowIncomplete && value.question !== undefined && value.question.trim() === "") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["question"], message: "Question text is required." });
  }
  if (value.responseType === "numeric" && value.numericAnswer === "") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numericAnswer"], message: "Numeric answer is required." });
  }
  if (value.responseType === "numeric" && value.numericAnswer && !/^-?\d+(\.\d+)?$/.test(String(value.numericAnswer).trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["numericAnswer"], message: "Numeric answer must be a valid integer or decimal." });
  }
  if (!allowIncomplete && value.responseType && value.responseType !== "numeric" && !value.correctOption) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["correctOption"], message: "Correct option is required when response type is objective." });
  }
  if (!allowIncomplete && value.responseType && value.responseType !== "numeric") {
    ["A", "B", "C", "D"].forEach((optionKey) => {
      const textValue = value[`option${optionKey}`];
      if (textValue !== undefined && String(textValue).trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`option${optionKey}`],
          message: `Option ${optionKey} is required.`,
        });
      }
    });
  }
});

export const userBodySchema = z.object({
  mobile: z.string().min(10).max(15).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  password: passwordSchema.optional(),
  name: z.string().min(2).max(80),
  examMode: examModeSchema.optional(),
  level: userLevelSchema.optional(),
  onboardingComplete: z.boolean().optional().default(false),
  mobileVerified: z.boolean().optional().default(false),
  isPremium: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  isBlocked: z.boolean().optional().default(false),
  premiumExpiresAt: z.string().datetime().optional().or(z.literal("")),
  isAdmin: z.boolean().optional().default(false),
  migratedFromOldApp: z.boolean().optional().default(false),
});

export const userUpdateBodySchema = userBodySchema.partial();

export const couponBodySchema = z.object({
  code: z.string().min(2).max(40),
  type: z.enum(["amount", "percent"]),
  value: z.coerce.number().positive(),
  active: z.boolean().optional().default(true),
  validFrom: z.string().datetime().optional().or(z.literal("")),
  validUntil: z.string().datetime().optional().or(z.literal("")),
  usageLimit: z.union([z.literal(""), z.coerce.number().int().min(1)]).optional(),
  usedCount: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional().default(0),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const subscriptionPlanBodySchema = z.object({
  planId: z.string().min(1).max(80),
  name: z.string().min(2).max(120),
  price: z.coerce.number().min(0),
  durationMonths: z.coerce.number().int().min(1).max(60),
  savings: z.string().max(160).optional().or(z.literal("")),
  features: z.array(z.string().min(1)).optional().default([]),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
});

export const dailyPlanBodySchema = z.object({
  modeKey: examModeSchema,
  selectionMode: z.enum(["random", "manual"]).optional().default("random"),
  questionCount: z.coerce.number().int().min(1).max(200).optional().default(20),
  manualQuestionIds: z.array(z.string().min(1)).optional().default([]),
  autoFillRemaining: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
  title: z.string().max(120).optional().or(z.literal("")),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const createSchemas = {
  mode: z.object({ body: modeBodySchema }),
  learningLevel: z.object({ body: learningLevelBodySchema }),
  examType: z.object({ body: examTypeBodySchema }),
  subject: z.object({ body: subjectBodySchema }),
  chapter: z.object({ body: chapterBodySchema }),
  topic: z.object({ body: topicBodySchema }),
  difficulty: z.object({ body: difficultyBodySchema }),
  year: z.object({ body: yearBodySchema }),
  questionType: z.object({ body: questionTypeBodySchema }),
  question: z.object({ body: questionBodySchema }),
  user: z.object({ body: userBodySchema }),
  emailTemplate: z.object({ body: emailTemplateBodySchema }),
  coupon: z.object({ body: couponBodySchema }),
  subscriptionPlan: z.object({ body: subscriptionPlanBodySchema }),
  dailyPlan: z.object({ body: dailyPlanBodySchema }),
};

export const updateSchemas = {
  mode: z.object({ body: modeBodySchema.partial() }),
  learningLevel: z.object({ body: learningLevelBodySchema.partial() }),
  examType: z.object({ body: examTypeBodySchema.partial() }),
  subject: z.object({ body: subjectBodySchema.partial() }),
  chapter: z.object({ body: chapterBodySchema.partial() }),
  topic: z.object({ body: topicBodySchema.partial() }),
  difficulty: z.object({ body: difficultyBodySchema.partial() }),
  year: z.object({ body: yearBodySchema.partial() }),
  questionType: z.object({ body: questionTypeBodySchema.partial() }),
  question: z.object({ body: questionUpdateBodySchema }),
  user: z.object({ body: userUpdateBodySchema }),
  emailTemplate: z.object({ body: emailTemplateBodySchema.partial() }),
  coupon: z.object({ body: couponBodySchema.partial() }),
  subscriptionPlan: z.object({ body: subscriptionPlanBodySchema.partial() }),
  dailyPlan: z.object({ body: dailyPlanBodySchema.partial() }),
};
