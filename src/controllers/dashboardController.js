import { dashboardService } from "../services/dashboardService.js";
import { sendResponse } from "../utils/apiResponse.js";

export const dashboardController = {
  async stats(_req, res) {
    const data = await dashboardService.getStats();
    sendResponse(res, { data });
  },

  async dashboard(_req, res) {
    const data = await dashboardService.getDashboard();
    sendResponse(res, { data });
  },

  async catalog(_req, res) {
    const data = await dashboardService.getCatalogOverview();
    sendResponse(res, { data });
  },

  async dailyTestAnalytics(req, res) {
    const data = await dashboardService.getDailyTestAnalytics(req.query || {});
    sendResponse(res, { data });
  },
};
