import {
  demoBooks,
  demoPosts,
  demoReaders,
  demoShops,
  readingNow as demoReadingNow,
} from "./data";
import type { TownState } from "./types";

/**
 * 見本: the demo's shops, readers and posts, shown beside the real ones so the
 * town is never empty, even before many people have opened a shop. They are
 * marked as demo on screen and never saved; a real record wins if ids meet.
 */
export function withSamples(state: TownState): TownState {
  const add = <T extends { id: string }>(real: T[], samples: T[]): T[] => {
    const ids = new Set(real.map((entry) => entry.id));
    return [
      ...real,
      ...structuredClone(samples.filter((entry) => !ids.has(entry.id))),
    ];
  };
  const readers = add(state.readers, demoReaders);
  const reading = new Set(state.readingNow.map((entry) => entry.readerId));
  return {
    ...state,
    books: add(state.books, demoBooks),
    readers,
    shops: add(state.shops, demoShops),
    posts: add(state.posts, demoPosts).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    ),
    readingNow: [
      ...state.readingNow,
      ...demoReadingNow.filter((entry) => !reading.has(entry.readerId)),
    ],
  };
}
