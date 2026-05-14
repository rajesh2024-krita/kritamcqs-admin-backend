import { User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { verifyToken } from "../utils/token.js";

export async function requireAdmin(req, _res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;

    if (!token) {
      throw new AppError("Authentication required", 401);
    }

    const decoded = verifyToken(token);
    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      throw new AppError("Invalid token payload", 401);
    }

    const admin = await User.findById(decoded.userId);

    if (!admin || !admin.isAdmin) {
      throw new AppError("Admin access required", 403);
    }

    req.admin = admin;
    next();
  } catch (error) {
    next(error.statusCode ? error : new AppError("Invalid or expired token", 401));
  }
}
