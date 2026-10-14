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

/** The search page for a query: books, readers and shops, or posts for a #tag. */
export const searchPath = (query: string): string =>
  query.trim() ? "/search/?q=" + encodeURIComponent(query.trim()) : "/search/";

/** A poster's own page; every poster shares the one exported page. */
export const posterPath = (id: string): string =>
  "/posters/?id=" + encodeURIComponent(id);

/** A post's own page (便り), with its replies; every post shares one page. */
export const postPath = (id: string): string =>
  "/post/?id=" + encodeURIComponent(id);

/** Making a poster: about a book (?book=), or the viewer's own changed (?id=). */
export function posterNewPath(
  options: { bookId?: string; posterId?: string } = {},
): string {
  if (options.posterId)
    return "/posters/new/?id=" + encodeURIComponent(options.posterId);
  if (options.bookId)
    return "/posters/new/?book=" + encodeURIComponent(options.bookId);
  return "/posters/new/";
}
