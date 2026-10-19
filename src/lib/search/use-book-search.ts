"use client";

import { useDeferredValue, useEffect, useMemo } from "react";
import { booksOfIsbn } from "../book-name";
import { withoutTwins } from "../own-books";
import type { Book } from "../types";
import { prepareSearch } from "./postings";
import { nearHeading, searchBooks, surePick, type BookMatch } from "./rank";

// The book search as every search box uses it: typing stays quick while the
// list is searched, and near titles wait under their own quiet heading. A
// book another reader typed in that the reader has their own of is found as
// the reader's own, once (withoutTwins). Books the database found for the
// query (`extra`, find_books) are ranked with the list's own matches, but
// none the list already has, by its id or its ISBN.

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
    extra,
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
    /** Books found for what is typed beyond the list (the database's). */
    extra?: readonly Book[];
  } = {},
): BookSearch {
  const books = withoutTwins(all);
  const added = useMemo(() => {
    const known = new Set(all.map((book) => book.id));
    const fresh = (extra ?? []).filter(
      (book) =>
        !known.has(book.id) &&
        !(book.isbn && booksOfIsbn(all, book.isbn).length),
    );
    if (!fresh.length) return [];
    const kept = new Set(withoutTwins([...all, ...fresh]).map((b) => b.id));
    return fresh.filter((book) => kept.has(book.id));
  }, [all, extra]);
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
    const options = { own, limit, presence, genreFinds };
    let all = query ? searchBooks(books, query, options) : [];
    // The database's ranked with the best of the list's (no book beyond
    // those could come before them).
    if (query && added.length)
      all = searchBooks([...all.map((match) => match.book), ...added], query, {
        ...options,
        unpruned: true,
      });
    const near = all.filter((match) => match.near);
    return {
      found: all.filter((match) => !match.near),
      near,
      nearHeading: nearHeading(near),
    };
  }, [books, added, query, own, limit, presence, genreFinds]);
  return {
    ...results,
    query,
    settled: query === wanted,
    sure: () =>
      surePick(added.length ? [...books, ...added] : books, wanted, {
        own,
        presence,
        genreFinds,
      }),
  };
}
