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
 * Settings > Safari.
 */
export const iosLookupUrl = (book: Named) =>
  "x-web-search://?" + encodeURIComponent(lookupQuery(book));

/** The link's address and spoken name, on an iPhone or iPad or elsewhere. */
export function bookLookup(book: Named, ios: boolean) {
  return ios
    ? {
        href: iosLookupUrl(book),
        label: "この本について、いつもの検索で調べる（新しいタブで開きます）",
      }
    : {
        href: googleLookupUrl(book),
        label: "この本についてGoogleで調べる（新しいタブで開きます）",
      };
}
