import { z } from "zod";
import { examModeSchema, passwordSchema, userLevelSchema } from "./common.js";

export const bootstrapAdminSchema = z.object({
  body: z.object({
    mobile: z.string().min(10).max(15),
    email: z.string().email().optional(),
    name: z.string().min(2).max(80),
    password: passwordSchema,
    examMode: examModeSchema.optional(),
    level: userLevelSchema.optional(),
  }),
});

export const registerAdminSchema = bootstrapAdminSchema;

export const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(3),
    password: passwordSchema,
  }),
});
