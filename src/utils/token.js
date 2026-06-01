import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAdminToken(user, sessionId) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      isAdmin: true,
      adminRole: user.adminRole || "main",
      sessionId: sessionId ? String(sessionId) : undefined,
    },
    env.jwtSecret,
    { expiresIn: "12h" },
  );
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid or expired token");
  }

  return jwt.verify(token.trim(), env.jwtSecret);
}
