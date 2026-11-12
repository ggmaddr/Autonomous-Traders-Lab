// Only the public gateway injects this flag. Local development stays editable.
export const VIEW_ONLY = document.querySelector('meta[name="view-only"]')?.getAttribute("content") === "true";
