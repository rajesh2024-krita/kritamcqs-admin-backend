import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import adminRoutes from "./routes/admin.js";
import adminAuthRoutes from "./routes/adminAuth.js";
import appPublicRoutes from "./routes/appPublic.js";
import { uploadsRoot } from "./utils/uploadStorage.js";

export const app = express();

app.set("trust proxy", 1);

const configuredOrigins = env.clientOrigin
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const allowAnyOrigin = configuredOrigins.includes("*");

function isAllowedOrigin(origin = "") {
  if (!origin) return true;
  if (allowAnyOrigin) return true;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const normalized = `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  if (configuredOrigins.includes(normalized)) return true;

  const hostname = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  if (hostname === "kritamcqs.com" || hostname.endsWith(".kritamcqs.com")) return true;

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
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
