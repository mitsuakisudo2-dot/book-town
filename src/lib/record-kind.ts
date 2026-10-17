import { ME_ID, OWN_SHOP_ID } from "./types";

/**
 * Whose a reader, a shop, a 便り or a poster is, read from its id: the
 * viewer's own ("me", "mine"), one kept in the database (a UUID), or a 見本's
 * (the demo's readable ids). Every screen asks this one question, so a 見本
 * is marked and turned away the same everywhere, and a real record is never
 * taken for one. A book's id is asked with `bookKind` (src/lib/samples.ts):
 * the 見本's books are kept in the database too, under ids of their own.
 */
export type RecordKind = "own" | "database" | "sample";

/** A database id: a UUID. */
export const DATABASE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recordKind(id: string): RecordKind {
  if (id === ME_ID || id === OWN_SHOP_ID) return "own";
  return DATABASE_ID.test(id) ? "database" : "sample";
}

/** Kept in the database: someone a like, a follow or a report can reach. */
export const isDatabaseId = (id: string): boolean =>
  recordKind(id) === "database";

/** A 見本's: neither the viewer's own nor in the database. */
export const isSampleId = (id: string): boolean => recordKind(id) === "sample";
