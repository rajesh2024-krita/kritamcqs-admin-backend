import { Router } from "express";
import { adminAuthController } from "../controllers/adminAuthController.js";
import { requireAdmin } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { bootstrapAdminSchema, loginSchema, registerAdminSchema } from "../validators/adminAuthValidator.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/status", asyncHandler(adminAuthController.status));
router.post("/bootstrap", validate(bootstrapAdminSchema), asyncHandler(adminAuthController.bootstrap));
router.post("/register", validate(registerAdminSchema), asyncHandler(adminAuthController.register));
router.post("/login", validate(loginSchema), asyncHandler(adminAuthController.login));
router.post("/logout", requireAdmin, asyncHandler(adminAuthController.logout));
router.get("/me", requireAdmin, asyncHandler(adminAuthController.me));

export default router;
