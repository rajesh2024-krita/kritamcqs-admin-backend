import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..", "..");
const workspaceRoot = path.resolve(backendRoot, "..", "..");
const defaultAppFrontendPublicRoot = path.join(workspaceRoot, "App", "krita-neet-jee", "public");
const appFrontendPublicRoot = process.env.APP_FRONTEND_PUBLIC_DIR
  ? path.resolve(process.env.APP_FRONTEND_PUBLIC_DIR)
  : defaultAppFrontendPublicRoot;

export const uploadsRoot = path.join(appFrontendPublicRoot, "uploads");
export const questionUploadsRoot = path.join(uploadsRoot, "question-assets");

export function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function sanitizeFileName(fileName = "") {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "file"}${ext.toLowerCase()}`;
}

export function buildPublicUploadPath(fileName) {
  return `/uploads/question-assets/${fileName}`;
}
