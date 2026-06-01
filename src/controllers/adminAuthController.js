import { authService } from "../services/authService.js";
import { sendResponse } from "../utils/apiResponse.js";

export const adminAuthController = {
  async status(_req, res) {
    const data = await authService.getStatus();
    sendResponse(res, { data });
  },

  async bootstrap(req, res) {
    const data = await authService.bootstrap(req.validated.body);
    sendResponse(res, { status: 201, message: "Admin bootstrapped successfully", data });
  },

  async register(req, res) {
    const data = await authService.register(req.validated.body);
    sendResponse(res, { status: 201, message: "Admin registered successfully", data });
  },

  async login(req, res) {
    const data = await authService.login(req.validated.body, req);
    sendResponse(res, { message: "Login successful", data });
  },

  async logout(req, res) {
    const data = await authService.logout(req.admin, req.auth?.sessionId);
    sendResponse(res, { message: "Logout successful", data });
  },

  async me(req, res) {
    sendResponse(res, { data: req.admin });
  },
};
