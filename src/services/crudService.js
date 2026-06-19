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
    afterCreate,
    afterUpdate,
    afterDelete,
    buildCustomFilters,
  } = config;

  return {
    async list(query) {
      const { filters, page, limit, skip, sort } = buildListOptions(query, {
        allowedSorts,
        exactFilters,
        searchFields,
        buildCustomFilters,
      });

      const [items, total] = await Promise.all([
        model.find(filters).populate(populate).sort(sort).skip(skip).limit(limit),
        model.countDocuments(filters),
      ]);

      return { items, meta: buildPaginationMeta(total, page, limit) };
    },

    async listAll(query = {}) {
      const { filters, sort } = buildListOptions({ ...query, page: 1, limit: 500 }, {
        allowedSorts,
        exactFilters,
        searchFields,
        buildCustomFilters,
      });

      const items = await model.find(filters).populate(populate).sort(sort).lean();
      return { items, filters };
    },

    async getById(id) {
      assertObjectId(id);
      const item = await model.findById(id).populate(populate);
      if (!item) throw new AppError(`${model.modelName} not found`, 404);
      return item;
    },

    async create(payload, context = {}) {
      const input = beforeCreate ? await beforeCreate(payload, context) : payload;
      const item = await model.create(input);
      const created = await this.getById(item._id.toString());
      if (afterCreate) await afterCreate(created, context);
      return created;
    },

    async update(id, payload, context = {}) {
      assertObjectId(id);
      const existing = await model.findById(id);
      if (!existing) throw new AppError(`${model.modelName} not found`, 404);
      const previous = existing.toObject({ depopulate: true });
      const input = beforeUpdate ? await beforeUpdate(existing, payload, context) : payload;
      Object.assign(existing, input);
      await existing.save();
      const updated = await this.getById(id);
      if (afterUpdate) await afterUpdate(previous, updated, context);
      return updated;
    },

    async remove(id, context = {}) {
      assertObjectId(id);
      const existing = await model.findById(id);
      if (!existing) throw new AppError(`${model.modelName} not found`, 404);
      const previous = existing.toObject({ depopulate: true });
      if (beforeDelete) await beforeDelete(existing, context);
      await existing.deleteOne();
      if (afterDelete) await afterDelete(previous, context);
      return existing;
    },

    async removeMany(ids = [], context = {}) {
      const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
      if (!uniqueIds.length) {
        throw new AppError("Select at least one record to delete", 400);
      }

      uniqueIds.forEach(assertObjectId);

      const results = [];
      for (const id of uniqueIds) {
        try {
          await this.remove(id, context);
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

    async reorder(items = []) {
      const normalizedItems = items
        .map((item, index) => ({
          id: String(item?.id || item?._id || "").trim(),
          sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : (index + 1) * 10,
        }))
        .filter((item) => item.id);

      if (!normalizedItems.length) throw new AppError("Provide records to reorder", 400);
      normalizedItems.forEach((item) => assertObjectId(item.id));

      await Promise.all(
        normalizedItems.map((item) => model.findByIdAndUpdate(item.id, { sortOrder: item.sortOrder })),
      );

      return { updatedCount: normalizedItems.length };
    },
  };
}
