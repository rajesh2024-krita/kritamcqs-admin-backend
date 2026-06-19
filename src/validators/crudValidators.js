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
    questionId: z.string().optional(),
    lastModifiedFrom: z.string().optional(),
    lastModifiedTo: z.string().optional(),
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
    category: z.string().optional(),
    isActive: z.string().optional(),
    isDefault: z.string().optional(),
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
  iconUrl: z.string().max(500).optional().or(z.literal("")),
  imageUrl: z.string().max(500).optional().or(z.literal("")),
  color: z.string().max(32).optional().or(z.literal("")),
});

export const chapterBodySchema = z.object({
  subjectId: z.string().min(1),
  name: z.string().min(2).max(120),
  isLockedForFreeUsers: z.boolean().optional(),
  iconUrl: z.string().max(500).optional().or(z.literal("")),
  imageUrl: z.string().max(500).optional().or(z.literal("")),
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
    "contact",
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

const listStyleLevelBodySchema = z.object({
  level: z.coerce.number().int().min(1).max(9).optional().default(1),
  listStyleType: z.string().trim().min(1).max(80).optional().default("decimal"),
  markerTemplate: z.string().trim().min(1).max(80).optional().default("{value}."),
  markerSuffix: z.string().trim().max(20).optional().default("."),
  indentation: z.coerce.number().int().min(0).max(120).optional().default(24),
});

export const listStyleBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  key: z.string().trim().min(2).max(80).optional(),
  category: z.enum(["unordered", "ordered", "alphabetical", "roman", "parenthesis", "multilevel", "custom"]).optional().default("ordered"),
  listStyleType: z.string().trim().min(1).max(80).optional().default("decimal"),
  markerTemplate: z.string().trim().min(1).max(80).optional().default("{value}."),
  markerSuffix: z.string().trim().max(20).optional().default("."),
  startAt: z.coerce.number().int().min(1).optional().default(1),
  levels: z.array(listStyleLevelBodySchema).max(9).optional().default([]),
  description: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const questionBodySchema = z.object({
  examType: examTypeSchema,
  subjectId: z.string().min(1),
  chapterId: z.string().min(1),
  topicId: z.string().min(1),
  yearId: z.string().min(1).optional().or(z.literal("")),
  difficultyId: z.string().min(1).optional().or(z.literal("")),
  questionTypeId: z.string().min(1),
  question: z.string().min(1),
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
  if (!allowIncomplete && String(value.question || "").trim() === "") {
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
      if (String(textValue || "").trim() === "") {
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
  question: z.string().optional(),
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
  strikeOutAmount: z.coerce.number().min(0).optional().default(0),
  stikeOutAmount: z.coerce.number().min(0).optional(),
  strikeoutAmount: z.coerce.number().min(0).optional(),
  originalPrice: z.coerce.number().min(0).optional(),
  mrp: z.coerce.number().min(0).optional(),
  durationMonths: z.coerce.number().int().min(1).max(60),
  description: z.string().max(1000).optional().or(z.literal("")),
  savings: z.string().max(160).optional().or(z.literal("")),
  features: z.array(z.string().min(1)).optional().default([]),
  active: z.boolean().optional().default(true),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
});

export const subscriptionStatCardBodySchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  valueType: z.enum(["number", "text"]).optional().default("number"),
  valueMode: z.enum(["manual", "live"]).optional().default("manual"),
  manualValue: z.coerce.number().min(0).optional().default(0),
  manualText: z.string().trim().max(120).optional().or(z.literal("")),
  liveSource: z.enum(["users", "premiumUsers", "subscriptions"]).optional().default("users"),
  suffix: z.string().trim().max(20).optional().or(z.literal("")),
  iconKey: z.enum(["users", "shield", "zap"]).optional().default("users"),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
});

export const subscriptionFreeCardBodySchema = z.object({
  key: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(300).optional().or(z.literal("")),
  items: z.array(z.string().trim().min(1).max(160)).optional().default([]),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
});

const statusSchema = z.enum(["draft", "published"]).optional().default("draft");

export const policyPageBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(180),
  type: z.enum(["privacy", "terms", "refund", "cancellation", "shipping", "custom"]).optional().default("custom"),
  seoTitle: z.string().trim().max(180).optional().or(z.literal("")),
  seoDescription: z.string().trim().max(320).optional().or(z.literal("")),
  seoKeywords: z.string().trim().max(500).optional().or(z.literal("")),
  ogTitle: z.string().trim().max(180).optional().or(z.literal("")),
  ogDescription: z.string().trim().max(320).optional().or(z.literal("")),
  ogImage: z.string().trim().max(500).optional().or(z.literal("")),
  canonicalUrl: z.string().trim().max(500).optional().or(z.literal("")),
  noIndex: z.boolean().optional().default(false),
  html: z.string().max(200000).optional().or(z.literal("")),
  css: z.string().max(100000).optional().or(z.literal("")),
  status: statusSchema,
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
});

export const cmsPageBodySchema = z.object({
  title: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(180),
  metaTitle: z.string().trim().max(180).optional().or(z.literal("")),
  metaDescription: z.string().trim().max(320).optional().or(z.literal("")),
  seoKeywords: z.string().trim().max(500).optional().or(z.literal("")),
  ogTitle: z.string().trim().max(180).optional().or(z.literal("")),
  ogDescription: z.string().trim().max(320).optional().or(z.literal("")),
  ogImage: z.string().trim().max(500).optional().or(z.literal("")),
  canonicalUrl: z.string().trim().max(500).optional().or(z.literal("")),
  noIndex: z.boolean().optional().default(false),
  featuredImage: z.string().trim().max(500).optional().or(z.literal("")),
  menuName: z.string().trim().max(120).optional().or(z.literal("")),
  parentMenu: z.string().trim().max(120).optional().or(z.literal("")),
  html: z.string().max(300000).optional().or(z.literal("")),
  css: z.string().max(100000).optional().or(z.literal("")),
  scripts: z.string().max(100000).optional().or(z.literal("")),
  status: statusSchema,
  active: z.boolean().optional().default(true),
  showInMenu: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
  scheduledPublishAt: z.string().optional().or(z.literal("")),
});

export const cmsMenuItemBodySchema = z.object({
  label: z.string().trim().min(1).max(120),
  pageSlug: z.string().trim().max(180).optional().or(z.literal("")),
  href: z.string().trim().max(500).optional().or(z.literal("")),
  linkType: z.enum(["page", "section", "external"]).optional().default("page"),
  parentId: z.string().trim().max(80).optional().or(z.literal("")),
  area: z.enum(["navbar", "footer", "both"]).optional().default("navbar"),
  visible: z.boolean().optional().default(true),
  active: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(1),
});

export const websiteSettingsBodySchema = z.object({
  websiteMode: z.enum(["single", "multiple"]).optional().default("single"),
  navbarStyle: z.enum(["style1", "style2", "style3", "centerLogo", "leftLogo"]).optional().default("style1"),
  stickyNavbar: z.boolean().optional().default(true),
  transparentNavbar: z.boolean().optional().default(false),
  logoUrl: z.string().trim().max(500).optional().or(z.literal("")),
  primaryColor: z.string().trim().max(32).optional().or(z.literal("")),
  backgroundColor: z.string().trim().max(32).optional().or(z.literal("")),
  menuTextColor: z.string().trim().max(32).optional().or(z.literal("")),
  ctaEnabled: z.boolean().optional().default(true),
  ctaLabel: z.string().trim().max(80).optional().or(z.literal("")),
  ctaHref: z.string().trim().max(500).optional().or(z.literal("")),
  mobileMenuEnabled: z.boolean().optional().default(true),
  footerLayout: z.enum(["layout1", "layout2", "layout3"]).optional().default("layout1"),
  footerMenusEnabled: z.boolean().optional().default(true),
  copyrightText: z.string().trim().max(300).optional().or(z.literal("")),
  socialLinks: z.record(z.any()).optional().default({}),
  active: z.boolean().optional().default(true),
});

const builderBlockBodySchema = z.object({
  id: z.string().trim().max(120).optional().or(z.literal("")),
  type: z.string().trim().min(1).max(80),
  props: z.record(z.any()).optional().default({}),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const subscriptionPageTemplateBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(1).max(160),
  description: z.string().max(1000).optional().or(z.literal("")),
  blocks: z.array(builderBlockBodySchema).optional().default([]),
  status: z.enum(["draft", "published", "archived"]).optional().default("draft"),
  isDefault: z.boolean().optional().default(false),
});

export const dashboardCarouselBannerBodySchema = z.object({
  title: z.string().trim().max(160).optional().or(z.literal("")).default(""),
  subtitle: z.string().max(300).optional().or(z.literal("")),
  imageUrl: z.string().trim().min(1).max(500),
  redirectLink: z.string().max(500).optional().or(z.literal("")),
  imagePositionX: z.coerce.number().min(0).max(100).optional().default(50),
  imagePositionY: z.coerce.number().min(0).max(100).optional().default(50),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
  enabled: z.boolean().optional().default(true),
});

export const explanationPreviewTemplateBodySchema = z.object({
  key: z.string().trim().min(1).max(120).optional().default("default"),
  name: z.string().trim().min(2).max(160),
  layout: z.record(z.any()).optional().default({}),
  status: z.enum(["draft", "published"]).optional().default("published"),
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
  listStyle: z.object({ body: listStyleBodySchema }),
  question: z.object({ body: questionBodySchema }),
  user: z.object({ body: userBodySchema }),
  emailTemplate: z.object({ body: emailTemplateBodySchema }),
  coupon: z.object({ body: couponBodySchema }),
  subscriptionPlan: z.object({ body: subscriptionPlanBodySchema }),
  subscriptionFreeCard: z.object({ body: subscriptionFreeCardBodySchema }),
  subscriptionStatCard: z.object({ body: subscriptionStatCardBodySchema }),
  policyPage: z.object({ body: policyPageBodySchema }),
  cmsPage: z.object({ body: cmsPageBodySchema }),
  cmsMenuItem: z.object({ body: cmsMenuItemBodySchema }),
  websiteSettings: z.object({ body: websiteSettingsBodySchema }),
  subscriptionPageTemplate: z.object({ body: subscriptionPageTemplateBodySchema }),
  dashboardCarouselBanner: z.object({ body: dashboardCarouselBannerBodySchema }),
  explanationPreviewTemplate: z.object({ body: explanationPreviewTemplateBodySchema }),
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
  listStyle: z.object({ body: listStyleBodySchema.partial() }),
  question: z.object({ body: questionUpdateBodySchema }),
  user: z.object({ body: userUpdateBodySchema }),
  emailTemplate: z.object({ body: emailTemplateBodySchema.partial() }),
  coupon: z.object({ body: couponBodySchema.partial() }),
  subscriptionPlan: z.object({ body: subscriptionPlanBodySchema.partial() }),
  subscriptionFreeCard: z.object({ body: subscriptionFreeCardBodySchema.partial() }),
  subscriptionStatCard: z.object({ body: subscriptionStatCardBodySchema.partial() }),
  policyPage: z.object({ body: policyPageBodySchema.partial() }),
  cmsPage: z.object({ body: cmsPageBodySchema.partial() }),
  cmsMenuItem: z.object({ body: cmsMenuItemBodySchema.partial() }),
  websiteSettings: z.object({ body: websiteSettingsBodySchema.partial() }),
  subscriptionPageTemplate: z.object({ body: subscriptionPageTemplateBodySchema.partial() }),
  dashboardCarouselBanner: z.object({ body: dashboardCarouselBannerBodySchema.partial() }),
  explanationPreviewTemplate: z.object({ body: explanationPreviewTemplateBodySchema.partial() }),
  dailyPlan: z.object({ body: dailyPlanBodySchema.partial() }),
};
