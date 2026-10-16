import dynamic from "next/dynamic";

// The book in hand comes in its own file (with the shop's scene and the
// shelves it shows), read when a book is first picked up or ahead of that
// once the page has drawn what it shows first.
const load = () => import("./BookInHand");

export const BookInHand = dynamic(() => load().then((file) => file.BookInHand));

/** Reads the book in hand's file ahead, when the page has a moment. */
export function readBookInHandAhead() {
  const read = () => void load();
  if ("requestIdleCallback" in window) requestIdleCallback(read);
  else setTimeout(read, 200);
}
