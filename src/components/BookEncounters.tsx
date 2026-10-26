"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Book, Notify, TownActions, TownState } from "../lib/types";
import type { Encounter } from "../lib/library";
import { booksOfWork } from "../lib/works";
import { japanMonthDay } from "../lib/japan-time";
import { shopPath, walkPath } from "../lib/paths";
import { ENCOUNTER_WORDS, encounterLineIn } from "../lib/encounter-words";
import { askMemo } from "../lib/encounter-memo";
import { scenePopOf, shelfPopOf } from "../lib/encounter-places";
import { LetterCard } from "./letter/LetterCard";

// A POP in a shop's scene is read with the walk's scenes, so a book's page
// reads that code only when the reader met a book at one.
const ScenePopWords = dynamic(
  () => import("./ScenePopWords").then((file) => file.ScenePopWords),
  { loading: () => null },
);

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/**
 * Where the reader met this book and from whom (管理表9), for the reader
 * alone, each with the post, the POP or the shop itself, as it is now. Not
 * there until they have met it: an empty diary says nothing. Forgetting one
 * leaves the reaction, 読みたい and the library as they are.
 */
export function BookEncounters({
  state,
  actions,
  notify,
  book,
}: Shared & { book: Book }) {
  const work = booksOfWork(state.books, book.id);
  const shown = state.encounters
    .filter(
      (c) => work.has(c.bookId) && (c.undoneAt === null || c.memo !== null),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!shown.length) return null;
  const forget = (c: Encounter) => {
    actions.forgetEncounter(c.id);
    notify(ENCOUNTER_WORDS.forgotten, {
      label: ENCOUNTER_WORDS.undo,
      run: () => {
        actions.restoreEncounter(c);
        notify(ENCOUNTER_WORDS.restored);
      },
    });
  };
  return (
    <section
      className="book-encounters"
      aria-labelledby="book-encounters-title"
    >
      <span className="eyebrow">{ENCOUNTER_WORDS.eyebrow}</span>
      <h2 id="book-encounters-title">{ENCOUNTER_WORDS.heading}</h2>
      <p className="book-encounters-note">{ENCOUNTER_WORDS.note}</p>
      <ul>
        {shown.map((c) => (
          <li key={c.id}>
            <div className="book-encounters-head">
              <time dateTime={c.createdAt}>{japanMonthDay(c.createdAt)}</time>
              <span className="book-encounters-line">
                {encounterLineIn(state, c)}
                {c.memo && <q>{c.memo}</q>}
              </span>
              <span className="book-encounters-acts">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => askMemo(c.id)}
                >
                  {c.memo ? ENCOUNTER_WORDS.memoEdit : ENCOUNTER_WORDS.memoWrite}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => forget(c)}
                >
                  {ENCOUNTER_WORDS.forget}
                </button>
              </span>
            </div>
            <MetThere
              encounter={c}
              state={state}
              actions={actions}
              notify={notify}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The post, the POP or the shop the book was met at, as it is now; nothing
 * once it is gone or out of the reader's sight. A post is its own card,
 * covered as it is everywhere when it spoils.
 */
function MetThere({
  encounter: c,
  state,
  actions,
  notify,
}: Shared & { encounter: Encounter }) {
  if (c.via === "post") {
    const post = c.postId
      ? state.posts.find((p) => p.id === c.postId)
      : undefined;
    return post ? (
      <div className="book-encounters-thing">
        <LetterCard
          state={state}
          actions={actions}
          notify={notify}
          post={post}
        />
      </div>
    ) : null;
  }
  const shop = c.shopId
    ? state.shops.find((s) => s.id === c.shopId)
    : undefined;
  if (!shop) return null;
  const onShelf = shelfPopOf(c, state.shops);
  const inScene = scenePopOf(c);
  return (
    <Link
      className="book-encounters-thing book-encounters-pop"
      href={inScene ? walkPath(shop.id) : shopPath(shop.id, onShelf?.shelfId)}
    >
      {onShelf && (
        <span className="book-encounters-pop-words">{onShelf.words}</span>
      )}
      {inScene && <ScenePopWords {...inScene} />}
      <small>{ENCOUNTER_WORDS.visit(shop.name)}</small>
    </Link>
  );
}
