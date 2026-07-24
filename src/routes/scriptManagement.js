import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/apiResponse.js";
import { requireAdmin } from "../middlewares/auth.js";
import { scriptManagementService } from "../services/scriptManagementService.js";

export const adminScriptRouter = Router();

adminScriptRouter.use(requireAdmin);

adminScriptRouter.get(
  "/scripts",
  asyncHandler(async (req, res) => {
    const result = await scriptManagementService.list(req.query);
    sendResponse(res, { data: result.items, meta: result.meta });
  }),
);

adminScriptRouter.get(
  "/scripts/:id",
  asyncHandler(async (req, res) => {
    const data = await scriptManagementService.getById(req.params.id);
    sendResponse(res, { data });
  }),
);

adminScriptRouter.post(
  "/scripts",
  asyncHandler(async (req, res) => {
    const data = await scriptManagementService.create(req.body, req.admin);
    sendResponse(res, { status: 201, message: "Script created successfully", data });
  }),
);

adminScriptRouter.put(
  "/scripts/:id",
  asyncHandler(async (req, res) => {
    const data = await scriptManagementService.update(req.params.id, req.body, req.admin);
    sendResponse(res, { message: "Script updated successfully", data });
  }),
);

adminScriptRouter.delete(
  "/scripts/:id",
  asyncHandler(async (req, res) => {
    await scriptManagementService.remove(req.params.id, req.admin);
    sendResponse(res, { message: "Script deleted successfully" });
  }),
);

adminScriptRouter.patch(
  "/scripts/status",
  asyncHandler(async (req, res) => {
    const data = await scriptManagementService.setStatus(req.body?.id, req.body?.status, req.admin);
    sendResponse(res, { message: `Script ${data.status}`, data });
  }),
);

adminScriptRouter.post(
  "/scripts/:id/duplicate",
  asyncHandler(async (req, res) => {
    const data = await scriptManagementService.duplicate(req.params.id, req.admin);
    sendResponse(res, { status: 201, message: "Script duplicated successfully", data });
  }),
);
