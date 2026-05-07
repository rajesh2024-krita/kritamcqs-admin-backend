import { sendResponse } from "../utils/apiResponse.js";
import { userInsightsService } from "../services/userInsightsService.js";

export const userInsightsController = {
  async overview(req, res) {
    const data = await userInsightsService.getOverview(req.params.id);
    sendResponse(res, { data });
  },
};
