import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import adminRoutes from "./routes/admin.js";
import adminAuthRoutes from "./routes/adminAuth.js";
import appPublicRoutes from "./routes/appPublic.js";
import { uploadsRoot } from "./utils/uploadStorage.js";

export const app = express();

function normalizeCorsOrigin(value = "") {
  const trimmed = String(value || "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!trimmed || trimmed === "*") return trimmed;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

function corsPatternToRegex(pattern) {
  const escaped = normalizeCorsOrigin(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

const defaultAllowedOrigins = [
  "https://admin.kritamcqs.com",
  "http://admin.kritamcqs.com",
  "https://kritamcqs.com",
  "http://kritamcqs.com",
  "https://landing.kritamcqs.com",
  "http://landing.kritamcqs.com",
  "http://localhost:5173",
  "http://localhost:3000",
];
const configuredAllowedOrigins = String(env.clientOrigin || "*")
  .split(/[\s,]+/)
  .map(normalizeCorsOrigin)
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins.map(normalizeCorsOrigin), ...configuredAllowedOrigins])];
const allowAllOrigins = allowedOrigins.includes("*");
const allowedOriginPatterns = allowedOrigins.filter((origin) => origin.includes("*") && origin !== "*").map(corsPatternToRegex);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeCorsOrigin(origin);
      const isAllowed =
        allowAllOrigins ||
        allowedOrigins.includes(normalizedOrigin) ||
        allowedOriginPatterns.some((pattern) => pattern.test(normalizedOrigin));
      if (!isAllowed) {
        console.warn(`CORS blocked: ${origin}. Allowed origins: ${allowedOrigins.join(", ") || "(none)"}`);
      }
      return callback(null, isAllowed);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Content-Length", "X-Kuma-Revision"],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(uploadsRoot));

app.get("/api/healthz", (_req, res) => {
  res.json({ success: true, message: "Admin API healthy" });
});

app.use("/api/admin-auth", adminAuthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", appPublicRoutes);

app.use(notFound);
app.use(errorHandler);
