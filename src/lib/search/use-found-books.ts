"use client";

import { useEffect, useState } from "react";
import { useMoreRead } from "../store";
import type { Book } from "../types";
import { useBookSearch, type BookSearch } from "./use-book-search";

/** How long typing rests before the database is asked (find_books). */
const ASK_AFTER_MS = 300;

/**
 * A book search over every book the reader may read, not only the town's:
 * what is typed is asked of the database too (find_books, AUD-006), once
 * typing rests, and its books are ranked with the list's (useBookSearch).
 * The search page and the scanner's ［手で入力］ find books so.
 */
export function useFoundBooks(
  all: readonly Book[],
  typed: string,
  options: Omit<Parameters<typeof useBookSearch>[2], "extra"> = {},
): BookSearch {
  const wanted = typed.trim();
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(wanted), wanted ? ASK_AFTER_MS : 0);
    return () => clearTimeout(timer);
  }, [wanted]);
  const { read } = useMoreRead(asked ? { search: asked } : null);
  return useBookSearch(all, typed, { ...options, extra: read?.books });
}
