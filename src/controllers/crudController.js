import { sendResponse } from "../utils/apiResponse.js";

export function createCrudController(service, label) {
  return {
    async list(req, res) {
      const data = await service.list(req.validated?.query || req.query);
      sendResponse(res, { data: data.items, meta: data.meta });
    },

    async getById(req, res) {
      const data = await service.getById(req.params.id);
      sendResponse(res, { data });
    },

    async create(req, res) {
      const data = await service.create(req.validated.body, { admin: req.admin, req });
      sendResponse(res, { status: 201, message: `${label} created successfully`, data });
    },

    async update(req, res) {
      const data = await service.update(req.params.id, req.validated.body, { admin: req.admin, req });
      sendResponse(res, { message: `${label} updated successfully`, data });
    },

    async remove(req, res) {
      await service.remove(req.params.id, { admin: req.admin, req });
      sendResponse(res, { message: `${label} deleted successfully` });
    },

    async bulkRemove(req, res) {
      const result = await service.removeMany(req.validated.body.ids, { admin: req.admin, req });
      sendResponse(res, {
        message: `${result.deletedCount} ${label}${result.deletedCount === 1 ? "" : "s"} deleted successfully`,
        data: result,
      });
    },
  };
}
