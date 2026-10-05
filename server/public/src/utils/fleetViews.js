export const filterLabels = {
  q: "Search",
  status: "Status",
  attention: "Attention",
  group: "Group",
  tag: "Tag",
  includeArchived: "Archived",
  includeForgotten: "Forgotten",
};
export const fleetViews = [
  { label: "All states", status: "", attention: "" },
  { label: "Mining", status: "mining", attention: "" },
  { label: "Stopped", status: "online", attention: "" },
  { label: "Needs attention", status: "", attention: "true" },
  { label: "Offline", status: "offline", attention: "" },
];
export function changeQuery(query, changes) {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes))
    value ? next.set(key, value) : next.delete(key);
  return next;
}
export function clearFilters(query) {
  return changeQuery(
    query,
    Object.fromEntries(Object.keys(filterLabels).map((k) => [k, ""])),
  );
}
export function filterValue(key, value) {
  if (key === "status" && value === "online") return "Stopped";
  if (key === "attention")
    return value === "true" ? "Needs attention" : "No attention flagged";
  if (key === "includeArchived" || key === "includeForgotten")
    return value === "true" ? "Included" : "Excluded";
  return value;
}
export function readViews(storage) {
  try {
    const value = JSON.parse(storage.getItem("minemaster-views") || "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (v) =>
              v &&
              typeof v.name === "string" &&
              v.name.trim() &&
              typeof v.query === "string",
          )
          .slice(-20)
      : [];
  } catch {
    return [];
  }
}
export function readColumns(storage) {
  try {
    return {
      identity:
        JSON.parse(storage.getItem("minemaster-columns") || "{}")?.identity ===
        true,
    };
  } catch {
    return {};
  }
}
export function storePreference(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
// Defer access so browser privacy/storage errors are caught by the readers.
export const browserPreferences = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
