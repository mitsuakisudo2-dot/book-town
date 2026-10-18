import { isDatabaseId } from "./record-kind";

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

/** The walk through the shops; with an id it starts inside that shop ("mine" is the reader's own). */
export const walkPath = (id?: string): string =>
  id ? "/walk/#" + encodeURIComponent(id) : "/walk/";

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

/** The library (本棚); `makeShelf` opens 「棚を作る」 on it at once. */
export const libraryPath = (options: { makeShelf?: boolean } = {}): string =>
  options.makeShelf ? "/library/?make=shelf" : "/library/";

/**
 * The reader's own shop, or the door to open one; `place` opens it with that
 * book chosen, ready to put on a shelf (管理表 103).
 */
export const myShopPath = (
  options: { place?: string; at?: string } = {},
): string =>
  (options.place
    ? "/my-shop/?place=" + encodeURIComponent(options.place)
    : "/my-shop/") + (options.at ? "#" + options.at : "");

/** The notifications page (お知らせ); `at` jumps to a part of it. */
export const notificationsPath = (at?: string): string =>
  "/notifications/" + (at ? "#" + at : "");

/** Home's second page, the 便り (rewritten in place with `/` by the home tab). */
export const timelinePath = (): string => "/timeline/";

/** Where the sources of the book data are named. */
export const creditsPath = (): string => "/credits/";

/** The reading list. */
export const readingListPath = (): string => "/reading-list/";

/** Leaving Booktown (退会). */
export const leavePath = (): string => "/leave/";

/** The reading records page (記録). */
export const readingPath = (): string => "/reading/";

/**
 * The login page, which is the account's page once signed in;
 * `changeEmail` opens 「メールアドレスを変える」 on it, `passkeys` the
 * reader's passkeys (管理表 107).
 */
export const loginPath = (
  options: { changeEmail?: boolean; passkeys?: boolean } = {},
): string =>
  options.changeEmail
    ? "/login/?change=email"
    : options.passkeys
      ? "/login/?change=passkey"
      : "/login/";
