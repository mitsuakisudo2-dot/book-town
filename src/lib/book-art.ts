import type { Book } from "./types";
/** The atlas panel a book prefers; a screen may pass another to avoid repeats. */
export function artPanel(book: Book): number {
  const selected: Record<string, number> = {
    solaris: 0,
    "left-hand": 1,
    dispossessed: 6,
    fahrenheit: 2,
    momo: 4,
    "invisible-cities": 7,
    fictions: 5,
    walking: 6,
    "book-of-disquiet": 2,
    "hundred-years": 4,
    "old-man-sea": 3,
    walden: 5,
    "galaxy-railroad": 5,
    "traveling-tree": 6,
    "secret-garden": 4,
    "ten-nights": 3,
    "stone-history": 7,
  };
  return (
    selected[book.id] ??
    [...book.id].reduce((n, c) => n + c.charCodeAt(0), 0) % ART_PANELS
  );
}
export const ART_PANELS = 8;
/** Original demo jacket illustrations, shared as a single cached 2x4 atlas. */
export function bookArt(book: Book, panel?: number) {
  const index = panel ?? artPanel(book);
  return {
    x: index % 2 ? "100%" : "0%",
    y: ["0%", "33.333333%", "66.666667%", "100%"][Math.floor(index / 2)],
    ink: [1, 4, 6, 7].includes(index) ? "#28382b" : "#fff2d7",
    light: [1, 4, 6, 7].includes(index),
  };
}
