"use client";

import { useId, useRef, useState } from "react";
import { focusField } from "../lib/coarse-pointer";
import { useKeptDraft } from "../lib/kept-draft";
import {
  AUTHOR_MAX_LENGTH,
  DEFAULT_SHELVES,
  MET_PLACES,
  READING_STATUSES,
  readRule,
  type LibraryShelf,
  type SmartRule,
} from "../lib/library";
import {
  libraryShelfDraftStore,
  NEW_SHELF,
  sameShelfWork,
  shelfLosesWords,
  type LibraryShelfWork,
} from "../lib/library-shelf-draft";
import { overSaved } from "../lib/shop-draft";
import {
  LIBRARY_SHELF_NAME_MAX_LENGTH,
  LIBRARY_SHELF_NOTE_MAX_LENGTH,
} from "../lib/types";
import { LIBRARY_SHELF } from "../lib/words";
import { CHOICE_NAMES, choicesFor, type Audience } from "../lib/visibility";
import {
  KeptDraftNote,
  useNotTakenWords,
  useOpenedWithWork,
} from "./KeptDraftNote";
import { Modal } from "./ui";
import "./records.css";
import "./visibility.css";

// Making a shelf of the reader's own in the library, or changing one: its
// name, a note on what it gathers, and, for one already made, whether it
// shows the books only wanted, and taking it away. A shelf being made is
// filled by hand (自分で入れる) or gathers the books that meet its
// conditions (条件で集める, スマート本棚), and stays the kind it was made.
// Who may see it is chosen here too, though nothing shows shelves to others
// yet (the owner, 2026-10-17「まだ見せない」), and the sheet says so. The
// words and conditions are kept in this browser while they are written
// (library-shelf-draft.ts); the library lets them go once the town has them
// saved.

/** What a shelf may be shown to: 自分だけ and 公開, as records offer them. */
const AUDIENCE_HINTS: Partial<Record<Audience, string>> = {
  private: "ほかの人には見えません",
  everyone: "本棚を見せる場所ができたら、だれでも見られます",
};

const statusName = (status: string) =>
  status === "none"
    ? "未設定"
    : (DEFAULT_SHELVES.find((shelf) => shelf.key === status)?.label ?? status);

/** A list of the rule with one value in or out; an empty list is no condition. */
function toggled<T>(list: readonly T[] | undefined, values: readonly T[]) {
  const on = values.every((value) => list?.includes(value));
  const next = on
    ? (list ?? []).filter((value) => !values.includes(value))
    : [...new Set([...(list ?? []), ...values])];
  return next.length ? next : undefined;
}

/** The rule with a field set, or taken out when it is empty. */
function withField<K extends keyof SmartRule>(
  rule: SmartRule,
  key: K,
  value: SmartRule[K] | undefined,
): SmartRule {
  const next = { ...rule };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

export function LibraryShelfSheet({
  shelf,
  handShelves,
  startAudience,
  draftKey,
  onClose,
  onSave,
  onPutAway,
}: {
  /** The shelf being changed; null while one is being made. */
  shelf: LibraryShelf | null;
  /** The reader's other shelves filled by hand, for 「ほかの棚」. */
  handShelves: readonly LibraryShelf[];
  /** Who may see a shelf being made, until the reader chooses: the starting choice. */
  startAudience: Audience;
  /** Where the words are kept (owner/new or owner/shelf id); null while the owner is not known. */
  draftKey: string | null;
  onClose: () => void;
  /** False when the town did not take it: the sheet stays open on the words. */
  onSave: (
    work: LibraryShelfWork,
    choices: { showWanted: boolean; audience: Audience },
  ) => boolean;
  onPutAway?: () => void;
}) {
  const id = useId();
  const kept = useKeptDraft(libraryShelfDraftStore, draftKey);
  const saved: LibraryShelfWork = shelf
    ? {
        name: shelf.name,
        note: shelf.note,
        rule: shelf.rule,
      }
    : NEW_SHELF;
  const work = overSaved(kept.draft, saved);
  const { name, note, rule } = work ?? saved;
  // A shelf made stays the kind it was made: only one being made chooses.
  const smart = shelf ? shelf.rule !== null : rule !== null;
  const continuing = useOpenedWithWork(kept.loaded, work !== null);
  const [showWanted, setShowWanted] = useState(shelf?.showWanted ?? true);
  const [audience, setAudience] = useState<Audience>(
    shelf?.audience ?? startAudience,
  );
  const [refused, setRefused] = useState(false);
  const notTaken = useNotTakenWords();
  const nameField = useRef<HTMLInputElement>(null);

  function change(patch: Partial<LibraryShelfWork>) {
    setRefused(false);
    const next = { ...(work ?? saved), ...patch };
    kept.set(sameShelfWork(next, saved) ? null : { work: next, base: saved });
  }
  const changeRule = (next: SmartRule) => change({ rule: next });

  // The author typed for the rule: a condition, not a book's name.
  const { author: typedAuthor = "" } = rule ?? {};
  const conditions = smart ? readRule(rule ?? {}) : null;
  const backwards = !!rule?.since && !!rule.until && rule.since > rule.until;
  const ready = !!name.trim() && (!smart || conditions !== null);
  const ownedChoices = [
    { value: "yes", label: "持っている" },
    { value: "no", label: "持ってない" },
  ] as const;

  return (
    <Modal title={shelf ? LIBRARY_SHELF.edit : LIBRARY_SHELF.make} onClose={onClose}>
      <form
        className="library-shelf-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const next: LibraryShelfWork = {
            name: name.trim(),
            note: note.trim(),
            rule: smart ? conditions : null,
          };
          if (
            shelf &&
            sameShelfWork(next, saved) &&
            showWanted === shelf.showWanted &&
            audience === shelf.audience
          )
            return onClose();
          if (!onSave(next, { showWanted, audience })) setRefused(true);
        }}
      >
        <KeptDraftNote
          work={work !== null}
          continuing={continuing}
          saved={kept.saved}
          wordsLost={work !== null && shelfLosesWords(work, saved)}
          onDiscard={() => {
            kept.clear();
            setRefused(false);
            focusField(nameField.current);
          }}
        />
        {!shelf && (
          <fieldset className="record-visibility library-shelf-kind">
            <legend>棚の作り方</legend>
            <label>
              <input
                type="radio"
                name={id + "-kind"}
                checked={!smart}
                onChange={() => change({ rule: null })}
              />
              <span>
                自分で入れる
                <small>ライブラリの本から選んで入れます</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name={id + "-kind"}
                checked={smart}
                onChange={() => changeRule(rule ?? {})}
              />
              <span>
                条件で集める
                <small>条件に合う本が、ひとりでに並びます</small>
              </span>
            </label>
          </fieldset>
        )}
        {!shelf && !smart && (
          <p className="library-note">
            1冊の本を、いくつの棚に入れてもかまいません。読了や積読の分け方はそのまま残ります。
          </p>
        )}
        <label className="form-label" htmlFor={id + "-name"}>
          棚の名前
          <input
            id={id + "-name"}
            ref={nameField}
            className="field"
            required
            maxLength={LIBRARY_SHELF_NAME_MAX_LENGTH}
            placeholder={smart ? "例：今年読んだ本" : "例：雨の日に読みたい"}
            value={name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <label className="form-label" htmlFor={id + "-note"}>
          どんな棚か（なくてもかまいません）
          <textarea
            id={id + "-note"}
            className="field"
            rows={3}
            maxLength={LIBRARY_SHELF_NOTE_MAX_LENGTH}
            value={note}
            onChange={(event) => change({ note: event.target.value })}
          />
        </label>
        {smart && (
          <section className="library-rule" aria-label="集める条件">
            <h3>集める条件</h3>
            <p className="library-rule-note">
              選んだ条件のすべてに合う本が並びます。同じ条件の中は、どれか1つに合えば並びます。
            </p>
            <div
              className="library-rule-group"
              role="group"
              aria-label="読書の状態"
            >
              <span>読書の状態</span>
              <div className="library-rule-chips">
                {[...READING_STATUSES, "none" as const].map((status) => (
                  <button
                    type="button"
                    key={status}
                    className="chip"
                    aria-pressed={!!rule?.status?.includes(status)}
                    onClick={() =>
                      changeRule(
                        withField(
                          rule ?? {},
                          "status",
                          toggled(rule?.status, [status]),
                        ),
                      )
                    }
                  >
                    {statusName(status)}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="library-rule-group"
              role="group"
              aria-label="持っているか"
            >
              <span>持っているか</span>
              <div className="library-rule-chips">
                {ownedChoices.map((choice) => (
                  <button
                    type="button"
                    key={choice.value}
                    className="chip"
                    aria-pressed={rule?.owned === choice.value}
                    onClick={() =>
                      changeRule(
                        withField(
                          rule ?? {},
                          "owned",
                          rule?.owned === choice.value
                            ? undefined
                            : choice.value,
                        ),
                      )
                    }
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="library-rule-group"
              role="group"
              aria-label="出会った場所"
            >
              <span>出会った場所</span>
              <div className="library-rule-chips">
                {MET_PLACES.map((place) => (
                  <button
                    type="button"
                    key={place.key}
                    className="chip"
                    aria-pressed={place.sources.every((source) =>
                      rule?.met?.includes(source),
                    )}
                    onClick={() =>
                      changeRule(
                        withField(
                          rule ?? {},
                          "met",
                          toggled(rule?.met, place.sources),
                        ),
                      )
                    }
                  >
                    {place.label}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="library-rule-group"
              role="group"
              aria-label="加えた時期"
            >
              <span>ライブラリに加えた時期</span>
              <div className="library-rule-months">
                <label>
                  <input
                    type="month"
                    className="field"
                    aria-label="この月から"
                    value={rule?.since ?? ""}
                    onChange={(event) =>
                      changeRule(
                        withField(rule ?? {}, "since", event.target.value),
                      )
                    }
                  />
                  から
                </label>
                <label>
                  <input
                    type="month"
                    className="field"
                    aria-label="この月まで"
                    value={rule?.until ?? ""}
                    onChange={(event) =>
                      changeRule(
                        withField(rule ?? {}, "until", event.target.value),
                      )
                    }
                  />
                  まで
                </label>
              </div>
              {backwards && (
                <p className="library-rule-note" role="alert">
                  「から」の月を、「まで」の月より前にしてください。
                </p>
              )}
            </div>
            <label className="form-label" htmlFor={id + "-author"}>
              著者（名前の一部でもかまいません）
              <input
                id={id + "-author"}
                className="field"
                maxLength={AUTHOR_MAX_LENGTH}
                placeholder="例：村上春樹"
                value={typedAuthor}
                onChange={(event) =>
                  changeRule(
                    withField(
                      rule ?? {},
                      "author",
                      // Spaces alone are no author.
                      event.target.value.trim()
                        ? event.target.value
                        : undefined,
                    ),
                  )
                }
              />
            </label>
            {handShelves.length > 0 && (
              <div
                className="library-rule-group"
                role="group"
                aria-label="ほかの棚"
              >
                <span>ほかの棚にも入っている本</span>
                <div className="library-rule-chips">
                  {handShelves.map((other) => (
                    <button
                      type="button"
                      key={other.id}
                      className="chip"
                      aria-pressed={!!rule?.with?.includes(other.id)}
                      onClick={() =>
                        changeRule(
                          withField(
                            rule ?? {},
                            "with",
                            toggled(rule?.with, [other.id]),
                          ),
                        )
                      }
                    >
                      {other.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {conditions === null && !backwards && (
              <p className="library-rule-note">条件を1つ以上選んでください。</p>
            )}
          </section>
        )}
        {shelf && (
          <label className="library-shelf-check">
            <input
              type="checkbox"
              checked={showWanted}
              onChange={(event) => {
                setRefused(false);
                setShowWanted(event.target.checked);
              }}
            />
            まだ読んでいない「読みたい」だけの本も並べる
          </label>
        )}
        <fieldset className="record-visibility visibility-choices">
          <legend>見せる範囲</legend>
          {choicesFor("shelves").map((choice) => {
            const value = choice as Audience;
            return (
              <label key={choice}>
                <input
                  type="radio"
                  name={id + "-audience"}
                  checked={audience === value}
                  onChange={() => {
                    setRefused(false);
                    setAudience(value);
                  }}
                />
                <span>
                  {CHOICE_NAMES[choice]}
                  <small>{AUDIENCE_HINTS[value]}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
        <p className="library-note">
          今はまだ、ほかの読書家に本棚を見せる場所はありません。
        </p>
        {refused && (
          <p className="library-note" role="alert">
            {notTaken}
          </p>
        )}
        <div className="btns">
          <button type="submit" className="btn fill" disabled={!ready}>
            {shelf ? "保存する" : "作る"}
          </button>
          {shelf && onPutAway && (
            <button type="button" className="btn quiet" onClick={onPutAway}>
              この棚を消す
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/**
 * Who may see one of the shelves every library has (読了, 積読, …): its own
 * small sheet, as those shelves have nothing else to change.
 */
export function DefaultShelfAudienceSheet({
  label,
  audience,
  onClose,
  onChoose,
}: {
  label: string;
  audience: Audience;
  onClose: () => void;
  onChoose: (audience: Audience) => void;
}) {
  const id = useId();
  return (
    <Modal title={`「${label}」の見せる範囲`} onClose={onClose}>
      <fieldset className="record-visibility visibility-choices">
        <legend>見せる範囲</legend>
        {choicesFor("shelves").map((choice) => {
          const value = choice as Audience;
          return (
            <label key={choice}>
              <input
                type="radio"
                name={id + "-audience"}
                checked={audience === value}
                onChange={() => onChoose(value)}
              />
              <span>
                {CHOICE_NAMES[choice]}
                <small>{AUDIENCE_HINTS[value]}</small>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="library-note">
        今はまだ、ほかの読書家に本棚を見せる場所はありません。
      </p>
    </Modal>
  );
}
