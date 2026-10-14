// この本について調べる (BookPurchase in BookActions.tsx): a web search for the
// book's title and author, in a new tab.

type Named = { title: string; author: string };

/** The title and the author, a full-width space between them. */
export const lookupQuery = (book: Named) => `${book.title}　${book.author}`;

/** Google's results, without "www." (see BookPurchase). */
export const googleLookupUrl = (book: Named) =>
  "https://google.com/search?q=" + encodeURIComponent(lookupQuery(book));

/**
 * Safari's own search on the iPhone and iPad, with the engine chosen in
 * Settings > Safari. Only Safari answers this address (see iosSafari).
 */
export const iosLookupUrl = (book: Named) =>
  "x-web-search://?" + encodeURIComponent(lookupQuery(book));

/**
 * The link's address and spoken name, in Safari on an iPhone or iPad or
 * elsewhere. The spoken name starts with the words on the link.
 */
export function bookLookup(book: Named, safari: boolean) {
  return safari
    ? {
        href: iosLookupUrl(book),
        label: "この本について調べる（いつもの検索で、新しいタブで開きます）",
      }
    : {
        href: googleLookupUrl(book),
        label: "この本についてGoogleで調べる（新しいタブで開きます）",
      };
}
