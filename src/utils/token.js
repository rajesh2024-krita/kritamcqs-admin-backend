import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAdminToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      isAdmin: true,
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
