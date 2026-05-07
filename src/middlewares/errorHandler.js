import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";

export function notFound(_req, _res, next) {
  next(new AppError("Route not found", 404));
}

export function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || 500;

  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ success: false, message: "Invalid resource id" });
  }

  if (error?.code === 11000) {
    return res.status(409).json({ success: false, message: "Duplicate value", details: error.keyValue });
  }

  return res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
    details: error.details,
  });
}
