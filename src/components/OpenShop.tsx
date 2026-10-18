"use client";

import { Fragment, useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  ME_ID,
  POP_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_TAGLINE_MAX_LENGTH,
  type Book,
  type Shop,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  FIRST_SHELF_ID,
  getTownSnapshot,
  usePersistenceStatus,
} from "../lib/store";
import { recentlyFinished } from "../lib/records";
import { BookPicker } from "./BookPicker";
import { booksBeforeSearch } from "../lib/book-lists";
import { BookJacket, Icon } from "./ui";
import "./open-shop.css";
import { noteShopOpened } from "../lib/just-opened";
import { leaveLayers, useBackLayer, useLayerReturn } from "../lib/back-layer";
import { useKeptDraft } from "../lib/kept-draft";
import {
  FRESH_OPEN_SHOP,
  OPEN_SHOP_MAX,
  openShopDraftStore,
  openShopHasWords,
  type OpenShopKind,
  type OpenShopWork,
} from "../lib/open-shop-draft";
import { townTook, useKeptUntilSaved } from "../lib/shop-draft";
import { KeptDraftNote, useDraftOwner } from "./KeptDraftNote";
import { bookById, bookTitle } from "../lib/book-name";
import { counted, nth, failure, AGAIN, KEPT, PLACE } from "../lib/words";
import { pickSources } from "../lib/shop-picks";
import { useUrlParam } from "../lib/url-state";
import { walkPath } from "../lib/paths";
import { japanYear } from "../lib/japan-time";

/** How many books of a library shelf the opening shows at a time. */
const FROM_PAGE = 24;

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

export const THEMES: { value: Shop["theme"]; label: string; color: string }[] =
  [
    { value: "sage", label: "深緑", color: "#405b4b" },
    { value: "ink", label: "藍色", color: "#35485e" },
    { value: "ochre", label: "黄土", color: "#a77941" },
    { value: "rose", label: "あずき", color: "#8e5f60" },
  ];

export function ThemePicker({
  value,
  onChange,
}: {
  value: Shop["theme"];
  onChange: (theme: Shop["theme"]) => void;
}) {
  return (
    <div
      className="editor-theme-picker"
      role="group"
      aria-label="書店のテーマカラー"
    >
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          type="button"
          className={`editor-theme-option ${value === theme.value ? "is-selected" : ""}`}
          aria-pressed={value === theme.value}
          onClick={() => onChange(theme.value)}
        >
          <span
            className="editor-theme-dot"
            style={{ background: theme.color }}
          >
            {value === theme.value && <Icon name="check" size={15} />}
          </span>
          {theme.label}
        </button>
      ))}
    </div>
  );
}

type Kind = OpenShopKind;

const KINDS: {
  kind: Exclude<Kind, "free">;
  title: string;
  lead: string;
  max: number;
}[] = [
  {
    kind: "nine",
    title: "人生の9冊の書店",
    lead: "あなたを少し語ってくれる9冊を。",
    max: OPEN_SHOP_MAX.nine,
  },
  {
    kind: "five",
    title: "今年の5冊の書店",
    lead: "今年出会ってよかった5冊を。",
    max: OPEN_SHOP_MAX.five,
  },
  {
    kind: "one",
    title: "たった1冊の書店",
    lead: "いちばん渡したい1冊だけを、言葉を添えて。",
    max: OPEN_SHOP_MAX.one,
  },
];

const NAME_EXAMPLES = [
  "雨音書店",
  "夜更かし文庫",
  "二番目の本棚",
  "寄り道書房",
  "午後三時の書店",
  "しおり堂",
  "遠回り書店",
  "木漏れ日文庫",
  "月曜日の本棚",
  "灯りの下の書店",
];

const OPENED = [
  "灯りがつきました。",
  "最初のお客さんは、案外すぐ来るかもしれません。",
];
const openedWords = () => OPENED[Math.floor(Math.random() * OPENED.length)];

const shelfName = (kind: Kind) =>
  kind === "nine"
    ? "人生の9冊"
    : kind === "five"
      ? `${japanYear()}年の5冊`
      : kind === "one"
        ? "たった1冊"
        : "はじめの本棚";

const kindTitle = (kind: Kind) =>
  KINDS.find((entry) => entry.kind === kind)?.title ?? "空の棚から始める書店";

/** Books the reader already knows, nearest to the shop they chose first. */
function candidates(state: TownState, kind: Kind): string[] {
  const year = String(japanYear());
  const records = state.readingRecords
    .filter((record) => record.readerId === ME_ID)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const thisYear = records
    .filter((record) => record.createdAt.startsWith(year))
    .map((record) => record.bookId);
  const recommended = records
    .filter((record) => record.feelings.includes("recommend"))
    .map((record) => record.bookId);
  const lists =
    kind === "nine"
      ? [state.me.lifeNine, state.favorites, state.finishedBooks]
      : kind === "five"
        ? [thisYear, state.finishedBooks, state.favorites]
        : [recommended, state.favorites, state.me.lifeNine];
  return [
    ...lists.flat(),
    ...records.map((record) => record.bookId),
    ...state.library,
  ].filter(
    (bookId, index, all) =>
      all.indexOf(bookId) === index &&
      state.books.some((book) => book.id === bookId),
  );
}

/**
 * 3分で開店: choose a kind of shop, pick its books, name the sign, open.
 * The books go on the first shelf, public, so the shop joins the walk at once.
 */
export function OpenShop({
  state,
  actions,
  notify,
  onOpen,
  onDone,
  startBook = null,
}: Shared & {
  /**
   * A book chosen on its page (自分の書店へ): it is on the shelf of the kind
   * of shop chosen first, while there is room.
   */
  startBook?: string | null;
  /** Called just before the shop is created, so the page keeps this flow on screen. */
  onOpen: () => void;
  /** Leaves the flow for the full shop editor. */
  onDone: () => void;
}) {
  const nameId = useId();
  const taglineId = useId();
  const popId = useId();
  const owner = useDraftOwner();
  const kept = useKeptDraft(openShopDraftStore, owner);
  const persistence = usePersistenceStatus();
  // Kept work waits for the town: its books are checked against the town's,
  // and an account's town arrives after the page.
  const ready = owner !== null && kept.loaded && persistence !== "loading";
  const [step, setStep] = useState<"kind" | "books" | "sign" | "opened">(
    "kind",
  );
  const [kind, setKind] = useState<Kind>("nine");
  // Whether this visit began with work kept from before.
  const [resumed, setResumed] = useState<boolean | null>(null);
  if (resumed === null && ready) setResumed(kept.draft !== null);
  const [example, setExample] = useState(0);
  const [opened, setOpened] = useState<{
    name: string;
    words: string;
    books: Book[];
    theme: Shop["theme"];
  }>({ name: "", words: OPENED[0], books: [], theme: "sage" });
  const draft = kept.draft;
  // The work in hand: what is kept, or a fresh start of the kind chosen.
  const work: OpenShopWork = draft ?? {
    ...FRESH_OPEN_SHOP,
    kind,
    step: kind === "free" ? "sign" : "books",
  };
  const { pop, name, tagline, theme } = work;
  const chosen = KINDS.find((entry) => entry.kind === kind);
  const max = chosen?.max ?? 0;
  const book = (id: string) => bookById(state.books, id);
  // A kind not touched yet starts from its usual books; books no longer in
  // the town drop out of what was kept.
  const usual = (next: Kind) => (next === "nine" ? state.me.lifeNine : []);
  const picked =
    kind === "free"
      ? []
      : (work.picks[kind] ?? usual(kind))
          .filter((id) => book(id))
          .slice(0, max);
  const pickedBooks = picked
    .map(book)
    .filter((entry): entry is Book => Boolean(entry));
  const own = candidates(state, kind);
  const suggested = own.filter((id) => !picked.includes(id)).slice(0, 12);
  // Or a shelf of the library, 読了 or one the reader made (AUD-053): the
  // choice lives in the address, as a screen's small choices do.
  const sources = useMemo(() => pickSources(state), [state]);
  const [fromParam, setFrom] = useUrlParam("from");
  const source = sources.find((entry) => entry.key === fromParam);
  const [fromPages, setFromPages] = useState(1);
  const fromShelf = (source?.ids ?? []).filter((id) => !picked.includes(id));
  // Until the reader has a shelf of their own, books the town reads help.
  const fromTown = [
    ...recentlyFinished(state, 12),
    ...state.shops.flatMap((shop) =>
      shop.shelves
        .filter((shelf) => shelf.isPublic)
        .flatMap((shelf) => shelf.items.map((item) => item.bookId)),
    ),
  ]
    .filter(
      (id, index, all) =>
        all.indexOf(id) === index &&
        !own.includes(id) &&
        !picked.includes(id) &&
        Boolean(book(id)),
    )
    .slice(0, Math.max(0, 12 - suggested.length));

  /** Writes the work in hand, kept for the reader as it is written. */
  function change(patch: Partial<OpenShopWork>) {
    kept.set({
      ...work,
      kind,
      step: step === "books" || step === "sign" ? step : work.step,
      ...patch,
    });
  }
  function go(at: "kind" | "books" | "sign") {
    setStep(at);
    // The kept work goes on from the step reached.
    if (draft && at !== "kind" && (draft.step !== at || draft.kind !== kind))
      kept.set({ ...draft, kind, step: at });
  }
  // The kinds the book chosen on its page was put on already: taken off
  // there, it stays off.
  const [startedOn, setStartedOn] = useState<Kind[]>([]);
  function choose(
    next: Kind,
    at: "books" | "sign" = next === "free" ? "sign" : "books",
  ) {
    setKind(next);
    setStep(at);
    const room = KINDS.find((entry) => entry.kind === next)?.max ?? 0;
    const had =
      next === "free"
        ? []
        : (work.picks[next] ?? usual(next)).filter((id) => book(id));
    if (
      startBook &&
      next !== "free" &&
      !startedOn.includes(next) &&
      book(startBook) &&
      !had.includes(startBook) &&
      had.length < room
    ) {
      // First on the shelf, so it faces out.
      setStartedOn([...startedOn, next]);
      kept.set({
        ...work,
        kind: next,
        step: at,
        picks: { ...work.picks, [next]: [startBook, ...had] },
      });
      return;
    }
    // The kept work follows to the kind chosen; the books chosen for each
    // kind stay with it.
    if (draft) kept.set({ ...draft, kind: next, step: at });
  }
  function discard() {
    kept.clear();
    setResumed(false);
  }
  const saving = useKeptUntilSaved(() => {
    // Turned away by the account after all: no shop stands, and the sign is
    // there to open it again, with the work as it was.
    if (getTownSnapshot().ownShop) return;
    setResumed(true);
    setStep("sign");
    notify(
      failure({
        what: "開店できませんでした",
        kept: KEPT.draft,
        next: AGAIN.later,
      }),
    );
  });
  // Back or forward to a step of this flow shows that step again, with the
  // work kept for it.
  useLayerReturn((layer) => {
    const [flow, was, at] = layer.split(":");
    const known =
      was === "free" ? "free" : KINDS.find((entry) => entry.kind === was)?.kind;
    if (
      flow !== "open-shop" ||
      !known ||
      !(at === "sign" || (at === "books" && known !== "free"))
    )
      return false;
    if (was === kind && at === step) return false;
    choose(known, at);
    return true;
  }, ready);
  function toggle(bookId: string) {
    if (kind === "free") return;
    const list = picked.includes(bookId)
      ? picked.filter((id) => id !== bookId)
      : picked.length < max
        ? [...picked, bookId]
        : max === 1
          ? [bookId]
          : picked;
    change({ picks: { ...work.picks, [kind]: list } });
  }
  function open() {
    const shopName = name.trim();
    if (!shopName || !ready) return;
    onOpen();
    setFrom(null);
    if (!townTook(() => actions.createShop(shopName, "", theme))) {
      // Turned away (the town was still on its way): nothing opened, and
      // the work stays as it is.
      onDone();
      notify(
        failure({ what: "まだ開店できませんでした", next: AGAIN.pressLater }),
      );
      return;
    }
    if (tagline.trim())
      actions.updateShop({
        name: shopName,
        description: "",
        theme,
        tagline: tagline.trim(),
      });
    actions.updateShelf(FIRST_SHELF_ID, { name: shelfName(kind) });
    // The first book faces out; the rest stand as spines. Only たった1冊
    // asks for a POP.
    picked.forEach((bookId, index) =>
      actions.addShelfBook(
        FIRST_SHELF_ID,
        bookId,
        index === 0 ? "face" : "spine",
        index === 0 && kind === "one" && pop.trim()
          ? { pop: pop.trim(), index: 0 }
          : undefined,
      ),
    );
    noteShopOpened();
    // The shop is open: the work that led here is kept only until the
    // account has the shop too.
    if (draft && owner) saving.hold("open", openShopDraftStore, owner, draft);
    // The steps that led here come off: 戻る from the open shop leaves it.
    leaveLayers(
      () => {},
      (token) => token.startsWith("open-shop:"),
    );
    setOpened({
      name: shopName,
      words: openedWords(),
      books: pickedBooks.slice(0, 9),
      theme,
    });
    setStep("opened");
  }
  const keptNote = (
    <KeptDraftNote
      className="open-kept"
      work={draft !== null}
      continuing={Boolean(resumed)}
      saved={kept.saved}
      wordsLost={openShopHasWords(work)}
      onDiscard={discard}
    />
  );

  // Each step past the first is one step of 戻る, back to the one before.
  const steps = (
    <>
      {kind !== "free" && (step === "books" || step === "sign") && (
        <StepBack
          key="books"
          name={`open-shop:${kind}:books`}
          onBack={() => go("kind")}
        />
      )}
      {step === "sign" && (
        <StepBack
          key="sign"
          name={`open-shop:${kind}:sign`}
          onBack={() => go(kind === "free" ? "kind" : "books")}
        />
      )}
    </>
  );

  if (step === "opened")
    return (
      <section className={"open-shop open-done theme-" + opened.theme}>
        <div className="open-storefront" aria-hidden="true">
          <div className="open-storefront-sign">{opened.name}</div>
          <div className="open-storefront-window">
            <span className="open-shutter" />
            {opened.books.map((entry, index) => (
              <span
                key={entry.id}
                className="open-window-book"
                style={{ animationDelay: 0.9 + index * 0.07 + "s" }}
              >
                <BookJacket book={entry} />
              </span>
            ))}
          </div>
        </div>
        <span className="editor-kicker">OPEN</span>
        <h1>{opened.words}</h1>
        <p role="status">
          「{opened.name}」が開店しました。本の街の
          {nth(state.shops.length + 1, "軒")}
          の書店です。
        </p>
        <div className="open-next">
          <Link className="btn fill" href={walkPath("mine")}>
            <Icon name="store" size={17} />
            街を歩いてみる
          </Link>
          <button type="button" className="btn" onClick={onDone}>
            <Icon name="shelf" size={17} />
            棚を整える
          </button>
        </div>
      </section>
    );

  if (step === "kind")
    return (
      <section className="open-shop" aria-labelledby="open-kind-title">
        <span className="editor-kicker">YOUR LITTLE BOOKSHOP</span>
        <h1 id="open-kind-title">3分で、あなたの書店を開く</h1>
        <p className="open-lead">
          まずは、どんな書店にするかだけ。本も名前も、あとから自由に変えられます。
        </p>
        {/* Work kept from before waits here, to go on from where it was. */}
        {ready && draft && (
          <KeptDraftNote
            className="open-resume"
            continuing
            saved={kept.saved}
            wordsLost={openShopHasWords(draft)}
            onDiscard={discard}
            action={
              <>
                <span className="open-resume-what">
                  「{draft.name.trim() || kindTitle(draft.kind)}」
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setResumed(true);
                    choose(draft.kind, draft.step);
                  }}
                >
                  続きから
                </button>
              </>
            }
          />
        )}
        <div className="open-kinds">
          {KINDS.map((entry) => (
            <button
              type="button"
              key={entry.kind}
              className={"open-kind is-" + entry.kind}
              disabled={!ready}
              onClick={() => choose(entry.kind)}
            >
              <span className="open-kind-shelf" aria-hidden="true">
                {Array.from({ length: entry.max }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
              <b>{entry.title}</b>
              <small>{entry.lead}</small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="text-btn open-free"
          disabled={!ready}
          onClick={() => choose("free")}
        >
          空の棚から始める
        </button>
      </section>
    );

  if (step === "books")
    return (
      <section className="open-shop" aria-labelledby="open-books-title">
        {steps}
        <button
          type="button"
          className="text-btn open-back"
          onClick={() => go("kind")}
        >
          <Icon name="back" size={14} /> 書店の形を選び直す
        </button>
        <span className="editor-kicker">{chosen?.title}</span>
        <h1 id="open-books-title">
          {max === 1 ? "渡したい1冊を選ぶ" : `${counted(max, "冊")}を選ぶ`}
        </h1>
        {keptNote}
        <p className="open-lead" aria-live="polite">
          {picked.length === max
            ? "棚がいっぱいになりました。"
            : picked.length
              ? `あと${counted(max - picked.length, "冊")}まで並べられます。`
              : `${counted(max, "冊")}まで並べられます。1冊からでも開けます。`}
        </p>
        <div
          className={"open-shelf theme-" + theme}
          aria-label="並べた本"
          role="list"
        >
          {pickedBooks.map((entry) => (
            <div role="listitem" key={entry.id} className="open-shelf-book">
              <BookJacket book={entry} />
              <button
                type="button"
                aria-label={bookTitle(entry) + "を棚から外す"}
                onClick={() => toggle(entry.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          {Array.from({ length: max - pickedBooks.length }, (_, index) => (
            <span
              key={"slot-" + index}
              className="open-shelf-slot"
              aria-hidden="true"
            />
          ))}
        </div>
        {sources.length > 0 && (
          <>
            <h2 className="open-subtitle">あなたのライブラリから</h2>
            <div className="chips" role="group" aria-label="選ぶ棚">
              {[{ key: null, label: PLACE.suggested }, ...sources].map(
                (entry) => (
                  <button
                    type="button"
                    key={entry.key ?? ""}
                    className="chip"
                    aria-pressed={(source?.key ?? null) === entry.key}
                    onClick={() => {
                      setFrom(entry.key);
                      setFromPages(1);
                    }}
                  >
                    {entry.label}
                  </button>
                ),
              )}
            </div>
          </>
        )}
        {(source
          ? [{ heading: "", ids: fromShelf.slice(0, fromPages * FROM_PAGE) }]
          : [
              {
                heading: sources.length ? "" : "あなたのライブラリから",
                ids: suggested,
              },
              { heading: "街で読まれている本から", ids: fromTown },
            ]
        ).map(
          (group) =>
            group.ids.length > 0 && (
              <Fragment key={group.heading || "shelf"}>
                {group.heading && (
                  <h2 className="open-subtitle">{group.heading}</h2>
                )}
                <ul className="open-candidates">
                  {group.ids.map((id) => {
                    const entry = book(id)!;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => toggle(id)}
                          disabled={picked.length >= max && max > 1}
                          aria-label={bookTitle(entry) + "を棚に並べる"}
                        >
                          <BookJacket book={entry} />
                          <small>{bookTitle(entry)}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Fragment>
            ),
        )}
        {source && fromShelf.length > fromPages * FROM_PAGE && (
          <button
            type="button"
            className="text-btn open-more"
            onClick={() => setFromPages(fromPages + 1)}
          >
            {PLACE.more}
          </button>
        )}
        <h2 className="open-subtitle">本を探す</h2>
        <BookPicker
          books={state.books}
          genreFinds={booksBeforeSearch(state)}
          value={null}
          onChange={(bookId) =>
            bookId && !picked.includes(bookId) && toggle(bookId)
          }
          label="棚に並べる本"
        />
        {kind === "one" && (
          <>
            <label className="form-label open-pop-label" htmlFor={popId}>
              この1冊を渡したい理由（POPになります）
            </label>
            <textarea
              id={popId}
              className="field open-pop"
              rows={4}
              maxLength={POP_MAX_LENGTH}
              placeholder="読んだ夜のこと、誰に渡したいか、どこが好きか"
              value={pop}
              onChange={(event) => change({ pop: event.target.value })}
            />
          </>
        )}
        <div className="open-actions">
          <button
            type="button"
            className="btn fill"
            disabled={!picked.length}
            onClick={() => go("sign")}
          >
            看板を決める
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </section>
    );

  return (
    <section className="open-shop" aria-labelledby="open-sign-title">
      {steps}
      <button
        type="button"
        className="text-btn open-back"
        onClick={() => go(kind === "free" ? "kind" : "books")}
      >
        <Icon name="back" size={14} />
        {kind === "free" ? "書店の形を選び直す" : "本を選び直す"}
      </button>
      <span className="editor-kicker">まずは、看板から。</span>
      <h1 id="open-sign-title">店の名前と看板</h1>
      {keptNote}
      <div className={"open-sign theme-" + theme} aria-hidden="true">
        <b className={name.trim() ? "" : "is-example"}>
          {name.trim() || NAME_EXAMPLES[example]}
        </b>
        <small>
          {tagline.trim() || "あなたの愛した一冊が、誰かの愛する一冊になる。"}
        </small>
      </div>
      <form
        className="open-sign-form"
        onSubmit={(event) => {
          event.preventDefault();
          open();
        }}
      >
        <label className="editor-label" htmlFor={nameId}>
          書店の名前 <span className="editor-required">必須</span>
        </label>
        <div className="open-name">
          <input
            id={nameId}
            value={name}
            onChange={(event) => change({ name: event.target.value })}
            maxLength={SHOP_NAME_MAX_LENGTH}
            placeholder={"例：" + NAME_EXAMPLES[example]}
            required
            autoComplete="off"
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              change({ name: NAME_EXAMPLES[example] });
              setExample((example + 1) % NAME_EXAMPLES.length);
            }}
          >
            名前の例
          </button>
        </div>
        <label className="editor-label" htmlFor={taglineId}>
          ひとこと{" "}
          <span className="editor-optional">任意・看板の下に出ます</span>
        </label>
        <input
          id={taglineId}
          value={tagline}
          onChange={(event) => change({ tagline: event.target.value })}
          maxLength={SHOP_TAGLINE_MAX_LENGTH}
          placeholder="例：一頁ぶん、遠回り。"
          autoComplete="off"
        />
        <div className="editor-label">
          看板の色{" "}
          <ThemePicker
            value={theme}
            onChange={(next) => change({ theme: next })}
          />
        </div>
        <button
          className="btn fill open-submit"
          type="submit"
          disabled={!name.trim() || !ready}
        >
          <Icon name="store" size={18} />
          書店をひらく
        </button>
        <p className="editor-field-note">
          {picked.length
            ? `「${shelfName(kind)}」の棚に${counted(picked.length, "冊")}を並べて開店します。`
            : "空の棚で開店します。本はあとから並べられます。"}
        </p>
      </form>
    </section>
  );
}

/** One step of opening the shop, as a step of 戻る. */
function StepBack({ name, onBack }: { name: string; onBack: () => void }) {
  useBackLayer(onBack, name);
  return null;
}
