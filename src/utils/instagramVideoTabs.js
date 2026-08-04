export const defaultInstagramTabs = [
  { id: "student-reviews", name: "Student Reviews", enabled: true, order: 1 },
  { id: "creator-collaborations", name: "Creator Collaborations", enabled: true, order: 2 },
];

export function slugifyTabLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeInstagramTabs(tabs) {
  const source = Array.isArray(tabs) && tabs.length ? tabs : defaultInstagramTabs;
  return source
    .map((tab, index) => ({
      id: String(tab?.id || `instagram-tab-${index + 1}`).trim() || `instagram-tab-${index + 1}`,
      name: String(tab?.name || tab?.label || `Tab ${index + 1}`).trim() || `Tab ${index + 1}`,
      enabled: tab?.enabled !== false,
      order: Number(tab?.order || index + 1),
    }))
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((tab, index) => ({ ...tab, order: index + 1 }));
}

export function tabPatchFor(tabId, tabs) {
  const fallbackTabId = tabs[0]?.id || "";
  const resolvedTabId = tabId || fallbackTabId;
  const tab = tabs.find((item) => item.id === resolvedTabId);
  return {
    tabId: resolvedTabId,
    category: tab?.name || "",
    type: resolvedTabId,
  };
}

export function resolveInstagramVideoTabId(item, tabs) {
  const directTabId = String(item?.tabId || "").trim();
  if (directTabId && tabs.some((tab) => tab.id === directTabId)) return directTabId;

  const category = String(item?.category || "").trim();
  if (category) {
    const categorySlug = slugifyTabLabel(category);
    const matchedTab = tabs.find((tab) => tab.name.toLowerCase() === category.toLowerCase() || slugifyTabLabel(tab.name) === categorySlug);
    if (matchedTab) return matchedTab.id;
  }

  const legacyType = String(item?.type || "").trim();
  if (legacyType && tabs.some((tab) => tab.id === legacyType)) return legacyType;

  const legacy = `${category || legacyType}`.toLowerCase();
  if (legacy.includes("creator") || legacy.includes("collab")) {
    const creatorTab = tabs.find((tab) => tab.id === "creator-collaborations" || tab.name.toLowerCase().includes("creator"));
    return creatorTab?.id || tabs[0]?.id || "";
  }
  if (legacy.includes("student") || legacy.includes("review")) {
    const studentTab = tabs.find((tab) => tab.id === "student-reviews" || tab.name.toLowerCase().includes("student"));
    return studentTab?.id || tabs[0]?.id || "";
  }

  return tabs[0]?.id || "";
}
