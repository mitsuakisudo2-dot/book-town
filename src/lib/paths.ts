/** Records from the database carry UUIDs; the demo's have readable ids. */
export const isDatabaseId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * The site is exported as static pages, so only the demo shops (and "mine")
 * have pages of their own. Shops from the database share one page that reads
 * the shop from ?id=.
 */
export function shopPath(id: string, shelfId?: string): string {
  const page = isDatabaseId(id)
    ? "/shop/?id=" + encodeURIComponent(id)
    : "/shops/" + encodeURIComponent(id) + "/";
  return shelfId ? page + "#shelf-" + shelfId : page;
}

/** Like shopPath: demo readers and "me" have pages, others share /profile/?id=. */
export const profilePath = (id: string): string =>
  isDatabaseId(id)
    ? "/profile/?id=" + encodeURIComponent(id)
    : "/profiles/" + encodeURIComponent(id) + "/";

/** The walk through the shops, starting inside one of them. */
export const walkPath = (id: string): string =>
  "/walk/#" + encodeURIComponent(id);
