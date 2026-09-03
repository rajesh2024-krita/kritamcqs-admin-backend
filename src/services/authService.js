import { AdminLoginHistory, User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signAdminToken } from "../utils/token.js";

function getRole(user) {
  return user?.adminRole === "employee" ? "employee" : "main";
}

function normalizeEmployeePermissions(input = {}) {
  return {
    createQuestions: Boolean(input.createQuestions),
    editQuestions: Boolean(input.editQuestions),
    deleteQuestions: Boolean(input.deleteQuestions),
    viewQuestions: Boolean(input.viewQuestions),
    bulkUploadQuestions: Boolean(input.bulkUploadQuestions),
    createManualQuestions: Boolean(input.createManualQuestions),
  };
}

function normalizeModulePermissions(input = {}, employeePermissions = {}) {
  const source = input && typeof input === "object" ? input : {};
  const normalized = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!key || !value || typeof value !== "object") return;
    const create = Boolean(value.create);
    const edit = Boolean(value.edit);
    const deleteAllowed = Boolean(value.delete);
    const bulkUpload = Boolean(value.bulkUpload);
    normalized[key] = {
      view: Boolean(value.view || create || edit || deleteAllowed || bulkUpload),
      create,
      edit,
      delete: deleteAllowed,
      bulkUpload,
    };
  });

  const legacy = normalizeEmployeePermissions(employeePermissions);
  const questionCreate = Boolean(normalized.questions?.create || legacy.createQuestions || legacy.createManualQuestions);
  const questionEdit = Boolean(normalized.questions?.edit || legacy.editQuestions);
  const questionDelete = Boolean(normalized.questions?.delete || legacy.deleteQuestions);
  const questionBulkUpload = Boolean(normalized.questions?.bulkUpload || legacy.bulkUploadQuestions);
  normalized.questions = {
    view: Boolean(normalized.questions?.view || legacy.viewQuestions || questionCreate || questionEdit || questionDelete || questionBulkUpload),
    create: questionCreate,
    edit: questionEdit,
    delete: questionDelete,
    bulkUpload: questionBulkUpload,
  };
  return normalized;
}

function getClientIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || "";
}

function serializeAdmin(admin) {
  const json = typeof admin.toJSON === "function" ? admin.toJSON() : admin;
  const adminRole = getRole(admin);
  const employeePermissions = normalizeEmployeePermissions(json.employeePermissions || {});
  return {
    ...json,
    isAdmin: Boolean(json.isAdmin || adminRole === "employee"),
    adminRole,
    employeePermissions,
    modulePermissions: normalizeModulePermissions(json.modulePermissions || {}, employeePermissions),
  };
}

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

  async login({ identifier, password }, req) {
    const trimmedIdentifier = String(identifier ?? "").trim();
    const loginEmail = trimmedIdentifier.toLowerCase();
    const loginMobile = trimmedIdentifier.replace(/\D/g, "");
    const ipAddress = getClientIp(req);

    const admin = await User.findOne({
      $and: [
        { $or: [{ email: loginEmail }, { mobile: loginMobile }] },
        { $or: [{ isAdmin: true }, { adminRole: "employee" }] },
      ],
    });

    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      await AdminLoginHistory.create({
        employeeEmail: loginEmail || trimmedIdentifier,
        ipAddress,
        loginStatus: "failed",
        failureReason: "Invalid credentials",
        role: "main",
      }).catch(() => undefined);
      throw new AppError("Invalid admin credentials", 401);
    }

    if (admin.isActive === false || admin.isBlocked === true) {
      await AdminLoginHistory.create({
        adminId: admin._id,
        employeeName: admin.name,
        employeeEmail: admin.email,
        role: getRole(admin),
        ipAddress,
        loginStatus: "failed",
        failureReason: "Account inactive",
      }).catch(() => undefined);
      throw new AppError("Admin account is inactive", 403);
    }

    const session = await AdminLoginHistory.create({
      adminId: admin._id,
      employeeName: admin.name,
      employeeEmail: admin.email,
      role: getRole(admin),
      ipAddress,
      loginStatus: "success",
      loginTime: new Date(),
    });
    if (admin.adminRole === "employee" && admin.isAdmin !== true) {
      admin.isAdmin = true;
    }
    admin.lastLoginAt = new Date();
    await admin.save();

    return {
      token: signAdminToken(admin, session._id),
      admin: serializeAdmin(admin),
    };
  },

  async logout(admin, sessionId) {
    if (sessionId) {
      await AdminLoginHistory.findOneAndUpdate(
        { _id: sessionId, adminId: admin?._id, loginStatus: "success", logoutTime: { $exists: false } },
        { logoutTime: new Date() },
      );
    }
    return { success: true };
  },

  profile(admin) {
    return serializeAdmin(admin);
  },
};
