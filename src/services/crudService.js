import mongoose from "mongoose";
import { AppError } from "../utils/AppError.js";
import { buildListOptions, buildPaginationMeta } from "../utils/query.js";

function assertObjectId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError("Invalid resource id", 400);
  }
}

export function createCrudService(config) {
  const {
    model,
    populate = [],
    allowedSorts = ["createdAt"],
    searchFields = [],
    exactFilters = [],
    beforeCreate,
    beforeUpdate,
    beforeDelete,
  } = config;

  return {
    async list(query) {
      const { filters, page, limit, skip, sort } = buildListOptions(query, {
        allowedSorts,
        exactFilters,
        searchFields,
      });

      const [items, total] = await Promise.all([
        model.find(filters).populate(populate).sort(sort).skip(skip).limit(limit),
        model.countDocuments(filters),
      ]);

      return { items, meta: buildPaginationMeta(total, page, limit) };
    },

    async getById(id) {
      assertObjectId(id);
      const item = await model.findById(id).populate(populate);
      if (!item) throw new AppError(`${model.modelName} not found`, 404);
      return item;
    },

    async create(payload) {
      const input = beforeCreate ? await beforeCreate(payload) : payload;
      const item = await model.create(input);
      return this.getById(item._id.toString());
    },

    async update(id, payload) {
      assertObjectId(id);
      const existing = await model.findById(id);
      if (!existing) throw new AppError(`${model.modelName} not found`, 404);
      const input = beforeUpdate ? await beforeUpdate(existing, payload) : payload;
      Object.assign(existing, input);
      await existing.save();
      return this.getById(id);
    },

    async remove(id) {
      assertObjectId(id);
      const existing = await model.findById(id);
      if (!existing) throw new AppError(`${model.modelName} not found`, 404);
      if (beforeDelete) await beforeDelete(existing);
      await existing.deleteOne();
      return existing;
    },

    async removeMany(ids = []) {
      const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
      if (!uniqueIds.length) {
        throw new AppError("Select at least one record to delete", 400);
      }

      uniqueIds.forEach(assertObjectId);

      const results = [];
      for (const id of uniqueIds) {
        try {
          await this.remove(id);
          results.push({ id, success: true });
        } catch (error) {
          results.push({ id, success: false, message: error.message || "Delete failed" });
        }
      }

      return {
        requestedCount: uniqueIds.length,
        deletedCount: results.filter((result) => result.success).length,
        failedCount: results.filter((result) => !result.success).length,
        results,
      };
    },
  };
}
