"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ME_ID,
  type Book,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  POSTER_FONT_NAMES,
  POSTER_FONTS,
  POSTER_LIMITS,
  POSTER_TEMPLATE_WORDS,
  POSTER_TEMPLATES,
  POSTER_THEME_STYLES,
  POSTER_THEMES,
  emptyPage,
  pageBooks,
  posterBookIds,
  posterProblem,
  type Poster,
  type PosterDraft,
  type PosterPage,
  type PosterTemplate,
} from "../lib/posters";
import {
  posterMark,
  posterWorkFor,
  posterWorkKey,
  usePosterDraft,
  type KeptPosterWork,
  type PosterWork,
} from "../lib/poster-draft";
import { leavePageFor } from "../lib/in-town";
import { reviewNoteOf, reviewNoteWords } from "../lib/social";
import { currentBookId } from "../lib/reading";
import { booksBeforeSearch } from "../lib/book-lists";
import { usePersistenceStatus } from "../lib/store";
import { posterNewPath, posterPath, profilePath } from "../lib/paths";
import { accountRequested } from "../lib/visitor";
import { refusedForSample } from "../lib/sample-notice";
import { enterPressed, useBookSearch } from "../lib/search/use-book-search";
import { BackLink } from "./BackLink";
import { PosterSheet } from "./PosterView";
import { BookJacket, Icon } from "./ui";
import "./poster-editor.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: (message: string) => void;
};

const freshWork = (bookId?: string): PosterWork => ({
  template: "one_book",
  theme: "kinari",
  font: "mincho",
  pages: [{ ...emptyPage(), bookIds: bookId ? [bookId] : [] }],
  spoiler: false,
  inTimeline: true,
});

const workOf = (poster: Poster): PosterWork => ({
  template: poster.template,
  theme: poster.theme,
  font: poster.font,
  pages: poster.pages.map((page) => ({ ...page, bookIds: [...page.bookIds] })),
  spoiler: poster.spoiler,
  inTimeline: poster.inTimeline,
});

/**
 * Makes a poster, or with `posterId` changes one of the viewer's own. With
 * `bookId` the poster starts about that book.
 */
export function PosterEditor({
  posterId,
  bookId,
  ...props
}: Shared & { posterId?: string; bookId?: string }) {
  const persistence = usePersistenceStatus();
  const poster = posterId
    ? props.state.posters.find((entry) => entry.id === posterId)
    : undefined;
  if (posterId && !poster && persistence === "loading")
    return <p role="status">ポスターを開いています…</p>;
  if (posterId && !poster)
    return (
      <EditorRefusal title="このポスターは見つかりませんでした">
        消されたか、まだ読み込んでいるところかもしれません。
      </EditorRefusal>
    );
  if (poster && poster.authorId !== ME_ID) {
    const first = posterBookIds(poster)[0];
    return (
      <EditorRefusal
        title="このポスターは、作った人だけが直せます"
        poster={poster}
        bookId={first}
      >
        {first
          ? "気に入ったら、同じ本で自分のポスターを作ることもできます。"
          : "気に入ったら、自分のポスターを作ることもできます。"}
      </EditorRefusal>
    );
  }
  return (
    <PosterMaker
      // The work of one poster never carries over into another's.
      key={posterWorkKey({ posterId, bookId })}
      {...props}
      poster={poster}
      bookId={bookId}
    />
  );
}

function EditorRefusal({
  title,
  poster,
  bookId,
  children,
}: {
  title: string;
  poster?: Poster;
  /** The book a poster of the reader's own would start about. */
  bookId?: string;
  children: ReactNode;
}) {
  return (
    <div className="poster-editor-refusal">
      <BackLink className="back-link" />
      <div className="empty-state">
        <h1>{title}</h1>
        <p>{children}</p>
        <div className="empty-state-actions">
          {poster && (
            <Link href={posterPath(poster.id)} className="button secondary">
              ポスターを見る
            </Link>
          )}
          <Link href={posterNewPath({ bookId })} className="button">
            ポスターを作る
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Work kept in this browser for other posters, newest first, each named by
 * its heading or its book. Work on a poster that is gone, or changed since
 * elsewhere, would not open, so it is left out.
 */
function workElsewhere(
  all: Record<string, KeptPosterWork>,
  state: TownState,
): { key: string; name: string; href: string }[] {
  const book = (id?: string) => state.books.find((entry) => entry.id === id);
  return Object.entries(all)
    .filter(([key]) => key !== "new")
    .sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at))
    .flatMap(([key, work]) => {
      const { posterId, bookId } = posterWorkFor(key);
      if (posterId) {
        const poster = state.posters.find(
          (entry) => entry.id === posterId && entry.authorId === ME_ID,
        );
        if (!poster || work.from !== posterMark(workOf(poster))) return [];
      }
      const heading = work.pages
        .map((page) => page.heading.trim())
        .find(Boolean);
      const first = [...work.pages.flatMap((page) => page.bookIds), bookId]
        .map(book)
        .find(Boolean);
      return [
        {
          key,
          name: heading ?? (first ? `『${first.title}』` : "題のないポスター"),
          href: posterNewPath({ posterId, bookId }),
        },
      ];
    });
}

const FAILED = {
  save: "うまく残せませんでした。少し待って、もう一度お試しください。",
  delete: "うまく消せませんでした。少し待って、もう一度お試しください。",
};

/** A step back the reader can take after a change that let something go. */
type Undo = { work: PosterWork; message: string };

function PosterMaker({
  state,
  actions,
  notify,
  poster,
  bookId,
}: Shared & { poster?: Poster; bookId?: string }) {
  const router = useRouter();
  const key = posterWorkKey({ posterId: poster?.id, bookId });
  const { kept, all, saved, keep, clear } = usePosterDraft(key);
  // Work begun from another version of the poster (changed since, on
  // another device) is out of date.
  const from = poster ? posterMark(workOf(poster)) : undefined;
  const keptFresh = kept && kept.from === from ? kept : null;
  const work: PosterWork =
    keptFresh ?? (poster ? workOf(poster) : freshWork(bookId));
  const [pageIndex, setPageIndex] = useState(0);
  const at = Math.min(pageIndex, work.pages.length - 1);
  const page = work.pages[at];
  const [undo, setUndo] = useState<Undo | null>(null);
  const [asked, setAsked] = useState(false);
  const [failed, setFailed] = useState<keyof typeof FAILED | null>(null);
  // What a screen reader says when a press did nothing.
  const [said, setSaid] = useState({ words: "", times: 0 });
  const [confirming, setConfirming] = useState<"reset" | "delete" | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const elsewhere = key === "new" ? workElsewhere(all, state) : [];
  // Folded or held by reports: the maker is told here too, as on its page.
  const reviewNote = poster
    ? reviewNoteOf(state, "poster", poster.id, poster.authorId)
    : null;
  const elsewhereId = useId();

  // When a change takes away the button the hand was on, the hand goes on
  // to what took its place: a confirm's やめる, the button that opened it,
  // or the page now chosen.
  const form = useRef<HTMLFormElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const handTo = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const find = handTo.current;
    if (!find) return;
    handTo.current = null;
    find()?.focus();
  });
  const chosenTab = () =>
    tabs.current?.querySelector<HTMLElement>("[aria-pressed='true']");

  const known = new Set(state.books.map((book) => book.id));
  const limit = pageBooks[work.template];
  // The town may still be loading a book; until then the poster goes without
  // it. Books the template has no room for wait, out of sight.
  const shown = (pages: PosterPage[]) =>
    pages.map((entry) => ({
      ...entry,
      bookIds: entry.bookIds
        .filter((id) => known.has(id))
        .slice(0, pageBooks[work.template].max),
    }));
  const finished = (status: PosterDraft["status"]): PosterDraft => ({
    ...work,
    pages: shown(work.pages).map((entry) => ({
      ...entry,
      heading: entry.heading.trim(),
      text: entry.text.trim(),
    })),
    status,
  });
  const problem = posterProblem(finished("published"));
  const published = poster?.status === "published";

  const say = (words: string) =>
    setSaid((last) => ({ words, times: last.times + 1 }));
  function fail(what: keyof typeof FAILED) {
    setFailed(what);
    say(FAILED[what]);
  }

  function change(next: PosterWork, step: Undo | null = null) {
    keep(next, from);
    setUndo(step);
    setFailed(null);
  }
  const changePage = (patch: Partial<PosterPage>) =>
    change({
      ...work,
      pages: work.pages.map((entry, index) =>
        index === at ? { ...entry, ...patch } : entry,
      ),
    });
  // The template shows only the books it has room for. The rest stay with
  // the page and come back with a template that holds them.
  const chooseBooks = (bookIds: string[]) =>
    changePage({
      bookIds: [
        ...bookIds,
        ...page.bookIds.slice(limit.max).filter((id) => !bookIds.includes(id)),
      ].slice(0, POSTER_LIMITS.booksPerPage),
    });

  function chooseTemplate(template: PosterTemplate) {
    if (template !== work.template) change({ ...work, template });
  }

  function addPage() {
    if (work.pages.length >= POSTER_LIMITS.pages) return;
    change({ ...work, pages: [...work.pages, emptyPage()] });
    setPageIndex(work.pages.length);
    handTo.current = chosenTab;
  }

  function removePage() {
    if (work.pages.length < 2) return;
    const empty = !page.heading && !page.text && !page.bookIds.length;
    change(
      { ...work, pages: work.pages.filter((_, index) => index !== at) },
      empty ? null : { work, message: `${at + 1}ページ目を外しました。` },
    );
    setPageIndex(Math.max(0, at - 1));
    handTo.current = chosenTab;
  }

  function confirm(what: "reset" | "delete") {
    setConfirming(what);
    handTo.current = () => cancelButton.current;
  }
  function cancel() {
    const trigger = confirming === "delete" ? deleteButton : resetButton;
    setConfirming(null);
    handTo.current = () => trigger.current;
  }

  function save(status: PosterDraft["status"]) {
    if (status === "published" && problem) {
      setAsked(true);
      say(problem);
      // Show the page the message is about.
      const first = work.pages.findIndex(
        (_, index) =>
          posterProblem({
            ...finished("published"),
            pages: finished("published").pages.slice(0, index + 1),
          }) !== null,
      );
      if (first >= 0) setPageIndex(first);
      return;
    }
    const id = actions.savePoster(finished(status), poster?.id);
    if (!id) {
      // Nothing was kept, so the work stays here. A visitor is invited to
      // sign in instead.
      if (accountRequested() || refusedForSample()) setFailed(null);
      else fail("save");
      return;
    }
    clear();
    notify(
      status === "draft"
        ? "下書きに残しました。"
        : published
          ? "ポスターを直しました。"
          : "ポスターを貼り出しました。",
    );
    // The editor is done with: 戻る from the poster does not open it again.
    leavePageFor(posterPath(id), router);
  }

  function remove() {
    if (!poster) return;
    if (!actions.deletePoster(poster.id)) {
      if (!accountRequested() && !refusedForSample()) fail("delete");
      return;
    }
    clear();
    notify("ポスターを消しました。");
    leavePageFor(profilePath(ME_ID), router);
  }

  const preview = {
    template: work.template,
    theme: work.theme,
    font: work.font,
    pages: shown(work.pages),
  };
  return (
    <div className="poster-editor">
      <header className="poster-editor-head">
        <BackLink className="back-link" />
        <span className="eyebrow">MAKE A POSTER</span>
        <h1 className="page-title">
          {poster ? "ポスターを直す" : "ポスターを作る"}
        </h1>
        <p className="page-subtitle">
          表紙を選んで、ひとこと。プロフィールや作品ページ、タイムラインに貼り出せます。
        </p>
        {reviewNote && (
          <div
            className="spoiler-folded-note report-folded-note poster-editor-review"
            role="note"
          >
            <p>{reviewNoteWords("poster", reviewNote)}</p>
          </div>
        )}
        {elsewhere.length > 0 && (
          <section
            className="poster-editor-elsewhere"
            aria-labelledby={elsewhereId}
          >
            <h2 id={elsewhereId}>このブラウザに残している書きかけ</h2>
            <ul>
              {elsewhere.map((entry) => (
                <li key={entry.key}>
                  <span>{entry.name}</span>
                  <Link href={entry.href}>
                    つづきを書く
                    <span className="sr-only">（{entry.name}）</span>
                    <Icon name="arrow" size={13} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </header>
      <div className="poster-editor-layout">
        <section
          className={"poster-editor-preview" + (enlarged ? " is-large" : "")}
          aria-label="できあがりの見え方"
        >
          <div className="poster-editor-sheet">
            <PosterSheet
              poster={preview}
              books={state.books}
              page={at}
              linkBooks={false}
            />
          </div>
          <div className="poster-editor-pages">
            <div
              className="poster-page-tabs"
              role="group"
              aria-label="直すページ"
              ref={tabs}
            >
              {work.pages.map((_, index) => (
                <button
                  type="button"
                  key={index}
                  aria-pressed={index === at}
                  aria-label={`${index + 1}ページ目`}
                  onClick={() => setPageIndex(index)}
                >
                  {index + 1}
                </button>
              ))}
              {work.pages.length < POSTER_LIMITS.pages && (
                <button
                  type="button"
                  className="poster-page-add"
                  onClick={addPage}
                >
                  <Icon name="plus" size={14} />
                  ページを足す
                </button>
              )}
            </div>
            {work.pages.length > 1 && (
              <button
                type="button"
                className="poster-page-remove"
                onClick={removePage}
              >
                {at + 1}ページ目を外す
              </button>
            )}
            {work.pages.length >= POSTER_LIMITS.pages && (
              <small className="poster-editor-quiet">
                ページは{POSTER_LIMITS.pages}枚までです。
              </small>
            )}
            <button
              type="button"
              className="poster-preview-size"
              aria-pressed={enlarged}
              onClick={() => setEnlarged(!enlarged)}
            >
              <Icon name="eye" size={14} />
              {enlarged ? "小さく戻す" : "大きく見る"}
            </button>
          </div>
        </section>

        <form
          className="poster-editor-form"
          ref={form}
          // Enter in a text box never puts the poster up: only 貼り出す does.
          onSubmit={(event) => event.preventDefault()}
        >
          <div role="status">
            {undo && (
              <p className="poster-editor-undo">
                {undo.message}
                <button
                  type="button"
                  onClick={() => {
                    change(undo.work);
                    setPageIndex(Math.min(at, undo.work.pages.length - 1));
                    handTo.current = chosenTab;
                  }}
                >
                  元に戻す
                </button>
              </p>
            )}
          </div>

          <fieldset className="poster-step">
            <legend>
              <span className="poster-step-number">1</span>型を選ぶ
            </legend>
            <div className="poster-templates">
              {POSTER_TEMPLATES.map((template) => (
                <label
                  key={template}
                  className={"poster-template is-" + template}
                >
                  <input
                    type="radio"
                    name="poster-template"
                    value={template}
                    checked={work.template === template}
                    onChange={() => chooseTemplate(template)}
                  />
                  <TemplateSketch template={template} />
                  <b>{POSTER_TEMPLATE_WORDS[template].name}</b>
                  <small>{POSTER_TEMPLATE_WORDS[template].hint}</small>
                </label>
              ))}
            </div>
          </fieldset>

          {limit.max > 0 && (
            <BookChoice
              state={state}
              template={work.template}
              chosen={page.bookIds.slice(0, limit.max)}
              waiting={
                page.bookIds.slice(limit.max).filter((id) => known.has(id))
                  .length
              }
              onChange={chooseBooks}
              where={work.pages.length > 1 ? `${at + 1}ページ目に` : ""}
            />
          )}

          <Words
            template={work.template}
            page={page}
            where={work.pages.length > 1 ? `${at + 1}ページ目の` : ""}
            onChange={changePage}
            step={limit.max > 0 ? 3 : 2}
          />

          <fieldset className="poster-step">
            <legend>
              <span className="poster-step-number">
                {limit.max > 0 ? 4 : 3}
              </span>
              見た目
            </legend>
            <p className="poster-step-note">
              はじめから選んであります。このままでも貼り出せます。
            </p>
            <div className="poster-themes" role="radiogroup" aria-label="色">
              {POSTER_THEMES.map((theme) => {
                const look = POSTER_THEME_STYLES[theme];
                return (
                  <label key={theme} className="poster-theme">
                    <input
                      type="radio"
                      name="poster-theme"
                      value={theme}
                      checked={work.theme === theme}
                      onChange={() => change({ ...work, theme })}
                    />
                    <span
                      className="poster-swatch"
                      style={{
                        background: look.paper,
                        color: look.ink,
                        borderColor: look.accent,
                      }}
                      aria-hidden="true"
                    >
                      <i style={{ background: look.accent }} />本
                    </span>
                    {look.name}
                  </label>
                );
              })}
            </div>
            <div className="poster-fonts" role="radiogroup" aria-label="書体">
              {POSTER_FONTS.map((font) => (
                <label key={font} className={"poster-font is-" + font}>
                  <input
                    type="radio"
                    name="poster-font"
                    value={font}
                    checked={work.font === font}
                    onChange={() => change({ ...work, font })}
                  />
                  <span aria-hidden="true">本の街</span>
                  {POSTER_FONT_NAMES[font]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="poster-step">
            <legend>
              <span className="poster-step-number">
                {limit.max > 0 ? 5 : 4}
              </span>
              貼り出す前に
            </legend>
            <label className="poster-option">
              <input
                type="checkbox"
                checked={work.inTimeline}
                onChange={(event) =>
                  change({ ...work, inTimeline: event.target.checked })
                }
              />
              <span>
                タイムラインにも出す
                <small>
                  {/* A poster of words alone is on no book's page. */}
                  {work.template === "text"
                    ? "文字の投稿と並んで流れます。プロフィールには、いつも載ります。"
                    : "文字の投稿と並んで流れます。プロフィールと作品ページには、いつも載ります。"}
                </small>
              </span>
            </label>
            <label className="poster-option">
              <input
                type="checkbox"
                checked={work.spoiler}
                onChange={(event) =>
                  change({ ...work, spoiler: event.target.checked })
                }
              />
              <span>
                ネタバレを含む
                <small>
                  ポスター全体を隠して、「表示する」を押した人だけが見られます。
                </small>
              </span>
            </label>
          </fieldset>

          <div className="poster-editor-actions">
            <div className="poster-editor-buttons">
              <button
                type="button"
                className="button"
                onClick={() => save("published")}
              >
                {published ? "直して貼り出す" : "貼り出す"}
              </button>
              {!published && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => save("draft")}
                >
                  下書きに残す
                </button>
              )}
            </div>
            {/* Why a press did nothing, said each time, even in the same words. */}
            <p className="sr-only" role="alert">
              {said.times > 0 && <span key={said.times}>{said.words}</span>}
            </p>
            {problem && (
              <p
                className={"poster-editor-problem" + (asked ? " is-asked" : "")}
              >
                <Icon name="leaf" size={14} />
                <span>
                  {asked ? "" : "貼り出す前に："}
                  {problem}
                </span>
              </p>
            )}
            {failed === "save" && (
              <p className="poster-editor-problem is-asked">{FAILED.save}</p>
            )}
            {!saved ? (
              <p className="poster-editor-quiet" role="status">
                書きかけをこのブラウザに残せません。ページを閉じると失われます。
              </p>
            ) : (
              keptFresh && (
                <p className="poster-editor-quiet">
                  書きかけは、このブラウザに残しています。
                  {confirming === "reset" ? (
                    <span className="poster-editor-confirm">
                      書きかけを消しますか？
                      <button
                        type="button"
                        onClick={() => {
                          clear();
                          setUndo(null);
                          setPageIndex(0);
                          setConfirming(null);
                          // Back to the start, where the first step is.
                          handTo.current = () =>
                            form.current?.querySelector<HTMLElement>(
                              "input[name='poster-template']:checked",
                            );
                        }}
                      >
                        消す
                      </button>
                      <button type="button" ref={cancelButton} onClick={cancel}>
                        やめる
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="poster-editor-text-button"
                      ref={resetButton}
                      onClick={() => confirm("reset")}
                    >
                      {poster ? "直す前に戻す" : "最初からやり直す"}
                    </button>
                  )}
                </p>
              )
            )}
          </div>

          {poster && (
            <div className="poster-editor-delete">
              {confirming === "delete" ? (
                <div
                  className="delete-confirm"
                  role="group"
                  aria-label="ポスターを消す"
                >
                  <span>このポスターを消しますか？ 元には戻せません。</span>
                  <button type="button" className="button" onClick={remove}>
                    消す
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    ref={cancelButton}
                    onClick={cancel}
                  >
                    やめる
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="poster-editor-text-button"
                  ref={deleteButton}
                  onClick={() => confirm("delete")}
                >
                  このポスターを消す
                </button>
              )}
              {failed === "delete" && (
                <p className="poster-editor-problem is-asked">
                  {FAILED.delete}
                </p>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

/** A small drawing of each template's layout, never of a real cover. */
function TemplateSketch({ template }: { template: PosterTemplate }) {
  return (
    <span className={"poster-sketch is-" + template} aria-hidden="true">
      {template === "one_book" && <i className="sketch-cover" />}
      {template === "lineup" &&
        Array.from({ length: 6 }, (_, index) => (
          <i key={index} className="sketch-cover" />
        ))}
      <i className="sketch-heading" />
      <i className="sketch-line" />
      <i className="sketch-line" />
      {template === "text" && (
        <>
          <i className="sketch-line" />
          <i className="sketch-line" />
        </>
      )}
    </span>
  );
}

/**
 * Where a book of the viewer's own comes from, said in a word. The books on
 * their own shop's shelves come first.
 */
function ownBooks(state: TownState): { book: Book; from: string }[] {
  const reading = currentBookId(state);
  const shelved =
    state.ownShop?.shelves.flatMap((shelf) =>
      shelf.items.map((item) => item.bookId),
    ) ?? [];
  const sources: [string[], string][] = [
    [shelved, "本棚"],
    [reading ? [reading] : [], "読んでいる"],
    [state.finishedBooks, "読んだ"],
    [state.library, "登録した本"],
    [state.me.lifeNine, "人生の9冊"],
    [state.favorites, "好きな本"],
    [state.wishlist, "読みたい"],
  ];
  const seen = new Set<string>();
  const found: { book: Book; from: string }[] = [];
  for (const [ids, from] of sources)
    for (const id of [...ids].reverse()) {
      if (seen.has(id)) continue;
      const book = state.books.find((entry) => entry.id === id);
      if (!book) continue;
      seen.add(id);
      found.push({ book, from });
    }
  return found;
}

const OWN_SHOWN = 12;

function BookChoice({
  state,
  template,
  chosen,
  waiting,
  onChange,
  where,
}: {
  state: TownState;
  template: PosterTemplate;
  chosen: string[];
  /** Books chosen for a template with more room, kept out of sight. */
  waiting: number;
  onChange: (bookIds: string[]) => void;
  /** Which page, when there are several: "2ページ目に". */
  where: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [full, setFull] = useState(false);
  const { min, max } = pageBooks[template];
  const books = chosen
    .map((bookId) => state.books.find((book) => book.id === bookId))
    .filter((book): book is Book => Boolean(book));
  const own = ownBooks(state);
  // The reader's own books come first among equal matches.
  const results = useBookSearch(state.books, query, {
    own: own.map(({ book }) => book.id),
    limit: OWN_SHOWN,
  });
  const searching = query.trim() !== "";
  // Titles only close in spelling wait under their own quiet heading.
  const near = searching ? results.near.map(({ book }) => ({ book })) : [];
  // Before anything is typed, never a book another reader only typed in.
  const offered: { book: Book; from?: string }[] = searching
    ? results.found.map(({ book }) => ({ book }))
    : own.length
      ? all
        ? own
        : own.slice(0, OWN_SHOWN)
      : booksBeforeSearch(state)
          .slice(0, OWN_SHOWN)
          .map((book) => ({ book }));

  function toggle(bookId: string) {
    if (max === 1) {
      onChange(chosen[0] === bookId ? [] : [bookId]);
      return;
    }
    if (chosen.includes(bookId)) {
      onChange(chosen.filter((entry) => entry !== bookId));
      setFull(false);
    } else if (chosen.length >= max) setFull(true);
    else onChange([...chosen, bookId]);
  }
  function move(index: number, by: number) {
    const next = books.map((book) => book.id);
    const [book] = next.splice(index, 1);
    next.splice(index + by, 0, book);
    // A book the town is still loading keeps its place at the end.
    onChange([...next, ...chosen.filter((entry) => !next.includes(entry))]);
  }

  const offer = ({ book, from }: { book: Book; from?: string }) => {
    const place = chosen.indexOf(book.id);
    return (
      <li key={book.id}>
        <button
          type="button"
          aria-pressed={place >= 0}
          onClick={() => toggle(book.id)}
        >
          <BookJacket book={book} className="poster-offer-jacket" />
          <b>{book.title}</b>
          <small>
            {place >= 0 ? (
              <span className="poster-offer-on">
                <Icon name="check" size={11} />
                {max > 1 ? `${place + 1}番目に載せています` : "載せています"}
              </span>
            ) : (
              (from ?? book.author)
            )}
          </small>
        </button>
      </li>
    );
  };

  return (
    <fieldset className="poster-step">
      <legend>
        <span className="poster-step-number">2</span>本を選ぶ
      </legend>
      <p className="poster-step-note">
        {max === 1
          ? `${where}載せる本を1冊。`
          : books.length
            ? `${where}${books.length}冊を並べています。${max}冊まで並べられます。`
            : `${where}${min}冊から${max}冊まで、好きな数だけ並べられます。`}
      </p>
      {books.length > 0 && (
        <ol className={"poster-chosen" + (max === 1 ? " is-one" : "")}>
          {books.map((book, index) => (
            <li key={book.id}>
              <BookJacket book={book} className="poster-chosen-jacket" />
              <span className="poster-chosen-title">{book.title}</span>
              <span className="poster-chosen-tools">
                {max > 1 && (
                  <>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`${book.title}を前へ`}
                    >
                      <Icon name="back" size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === books.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`${book.title}を後ろへ`}
                    >
                      <Icon name="arrow" size={14} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => toggle(book.id)}
                  aria-label={`${book.title}を外す`}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {waiting > 0 && (
        <p className="poster-editor-quiet">
          ほかに選んでいた{waiting}冊は、「{POSTER_TEMPLATE_WORDS.lineup.name}
          」の型にすると、また並びます。
        </p>
      )}
      <p className="poster-cover-note">表紙はそのままの形で載ります。</p>
      <label className="picker-search poster-book-search" htmlFor={id}>
        <Icon name="search" size={15} />
        <span className="sr-only">ポスターに載せる本を探す</span>
        <input
          id={id}
          type="search"
          value={query}
          placeholder="題名・著者・ISBNで探す"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // The Enter that confirms a kana conversion is the keyboard's.
            if (!enterPressed(event)) return;
            // Enter never puts the poster up from here (the form does not
            // send it either); it takes a book only when it is surely the one
            // meant, as in every picker, and never takes one off.
            event.preventDefault();
            const sure = results.sure();
            if (!sure || chosen.includes(sure.id)) return;
            if (max > 1 && chosen.length >= max) {
              setFull(true);
              return;
            }
            toggle(sure.id);
            setQuery("");
          }}
        />
      </label>
      {(!searching || results.settled || offered.length > 0) && (
        <p className="picker-caption">
          {searching
            ? offered.length
              ? "街の本から"
              : near.length
                ? "ぴったり合う本はありませんでした。"
                : `「${query.trim()}」に合う本は見つかりませんでした。プロフィールの「本を登録」から追加できます。`
            : own.length
              ? "あなたの本から"
              : offered.length
                ? "街の本から（読んだ本や読みたい本を登録すると、ここに並びます）"
                : "題名や著者で、載せる本を探してください。"}
        </p>
      )}
      {full && chosen.length >= max && (
        <p className="poster-editor-quiet" role="status">
          1ページに並べられるのは{max}
          冊までです。「ページを足す」で、続きを次のページに並べられます。
        </p>
      )}
      {offered.length > 0 && (
        <ul className="poster-book-offer">{offered.map(offer)}</ul>
      )}
      {near.length > 0 && (
        <>
          <p className="search-near" id={id + "-near"}>
            {results.nearHeading}
          </p>
          <ul className="poster-book-offer" aria-labelledby={id + "-near"}>
            {near.map(offer)}
          </ul>
        </>
      )}
      {!searching && own.length > OWN_SHOWN && (
        <button
          type="button"
          className="poster-editor-text-button"
          onClick={() => setAll(!all)}
        >
          {all ? "少なく見る" : "あなたの本を、もっと見る"}
        </button>
      )}
    </fieldset>
  );
}

const length = (value: string) => [...value].length;
const cut = (value: string, limit: number) =>
  length(value) > limit ? [...value].slice(0, limit).join("") : value;

/** How much is left, said only as the limit comes near. */
function Remaining({ value, limit }: { value: string; limit: number }) {
  const left = limit - length(value);
  if (left > Math.max(8, Math.round(limit * 0.1))) return null;
  return (
    <small className="poster-remaining" aria-live="polite">
      {left > 0 ? `あと${left}字` : "ここまでです"}
    </small>
  );
}

const WORDS: Record<
  PosterTemplate,
  { heading: string; text: string; textLabel: string; long: number }
> = {
  one_book: {
    heading: "例：旅に出られない週末に",
    textLabel: "この本のこと",
    text: "どこが好きか、誰に読んでほしいか。ひとことでも。",
    long: 220,
  },
  lineup: {
    heading: "例：新幹線で一気読みした本",
    textLabel: "ひとこと",
    text: "並べた理由を、一行で。",
    long: 80,
  },
  text: {
    heading: "例：一冊を、何年もかけて読む",
    textLabel: "本文",
    text: "雑誌の1ページのように、自由に。",
    long: 600,
  },
};

function Words({
  template,
  page,
  where,
  onChange,
  step,
}: {
  template: PosterTemplate;
  page: PosterPage;
  where: string;
  onChange: (patch: Partial<PosterPage>) => void;
  step: number;
}) {
  const id = useId();
  const words = WORDS[template];
  return (
    <fieldset className="poster-step">
      <legend>
        <span className="poster-step-number">{step}</span>
        {where}言葉
      </legend>
      <div className="poster-field">
        <label htmlFor={id + "-heading"}>見出し</label>
        <input
          id={id + "-heading"}
          className="field"
          value={page.heading}
          placeholder={words.heading}
          onChange={(event) =>
            onChange({
              heading: cut(event.target.value, POSTER_LIMITS.heading),
            })
          }
        />
        <Remaining value={page.heading} limit={POSTER_LIMITS.heading} />
      </div>
      <div className="poster-field">
        <label htmlFor={id + "-text"}>{words.textLabel}</label>
        <textarea
          id={id + "-text"}
          className="field"
          rows={template === "lineup" ? 2 : 5}
          value={page.text}
          placeholder={words.text}
          onChange={(event) =>
            onChange({ text: cut(event.target.value, POSTER_LIMITS.text) })
          }
        />
        <Remaining value={page.text} limit={POSTER_LIMITS.text} />
        {length(page.text) > words.long && (
          <small className="poster-editor-quiet">
            ポスターに入りきらないときは、ポスターのページで続きを読めます。
          </small>
        )}
      </div>
    </fieldset>
  );
}
