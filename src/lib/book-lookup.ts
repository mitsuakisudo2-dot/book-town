// この本について調べる (BookPurchase in BookActions.tsx): a Google search for
// the book's title and author, in a new tab.
//
// Every device and browser gets Google. Safari's own search on the iPhone
// (x-web-search://, #70) was tried on the iPhone and put back to Google
// (2026-10-17).

import { bookAuthor, bookTitle, type Named } from "./book-name";

/** The title and the author, a full-width space between them. */
export const lookupQuery = (book: Named) =>
  `${bookTitle(book)}　${bookAuthor(book)}`;

/** Google's results, without "www." (see BookPurchase). */
export const googleLookupUrl = (book: Named) =>
  "https://google.com/search?q=" + encodeURIComponent(lookupQuery(book));

/** The link's address and spoken name, which starts with the words on it. */
export const bookLookup = (book: Named) => ({
  href: googleLookupUrl(book),
  label: "この本についてGoogleで調べる（新しいタブで開きます）",
});
