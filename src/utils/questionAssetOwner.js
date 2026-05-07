import fs from "fs/promises";
import { buildPublicUploadPath, ensureDir, questionUploadsRoot, sanitizeFileName } from "./uploadStorage.js";

function inferImageExtensionFromUrl(urlValue, contentType = "") {
  const byMime = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
  };

  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (normalizedType && byMime[normalizedType]) return byMime[normalizedType];

  try {
    const parsed = new URL(String(urlValue || ""));
    const pathName = parsed.pathname || "";
    const dotIndex = pathName.lastIndexOf(".");
    if (dotIndex > -1) {
      const ext = pathName.slice(dotIndex).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"].includes(ext)) {
        return ext === ".jpeg" ? ".jpg" : ext;
      }
    }
  } catch {
    return ".jpg";
  }

  return ".jpg";
}

function normalizeImageSourceUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.startsWith("data:")) return value;
  if (value.startsWith("/uploads/")) return value;

  let normalized = value;
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  } else if (!/^[a-z]+:\/\//i.test(normalized) && /^www\./i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.includes("drive.google.com")) {
      const idFromQuery = parsed.searchParams.get("id");
      const match = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
      const fileId = idFromQuery || match?.[1] || "";
      if (fileId) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    }
    if (parsed.hostname.includes("dropbox.com")) {
      parsed.searchParams.set("raw", "1");
      parsed.searchParams.delete("dl");
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

async function fetchImageWithFallback(urlValue) {
  const firstUrl = normalizeImageSourceUrl(urlValue);
  const attempts = [firstUrl];
  if (/^https:\/\//i.test(firstUrl)) {
    attempts.push(firstUrl.replace(/^https:\/\//i, "http://"));
  }

  let lastError = null;
  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl, {
        redirect: "follow",
        headers: {
          "user-agent": "krita-question-asset-owner/1.0",
          accept: "image/*,*/*;q=0.8",
        },
      });
      if (!response.ok) throw new Error(`Failed to download image (${response.status})`);
      return { response, finalUrl: attemptUrl };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to download image");
}

export function isOwnableImageUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || value.startsWith("/uploads/") || value.startsWith("data:")) return false;
  const normalized = normalizeImageSourceUrl(value);
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export async function ownQuestionAssetUrl(sourceUrl) {
  const normalizedSourceUrl = String(sourceUrl || "").trim();
  if (!normalizedSourceUrl || normalizedSourceUrl.startsWith("/uploads/")) return normalizedSourceUrl;
  if (!isOwnableImageUrl(normalizedSourceUrl)) return normalizedSourceUrl;

  const parsed = new URL(normalizeImageSourceUrl(normalizedSourceUrl));
  const { response, finalUrl } = await fetchImageWithFallback(normalizedSourceUrl);

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const finalPathExt = (() => {
    try {
      return String(new URL(finalUrl).pathname || "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const looksLikeImageByExt = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"].some((ext) => finalPathExt.endsWith(ext));
  if (!contentType.startsWith("image/") && !looksLikeImageByExt) {
    throw new Error("Provided URL does not return an image");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Downloaded image is empty");

  ensureDir(questionUploadsRoot);
  const ext = inferImageExtensionFromUrl(finalUrl || normalizedSourceUrl, contentType);
  const baseName = sanitizeFileName(parsed.pathname.split("/").pop() || "question-image").replace(/\.[^.]+$/, "");
  const fileName = `${baseName || "question-image"}-${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`;
  await fs.writeFile(`${questionUploadsRoot}/${fileName}`, buffer);

  return buildPublicUploadPath(fileName);
}
