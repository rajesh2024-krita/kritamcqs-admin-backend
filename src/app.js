import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import adm₹outes from "./routes/admin.js";
import adminAuthRoutes from "./routes/adminAuth.js";
import appPublicRoutes from "./routes/appPublic.js";
import { uploadsRoot } from "./utils/uploadStorage.js";

export const app = express();

// app.use(
//   cors({
//     origin: env.clientOrigin === "*" ? true : env.clientOrigin,
//     credentials: true,
//   }),
// );
const allowedOrigins = env.clientOrigin
  .split(",")
  .map(origin => origin.trim())
  .filter(origin => origin.length > 0);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      // Allow if origin is in whitelist
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // For development only - remove in production
      // if (process.env.NODE_ENV === 'development') {
      //   console.warn(`CORS blocked: ${origin}`);
      //   return callback(null, true); // Temporarily allow all in dev
      // }
      
      callback(new Error(`CORS policy: ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'X-Kuma-Revision'],
    maxAge: 86400, // 24 hours
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(uploadsRoot));

app.get("/api/healthz", (_req, res) => {
  res.json({ success: true, message: "Admin API healthy" });
});

app.use("/api/admin-auth", adminAuthRoutes);
app.use("/api/admin", adm₹outes);
app.use("/api", appPublicRoutes);

app.use(notFound);
app.use(errorHandler);
