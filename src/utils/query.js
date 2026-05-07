export function buildListOptions(query, { allowedSorts = [], exactFilters = [], searchFields = [] } = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 10), 1), 500);
  const search = String(query.search || "").trim();
  const sortBy = allowedSorts.includes(query.sortBy) ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder === "asc" ? 1 : -1;
  const filters = {};

  for (const key of exactFilters) {
    const value = query[key];
    if (value !== undefined && value !== "") {
      filters[key] = coerceExactValue(value);
    }
  }

  if (search && searchFields.length) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filters.$or = searchFields.map((field) => ({
      [field]: { $regex: safeSearch, $options: "i" },
    }));
  }

  return {
    filters,
    page,
    limit,
    skip: (page - 1) * limit,
    sort: { [sortBy]: sortOrder },
  };
}

export function buildPaginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}

function coerceExactValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
