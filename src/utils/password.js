import crypto from "crypto";
import bcrypt from "bcryptjs";

const SCRYPT_KEYLEN = 64;
const BCRYPT_ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
}

export function verifyPassword(password, storedHash = "") {
  const hash = String(storedHash || "");
  if (!hash) return false;

  if (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")) {
    return bcrypt.compareSync(String(password), hash);
  }

  const parts = hash.split(":");
  const salt = parts[0] === "scrypt" ? parts[1] : parts[0];
  const originalHash = parts[0] === "scrypt" ? parts[2] : parts[1];
  if (!salt || !originalHash) return false;

  try {
    const currentHash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(currentHash, "hex"));
  } catch {
    return false;
  }
}
