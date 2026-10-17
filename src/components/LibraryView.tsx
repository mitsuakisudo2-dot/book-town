"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { afterLayerCloses, useBackLayer } from "../lib/back-layer";
import { bookAuthor, bookTitle, quotedTitle } from "../lib/book-name";
import { bookPath } from "../lib/books";
import {
  countsOf,
  DEFAULT_SHELVES,
  filterFromParams,
  filterLibrary,
  READING_STATUSES,
  worksIn,
  type LibraryEntry,
  type LibraryFilter,
  type ReadingStatus,
} from "../lib/library";
import {
  libraryStateOf,
  townShopBooks,
  type LibraryChange,
  type LibraryUndo,
} from "../lib/library-town";
import type { Notify, TownActions, TownState } from "../lib/types";
import { replaceAddress, useUrlParam } from "../lib/url-state";
import { JournalNotes, TitlesToType } from "./LibraryJournalNotes";
import { ScanSession } from "./ScanSession";
import { BookJacket, Icon } from "./ui";
import { counted } from "../lib/words";

// The reader's library (管理表14): every book they have met in the town,
// sorted onto the default shelves (library.ts DEFAULT_SHELVES) and narrowed
// with filters that stack, all kept in the address (url-state.ts) so 戻る
// and a reload come back to the same view. ［選ぶ］ picks books and changes
// them together (status, 読みたい, 所有, ☆, 外す), each change undone from
// its notice. While picking, the books shown stay as they were when picking
// began, so a book changed out of the filter is still there to change again.

const label = (key: string) =>
  DEFAULT_SHELVES.find((shelf) => shelf.key === key)?.label ?? key;

/** The shelf a status is, for its name. */
const statusLabel = (status: ReadingStatus) => label(status);

/** The chip of the whole library: its number is at the top of the page. */
const ALL_CHIP = "すべて";

/** What the reader can do to the books picked, and how it is said after. */
interface Change {
  key: string;
  label: string;
  /** Lit: every book picked already has it. */
  lit: (e: LibraryEntry | undefined, favorite: boolean) => boolean;
  /** The change, as it is lit or not. */
  change: (lit: boolean) => LibraryChange;
  /** What was done, after 「n冊を」. */
  done: (lit: boolean) => string;
}

const STATUS_CHANGES: Change[] = READING_STATUSES.map((status) => ({
  key: status,
  label: statusLabel(status),
  lit: (e) => e?.status === status,
  change: (lit) => ({ status: lit ? null : status }),
  done: (lit) =>
    lit
      ? `${statusLabel(status)}から外しました`
      : `${statusLabel(status)}にしました`,
}));

const WANT: Change = {
  key: "want",
  label: "読みたい",
  lit: (e) => e?.wantedAt != null,
  change: (lit) => ({ want: !lit }),
  done: (lit) =>
    lit ? `${label("want")}から外しました` : `${label("want")}に入れました`,
};

const OTHER_CHANGES: Change[] = [
  {
    key: "owned",
    label: "持っている",
    lit: (e) => e?.owned === "yes",
    change: (lit) => ({ owned: lit ? null : "yes" }),
    done: (lit) =>
      lit ? "持っている本から外しました" : "持っている本にしました",
  },
  {
    key: "not-owned",
    label: "持ってない",
    lit: (e) => e?.owned === "no",
    change: (lit) => ({ owned: lit ? null : "no" }),
    done: (lit) =>
      lit ? "持ってない本から外しました" : "持ってない本にしました",
  },
  {
    key: "favorite",
    label: label("favorite"),
    lit: (_, favorite) => favorite,
    change: (lit) => ({ favorite: !lit }),
    done: (lit) =>
      lit
        ? `${label("favorite")}から外しました`
        : `${label("favorite")}に入れました`,
  },
];

const REMOVE: Change = {
  key: "remove",
  label: "ライブラリから外す",
  lit: () => false,
  change: () => ({ removed: true }),
  done: () => "ライブラリから外しました",
};

/** What each filter chip narrows to, in the order of the chips. */
const CHIP_FILTERS: Partial<LibraryFilter>[] = [
  { unsorted: true },
  { owned: "yes" },
  { owned: "no" },
];

/** How many of an op's books it took out of the library (nothing else kept them). */
const leftBy = (undo: LibraryUndo) =>
  undo.books.filter(
    (id) =>
      (undo.after[id]?.removedAt ?? null) !== null &&
      (undo.before[id]?.entry?.removedAt ?? null) === null,
  ).length;

export function LibraryView({
  state,
  actions,
  notify,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
}) {
  const [shelfParam] = useUrlParam("shelf");
  const [unsortedParam] = useUrlParam("unsorted");
  const [ownedParam] = useUrlParam("owned");
  const library = useMemo(() => libraryStateOf(state), [state]);
  const shop = useMemo(() => townShopBooks(state), [state]);
  const counts = useMemo(() => countsOf(library, shop), [library, shop]);
  const filter = useMemo(() => {
    const params = new Map<string, string>();
    if (shelfParam) params.set("shelf", shelfParam);
    if (unsortedParam) params.set("unsorted", unsortedParam);
    if (ownedParam) params.set("owned", ownedParam);
    const f = filterFromParams((key) => params.get(key) ?? null, true);
    // Only the default shelves have a page here; theme shelves come with 15.
    if (f.shelf && !DEFAULT_SHELVES.some((shelf) => shelf.key === f.shelf))
      delete f.shelf;
    if (f.shelf === "all") delete f.shelf;
    return f;
  }, [shelfParam, unsortedParam, ownedParam]);
  const shown = useMemo(
    () => filterLibrary(library, filter, shop),
    [library, filter, shop],
  );
  // The books in the library now (ライブラリ（全部）, and the liked ones
  // only on いいねした本): one taken out while picking is said to be.
  const kept = useMemo(
    () =>
      new Set([
        ...filterLibrary(library, { showWanted: true }, shop),
        ...filterLibrary(library, { shelf: "liked", showWanted: true }, shop),
      ]),
    [library, shop],
  );
  const [picking, setPicking] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<"scan" | "titles" | null>(null);
  const books = useMemo(
    () => new Map(state.books.map((book) => [book.id, book])),
    [state.books],
  );
  const listed = (picking ?? shown).filter((id) => books.has(id));
  const filters = filter.unsorted !== undefined || filter.owned !== undefined;
  const filtered = filters || filter.shelf !== undefined;

  // Picking ended: the finger goes back to ［選ぶ］.
  const pickButton = useRef<HTMLButtonElement>(null);
  const wasPicking = useRef(false);
  useEffect(() => {
    if (wasPicking.current && !picking)
      pickButton.current?.focus({ preventScroll: true });
    wasPicking.current = Boolean(picking);
  }, [picking]);

  const stopPicking = () => {
    setPicking(null);
    setPicked(new Set());
  };
  // After a layer closing now (picking, the scanner) has taken its step of
  // 戻る back off, so the change is made on the page's own step.
  const setFilter = (params: Record<string, string | null>) => {
    stopPicking();
    afterLayerCloses(() => replaceAddress({ params }));
  };
  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const favorites = useMemo(() => new Set(state.favorites), [state.favorites]);
  const pickable = listed.filter((id) => kept.has(id));
  const pickedIds = pickable.filter((id) => picked.has(id));
  const allPicked =
    pickable.length > 0 && pickable.every((id) => picked.has(id));
  const litOf = (change: Change) =>
    pickedIds.length > 0 &&
    pickedIds.every((id) =>
      change.lit(library.libraryEntries[id], favorites.has(id)),
    );

  const run = (change: Change) => {
    const ids = pickedIds;
    if (!ids.length) return;
    const lit = litOf(change);
    const undo = actions.changeLibrary(ids, change.change(lit));
    if (!undo) return;
    const book = ids.length === 1 ? books.get(ids[0]) : undefined;
    const subject = book
      ? `${quotedTitle(book)}を`
      : `${counted(ids.length, "冊")}を`;
    // A book nothing else keeps leaves the library with 読みたい or ☆: said.
    const left = change === REMOVE ? 0 : leftBy(undo);
    const after =
      left === 0
        ? ""
        : book
          ? "（ライブラリからも外れました）"
          : `（${counted(left, "冊")}はライブラリからも外れました）`;
    notify(subject + change.done(lit) + after, {
      label: "元に戻す",
      run: () => {
        const restored = actions.undoLibrary(undo);
        notify(
          restored
            ? `${restored === 1 && book ? quotedTitle(book) : counted(restored, "冊")}を元に戻しました`
            : "そのあと変えた本なので、そのままにしました",
        );
      },
    });
  };

  const pressedShelf = filter.shelf ?? "all";
  const shelfChips = DEFAULT_SHELVES.filter(
    (shelf) =>
      shelf.key === pressedShelf ||
      (shelf.key === "all" ? counts.works > 0 : counts.shelves[shelf.key]),
  );
  // Each filter counts the books it would show here, on this shelf with the
  // other filters; one that would show none, or nothing narrower, is left out.
  const here = useMemo(() => worksIn(library, shown), [library, shown]);
  const chips: {
    key: string;
    label: string;
    on: boolean;
    params: Record<string, string | null>;
  }[] = [
    {
      key: "unsorted",
      label: "未整理",
      on: filter.unsorted === true,
      params: { unsorted: filter.unsorted ? null : "1" },
    },
    {
      key: "owned",
      label: "持っている",
      on: filter.owned === "yes",
      params: { owned: filter.owned === "yes" ? null : "yes" },
    },
    {
      key: "not-owned",
      label: "持ってない",
      on: filter.owned === "no",
      params: { owned: filter.owned === "no" ? null : "no" },
    },
  ];
  const chipCounts = useMemo(
    () =>
      CHIP_FILTERS.map((narrow) =>
        worksIn(
          library,
          filterLibrary(library, { ...filter, ...narrow }, shop),
        ),
      ),
    [library, filter, shop],
  );
  const filterChips = chips.flatMap((chip, i) => {
    if (chip.on) return [{ ...chip, count: here }];
    const count = chipCounts[i];
    return count > 0 && count < here ? [{ ...chip, count }] : [];
  });

  const sheets = (
    <>
      {sheet === "scan" && (
        <ScanSession
          state={state}
          actions={actions}
          notify={notify}
          onClose={(kept) => {
            setSheet(null);
            // What was just read in comes first: the whole library, newest first.
            if (kept) setFilter({ shelf: null, unsorted: null, owned: null });
          }}
        />
      )}
      {sheet === "titles" && (
        <TitlesToType notify={notify} onClose={() => setSheet(null)} />
      )}
    </>
  );

  if (counts.works === 0 && !counts.shelves.liked)
    return (
      <div className="library-page">
        <header className="library-head">
          <h1>ライブラリ</h1>
        </header>
        <JournalNotes notify={notify} onTypeTitles={() => setSheet("titles")} />
        <section className="library-start">
          <Icon name="shelf" size={34} />
          <h2>出会った本が、ここに並びます。</h2>
          <p>
            読み取った本、読みたい本、いいねした本。積読や読了に分けて、まとめて整理できます。
          </p>
          <div className="btns">
            <button
              type="button"
              className="btn fill"
              onClick={() => setSheet("scan")}
            >
              <Icon name="plus" /> 本を登録
            </button>
            <Link className="btn" href="/walk/">
              書店めぐりに出かける
            </Link>
          </div>
        </section>
        {sheets}
      </div>
    );

  return (
    <div className={"library-page" + (picking ? " is-picking" : "")}>
      <header className="library-head" inert={Boolean(picking)}>
        <div>
          <h1>ライブラリ</h1>
          {counts.works > 0 && <p>{counted(counts.works, "冊")}</p>}
        </div>
        <button
          type="button"
          className="btn fill"
          onClick={() => setSheet("scan")}
        >
          <Icon name="plus" /> 本を登録
        </button>
      </header>
      <JournalNotes notify={notify} onTypeTitles={() => setSheet("titles")} />

      <div
        className="library-chips"
        role="group"
        aria-label="棚"
        inert={Boolean(picking)}
      >
        {shelfChips.map((shelf) => {
          const n = shelf.key === "all" ? 0 : counts.shelves[shelf.key];
          return (
            <button
              type="button"
              key={shelf.key}
              className="chip"
              aria-pressed={pressedShelf === shelf.key}
              aria-label={
                n
                  ? `${shelf.label} ${counted(n, "冊")}`
                  : shelf.key === "all"
                    ? ALL_CHIP
                    : shelf.label
              }
              onClick={() =>
                setFilter({ shelf: shelf.key === "all" ? null : shelf.key })
              }
            >
              {shelf.key === "all" ? ALL_CHIP : shelf.label}
              {n ? <span className="library-count">{n}</span> : null}
            </button>
          );
        })}
      </div>
      {filterChips.length > 0 && (
        <div
          className="library-chips"
          role="group"
          aria-label="絞り込み"
          inert={Boolean(picking)}
        >
          {filterChips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              className="chip"
              aria-pressed={chip.on}
              aria-label={`${chip.label} ${counted(chip.count, "冊")}`}
              onClick={() => setFilter(chip.params)}
            >
              {chip.on && <Icon name="check" size={16} />}
              {chip.label}
              {chip.count ? (
                <span className="library-count">{chip.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {filter.unsorted && (
        <p className="library-note">
          積読・読書中・読了・読みたい・お気に入り・自分の本屋の棚の、どれにも入れていない本です。
        </p>
      )}

      {listed.length > 0 && (
        <div className="library-bar" inert={Boolean(picking)}>
          {/* The whole library's number is at the top; a filtered view says its own. */}
          {filtered && (
            <p aria-live="polite">{counted(worksIn(library, listed), "冊")}</p>
          )}
          <button
            type="button"
            className="btn soft"
            ref={pickButton}
            hidden={Boolean(picking)}
            onClick={() => {
              setPicking(shown);
              setPicked(new Set());
            }}
          >
            選ぶ
          </button>
        </div>
      )}

      {listed.length ? (
        <ul className="library-grid">
          {listed.map((id) => {
            const book = books.get(id);
            if (!book) return null;
            const e = library.libraryEntries[id];
            const gone = !kept.has(id);
            const marks = gone
              ? ["ライブラリから外しました"]
              : [
                  e?.status && statusLabel(e.status),
                  e?.wantedAt && filter.shelf !== "want" && "読みたい",
                  e?.owned === "yes" && "持っている",
                  e?.owned === "no" && "持ってない",
                  favorites.has(id) &&
                    filter.shelf !== "favorite" &&
                    label("favorite"),
                ].filter((mark): mark is string => Boolean(mark));
            const face = (
              <>
                <BookJacket book={book} />
                <strong>{bookTitle(book)}</strong>
                <small>{bookAuthor(book)}</small>
                {marks.length > 0 && (
                  <span className="library-marks">
                    {marks.map((mark) => (
                      <span key={mark}>{mark}</span>
                    ))}
                  </span>
                )}
              </>
            );
            return (
              <li key={id} className={gone ? "is-gone" : undefined}>
                {picking ? (
                  <button
                    type="button"
                    className="library-book"
                    aria-pressed={picked.has(id) && !gone}
                    aria-label={`${bookTitle(book)}を選ぶ`}
                    disabled={gone}
                    onClick={() => toggle(id)}
                  >
                    {picked.has(id) && !gone && (
                      <span className="library-tick" aria-hidden="true">
                        <Icon name="check" size={18} />
                      </span>
                    )}
                    {face}
                  </button>
                ) : (
                  <Link className="library-book" href={bookPath(id)}>
                    {face}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="library-start">
          <h2>この組み合わせの本は、ありません。</h2>
          {filters ? (
            <button
              type="button"
              className="btn"
              onClick={() => setFilter({ unsorted: null, owned: null })}
            >
              絞り込みを外す
            </button>
          ) : filter.shelf ? (
            <button
              type="button"
              className="btn"
              onClick={() => setFilter({ shelf: null })}
            >
              すべての本を見る
            </button>
          ) : null}
        </section>
      )}

      {picking && (
        <PickBar
          count={pickedIds.length}
          allPicked={allPicked}
          onAll={() => setPicked(allPicked ? new Set() : new Set(pickable))}
          onDone={stopPicking}
        >
          <div className="library-pick-row" role="group" aria-label="状態">
            {[...STATUS_CHANGES, WANT].map((change) => (
              <ChangeButton
                key={change.key}
                change={change}
                lit={litOf(change)}
                disabled={!pickedIds.length}
                onPress={() => run(change)}
              />
            ))}
          </div>
          <div className="library-pick-row" role="group" aria-label="そのほか">
            {OTHER_CHANGES.map((change) => (
              <ChangeButton
                key={change.key}
                change={change}
                lit={litOf(change)}
                disabled={!pickedIds.length}
                onPress={() => run(change)}
              />
            ))}
            <button
              type="button"
              className="btn quiet"
              disabled={!pickedIds.length}
              onClick={() => run(REMOVE)}
            >
              {REMOVE.label}
            </button>
          </div>
        </PickBar>
      )}
      {sheets}
    </div>
  );
}

function ChangeButton({
  change,
  lit,
  disabled,
  onPress,
}: {
  change: Change;
  lit: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={lit}
      disabled={disabled}
      onClick={onPress}
    >
      {lit && <Icon name="check" size={16} />}
      {change.label}
    </button>
  );
}

/**
 * The bar of changes while picking: one step of 戻る, which stops picking.
 * It says how tall it is (--library-pick-height), so a notice sits above it.
 */
function PickBar({
  count,
  allPicked,
  onAll,
  onDone,
  children,
}: {
  count: number;
  allPicked: boolean;
  onAll: () => void;
  onDone: () => void;
  children: React.ReactNode;
}) {
  useBackLayer(onDone);
  const bar = useRef<HTMLElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    heading.current?.focus({ preventScroll: true });
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty(
        "--library-pick-height",
        `${element.getBoundingClientRect().height}px`,
      );
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => {
      watch.disconnect();
      root.style.removeProperty("--library-pick-height");
    };
  }, []);
  return (
    <section className="library-pick" aria-label="選んだ本を変える" ref={bar}>
      <div className="library-pick-head">
        <p aria-live="polite" tabIndex={-1} ref={heading}>
          {count ? `${counted(count, "冊")}を選択中` : "本を選んでください"}
        </p>
        <button type="button" className="text-btn" onClick={onAll}>
          {allPicked ? "すべて解除" : "すべて選ぶ"}
        </button>
        <button type="button" className="btn quiet" onClick={onDone}>
          完了
        </button>
      </div>
      {children}
    </section>
  );
}
