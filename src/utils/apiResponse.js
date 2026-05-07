export function sendResponse(res, { status = 200, success = true, message, data, meta } = {}) {
  res.status(status).json({
    success,
    message,
    data,
    meta,
  });
}
