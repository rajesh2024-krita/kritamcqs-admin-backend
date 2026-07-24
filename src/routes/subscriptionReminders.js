import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendResponse } from "../utils/apiResponse.js";
import { requireAdmin } from "../middlewares/auth.js";
import { subscriptionReminderService } from "../services/subscriptionReminderService.js";

export const adminSubscriptionReminderRouter = Router();

adminSubscriptionReminderRouter.use(requireAdmin);

adminSubscriptionReminderRouter.get(
  "/subscription-reminder/configurations",
  asyncHandler(async (req, res) => {
    const result = await subscriptionReminderService.listConfigurations(req.query);
    sendResponse(res, { data: result.items, meta: result.meta });
  }),
);

adminSubscriptionReminderRouter.post(
  "/subscription-reminder/configurations",
  asyncHandler(async (req, res) => {
    const data = await subscriptionReminderService.createConfiguration(req.body, req.admin);
    sendResponse(res, { status: 201, message: "Reminder configuration created", data });
  }),
);

adminSubscriptionReminderRouter.put(
  "/subscription-reminder/configurations/:id",
  asyncHandler(async (req, res) => {
    const data = await subscriptionReminderService.updateConfiguration(req.params.id, req.body, req.admin);
    sendResponse(res, { message: "Reminder configuration updated", data });
  }),
);

adminSubscriptionReminderRouter.delete(
  "/subscription-reminder/configurations/:id",
  asyncHandler(async (req, res) => {
    await subscriptionReminderService.deleteConfiguration(req.params.id, req.admin);
    sendResponse(res, { message: "Reminder configuration deleted" });
  }),
);

adminSubscriptionReminderRouter.patch(
  "/subscription-reminder/configurations/status",
  asyncHandler(async (req, res) => {
    const data = await subscriptionReminderService.setConfigurationStatus(req.body?.id, req.body?.status, req.admin);
    sendResponse(res, { message: `Reminder configuration ${data.status}`, data });
  }),
);

adminSubscriptionReminderRouter.get(
  "/subscription-reminder/cancelled-users",
  asyncHandler(async (req, res) => {
    const result = await subscriptionReminderService.listCancelledUsers(req.query);
    sendResponse(res, { data: result.items, meta: result.meta });
  }),
);

adminSubscriptionReminderRouter.get(
  "/subscription-reminder/cancelled-users/:id",
  asyncHandler(async (req, res) => {
    const data = await subscriptionReminderService.getCancelledUser(req.params.id);
    sendResponse(res, { data });
  }),
);

adminSubscriptionReminderRouter.patch(
  "/subscription-reminder/cancelled-users/:id/stop",
  asyncHandler(async (req, res) => {
    const data = await subscriptionReminderService.stopReminder(req.params.id);
    sendResponse(res, { message: "Reminder stopped", data });
  }),
);

adminSubscriptionReminderRouter.patch(
  "/subscription-reminder/cancelled-users/:id/restart",
  asyncHandler(async (req, res) => {
    const data = await subscriptionReminderService.restartReminder(req.params.id);
    sendResponse(res, { message: "Reminder restarted", data });
  }),
);

adminSubscriptionReminderRouter.get(
  "/subscription-reminder/logs",
  asyncHandler(async (req, res) => {
    const result = await subscriptionReminderService.listLogs(req.query);
    sendResponse(res, { data: result.items, meta: result.meta });
  }),
);

adminSubscriptionReminderRouter.get(
  "/subscription-reminder/logs/user/:userId",
  asyncHandler(async (req, res) => {
    const result = await subscriptionReminderService.getLogsByUser(req.params.userId, req.query);
    sendResponse(res, { data: result.items, meta: result.meta });
  }),
);

adminSubscriptionReminderRouter.get(
  "/subscription-reminder/statistics",
  asyncHandler(async (_req, res) => {
    const data = await subscriptionReminderService.statistics();
    sendResponse(res, { data });
  }),
);
