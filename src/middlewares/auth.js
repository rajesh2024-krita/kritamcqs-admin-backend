import { User } from "../models/index.js";
import { AppError } from "../utils/AppError.js";
import { verifyToken } from "../utils/token.js";

const QUESTION_PERMISSION_ALIASES = {
  createQuestions: ["createQuestions"],
  createManualQuestions: ["createManualQuestions", "createQuestions"],
  editQuestions: ["editQuestions"],
  deleteQuestions: ["deleteQuestions"],
  viewQuestions: ["viewQuestions"],
  bulkUploadQuestions: ["bulkUploadQuestions"],
};

export function getAdminRole(admin) {
  return admin?.adminRole === "employee" ? "employee" : "main";
}

export function isMainAdmin(admin) {
  return getAdminRole(admin) === "main";
}

export function hasEmployeePermission(admin, permission) {
  if (!admin?.isAdmin) return false;
  if (isMainAdmin(admin)) return true;
  const modulePermissionMap = {
    createQuestions: ["questions", "create"],
    createManualQuestions: ["questions", "create"],
    editQuestions: ["questions", "edit"],
    deleteQuestions: ["questions", "delete"],
    viewQuestions: ["questions", "view"],
    bulkUploadQuestions: ["questions", "bulkUpload"],
  };
  const mapped = modulePermissionMap[permission];
  if (mapped && admin.modulePermissions?.[mapped[0]]?.[mapped[1]] === true) return true;
  const aliases = QUESTION_PERMISSION_ALIASES[permission] || [permission];
  return aliases.some((key) => admin.employeePermissions?.[key] === true);
}

export function hasModulePermission(admin, moduleKey, action = "view") {
  if (!admin?.isAdmin) return false;
  if (isMainAdmin(admin)) return true;
  const modulePermissions = admin.modulePermissions || {};
  const modulePermission = modulePermissions[moduleKey] || {};
  if (moduleKey === "questions") {
    if (action === "view") return modulePermission.view === true || admin.employeePermissions?.viewQuestions === true;
    if (action === "create") return modulePermission.create === true || admin.employeePermissions?.createQuestions === true || admin.employeePermissions?.createManualQuestions === true;
    if (action === "edit") return modulePermission.edit === true || admin.employeePermissions?.editQuestions === true;
    if (action === "delete") return modulePermission.delete === true || admin.employeePermissions?.deleteQuestions === true;
    if (action === "bulkUpload") return modulePermission.bulkUpload === true || admin.employeePermissions?.bulkUploadQuestions === true;
  }
  return modulePermission[action] === true;
}

export async function requireAdmin(req, _res, next) {
  try {
    const header = String(req.headers.authorization || "");
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;

    if (!token) {
      throw new AppError("Authentication required", 401);
    }

    const decoded = verifyToken(token);
    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      throw new AppError("Invalid token payload", 401);
    }

    const admin = await User.findById(decoded.userId);

    if (!admin || !admin.isAdmin) {
      throw new AppError("Admin access required", 403);
    }

    if (admin.isActive === false || admin.isBlocked === true) {
      throw new AppError("Admin account is inactive", 403);
    }

    req.admin = admin;
    req.auth = decoded;
    next();
  } catch (error) {
    next(error.statusCode ? error : new AppError("Invalid or expired token", 401));
  }
}

export function requireMainAdmin(req, _res, next) {
  if (!isMainAdmin(req.admin)) {
    return next(new AppError("Main admin access required", 403));
  }
  return next();
}

export function requireQuestionPermission(permission) {
  return (req, _res, next) => {
    if (!hasEmployeePermission(req.admin, permission)) {
      return next(new AppError("You do not have permission to perform this question action", 403));
    }
    return next();
  };
}

export function requireModulePermission(moduleKey, action = "view") {
  return (req, _res, next) => {
    if (!hasModulePermission(req.admin, moduleKey, action)) {
      return next(new AppError("You do not have permission to access this module", 403));
    }
    return next();
  };
}
