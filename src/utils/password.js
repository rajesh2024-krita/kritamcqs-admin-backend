import crypto from "crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash = "") {
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) return false;
  const currentHash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(currentHash, "hex"));
}
