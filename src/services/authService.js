import { User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signAdminToken } from "../utils/token.js";

export const authService = {
  async getStatus() {
    const adminCount = await User.countDocuments({ isAdmin: true });
    return { hasAdmin: adminCount > 0 };
  },

  async bootstrap(payload) {
    const hasAdmin = await User.exists({ isAdmin: true });
    if (hasAdmin) {
      throw new AppError("Admin account already exists", 409);
    }

    return this.register(payload);
  },

  async register(payload) {
    const normalizedMobile = String(payload.mobile ?? "").replace(/\D/g, "");
    const normalizedEmail = payload.email ? payload.email.trim().toLowerCase() : undefined;
    const normalizedName = String(payload.name ?? "").trim();

    const existingAdmin = await User.findOne({
      $or: [
        { mobile: normalizedMobile },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
      ],
    });

    if (existingAdmin) {
      throw new AppError("An admin with this mobile or email already exists", 409);
    }

    const admin = await User.create({
      mobile: normalizedMobile,
      email: normalizedEmail,
      name: normalizedName,
      examMode: payload.examMode,
      level: payload.level,
      passwordHash: hashPassword(payload.password),
      isAdmin: true,
      onboardingComplete: true,
    });

    return {
      token: signAdminToken(admin),
      admin,
    };
  },

  async login({ identifier, password }) {
    const trimmedIdentifier = String(identifier ?? "").trim();
    const loginEmail = trimmedIdentifier.toLowerCase();
    const loginMobile = trimmedIdentifier.replace(/\D/g, "");

    const admin = await User.findOne({
      $or: [{ email: loginEmail }, { mobile: loginMobile }],
      isAdmin: true,
    });

    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      throw new AppError("Invalid admin credentials", 401);
    }

    return {
      token: signAdminToken(admin),
      admin,
    };
  },
};
