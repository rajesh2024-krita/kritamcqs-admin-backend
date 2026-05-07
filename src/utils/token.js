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
  return jwt.verify(token, env.jwtSecret);
}
