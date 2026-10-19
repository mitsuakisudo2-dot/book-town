// Book search: one way of reading text for every place a book is looked for.
export {
  databaseSearch,
  MATCH,
  nearHeading,
  searchBooks,
  strongMatch,
  surePick,
} from "./rank";
export type { BookMatch, DatabaseSearch, SearchOptions } from "./rank";
export { bookSignals, searchPresence, type BookSignal } from "./presence";
export { hiragana, searchFold } from "./fold";
export { prepareSearch } from "./postings";
export {
  byMatch,
  readTextQuery,
  sameText,
  textMatch,
  textMatches,
  TEXT_MATCH,
  type TextQuery,
} from "./text";
export { findReaders, findShops, publicStock, shopMatcher } from "./town";
