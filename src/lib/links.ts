export const PROFILE_LINK_LIMIT = 5;

/** Accepts a web address with or without https://; anything that is not http(s) is refused. */
export function normalizeLink(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 300) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : "https://" + text;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || url.username || url.password)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Keeps up to five distinct valid links; anything else is dropped. */
export function cleanLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const links = value
    .map((entry) => (typeof entry === "string" ? normalizeLink(entry) : null))
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set(links)].slice(0, PROFILE_LINK_LIMIT);
}

const services: Array<[RegExp, string]> = [
  [/(^|\.)note\.com$/, "note"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(x\.com|twitter\.com)$/, "X"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)bsky\.app$/, "Bluesky"],
];

/** A short name for a link: the service when it is a known one, else the site's host. */
export function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return services.find(([pattern]) => pattern.test(host))?.[1] ?? host;
  } catch {
    return url;
  }
}
