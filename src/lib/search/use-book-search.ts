"use client";

import { useDeferredValue, useEffect, useMemo } from "react";
import { imeKey } from "../keys";
import { withoutTwins } from "../own-books";
import type { Book } from "../types";
import { prepareSearch } from "./postings";
import { nearHeading, searchBooks, surePick, type BookMatch } from "./rank";

// The book search as every search box uses it: typing stays quick while the
// list is searched, and near titles wait under their own quiet heading. A
// book another reader typed in that the reader has their own of is found as
// the reader's own, once (withoutTwins).

export interface BookSearch {
  /** The query the results are for, trimmed: "" while nothing is typed. */
  query: string;
  /** The results are for what is typed now, not still catching up. */
  settled: boolean;
  found: BookMatch[];
  /** Only close in spelling: shown apart, under nearHeading. */
  near: BookMatch[];
  nearHeading: string;
  /**
   * The book Enter takes for what is typed now: only one surely meant (a
   * title that begins so, or the one book found), never a near title.
   */
  sure: () => Book | null;
}

export function useBookSearch(
  all: readonly Book[],
  typed: string,
  {
    own: ownIds,
    limit,
    presence,
    genreFinds: genreBooks,
  }: {
    /** The reader's own books: first among equal matches (pickers). */
    own?: readonly string[];
    limit?: number;
    presence?: (bookId: string) => number;
    /**
     * The books a genre alone finds (booksBeforeSearch); any other waits for
     * its title, author or ISBN. Every book when left out.
     */
    genreFinds?: readonly Book[];
  } = {},
): BookSearch {
  const books = withoutTwins(all);
  useEffect(() => prepareSearch(books), [books]);
  const ownKey = ownIds?.join("\n") ?? "";
  const own = useMemo(
    () => new Set(ownKey ? ownKey.split("\n") : []),
    [ownKey],
  );
  const genreKey = genreBooks?.map((book) => book.id).join("\n");
  const genreFinds = useMemo(
    () =>
      genreKey === undefined
        ? undefined
        : new Set(genreKey ? genreKey.split("\n") : []),
    [genreKey],
  );
  const wanted = typed.trim();
  const query = useDeferredValue(wanted);
  const results = useMemo(() => {
    const all = query
      ? searchBooks(books, query, { own, limit, presence, genreFinds })
      : [];
    const near = all.filter((match) => match.near);
    return {
      found: all.filter((match) => !match.near),
      near,
      nearHeading: nearHeading(near),
    };
  }, [books, query, own, limit, presence, genreFinds]);
  return {
    ...results,
    query,
    settled: query === wanted,
    sure: () => surePick(books, wanted, { own, presence, genreFinds }),
  };
}

/**
 * Enter as the reader meant it: not the Enter that confirms a kana
 * conversion, which belongs to the keyboard.
 */
export const enterPressed = (event: {
  key: string;
  keyCode: number;
  nativeEvent: { isComposing?: boolean };
}): boolean =>
  event.key === "Enter" &&
  !imeKey({
    isComposing: event.nativeEvent.isComposing,
    keyCode: event.keyCode,
  });
