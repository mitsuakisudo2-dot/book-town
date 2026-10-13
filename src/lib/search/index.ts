// Book search: one way of reading text for every place a book is looked for.
export { MATCH, searchBooks, strongMatch } from "./rank";
export type { BookMatch, SearchOptions } from "./rank";
export { bookSignals, searchPresence, type BookSignal } from "./presence";
export { hiragana, searchFold } from "./fold";
export { prepareSearch } from "./postings";
