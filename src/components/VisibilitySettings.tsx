"use client";
import { useState } from "react";
import {
  ME_ID,
  type Notify,
  type TownActions,
  type TownState,
} from "../lib/types";
import {
  CHOICE_NAMES,
  choiceOf,
  choicesFor,
  isNarrowing,
  visibilityOf,
  type Choice,
  type VisibilityKind,
} from "../lib/visibility";

/**
 * The kinds shown in 設定 now. Only reading records reach others today; the
 * others join with their screens, and their starting choices already stand
 * (src/lib/visibility.ts DEFAULT_VISIBILITIES).
 */
export const SHOWN_KINDS: VisibilityKind[] = ["records"];

const KIND_WORDS: Record<VisibilityKind, { label: string; things: string }> = {
  records: { label: "読み終えた本の記録", things: "記録" },
  status: { label: "読書の状態（読みたい・読書中・読了）", things: "本" },
  shelves: { label: "本棚", things: "本棚" },
  stats: { label: "読書の統計", things: "統計" },
  likes: { label: "いいねした感想", things: "いいね" },
  saves: { label: "保存した POP とポスター", things: "保存" },
  encounters: { label: "本との出会い", things: "出会い" },
};

const CHOICE_HINTS: Record<Choice, string> = {
  everyone: "だれでも見られます",
  followers: "フォローしている人だけ",
  count: "人数に数えます。名前は出ません",
  private: "ほかの人には見えません",
};

/**
 * The question in sight as it comes, 設定 being long on a phone, and read
 * out: the focus goes to it.
 */
const showQuestion = (title: HTMLParagraphElement | null) => {
  title?.scrollIntoView({ block: "nearest" });
  title?.focus({ preventScroll: true });
};

/** How many of the reader's own things would widen with the past. */
function pastAt(state: TownState, kind: VisibilityKind): number {
  if (kind !== "records") return 0;
  const was = state.settings.visibility.records.audience;
  return state.readingRecords.filter(
    (record) => record.readerId === ME_ID && record.audience === was,
  ).length;
}

/**
 * 見せる範囲 in 設定: each kind's starting choice. A narrower one is taken
 * at once, the reader's earlier things with it (said in the toast); a wider
 * one asks, under the choices, whether the earlier ones widen too
 * (「これまでの分も広げますか？」), and only when there are some. Until it
 * is answered nothing changes.
 */
export function VisibilitySettings({
  state,
  actions,
  notify,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
}) {
  const [asking, setAsking] = useState<{
    kind: VisibilityKind;
    choice: Choice;
  } | null>(null);
  // Where the focus goes back to once the question is answered: the choice
  // now taken, not the page, the button pressed having gone.
  const backToChoice = (kind: VisibilityKind) =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>(
          `input[name="visibility-${kind}"]:checked`,
        )
        ?.focus(),
    );

  function choose(kind: VisibilityKind, choice: Choice) {
    const before = state.settings.visibility[kind];
    const next = visibilityOf(choice);
    const { label, things } = KIND_WORDS[kind];
    const name = CHOICE_NAMES[choice];
    if (isNarrowing(before, next)) {
      actions.setVisibility(kind, choice);
      notify(`${label}を${name}にしました。今までの${things}も${name}です`);
    } else if (pastAt(state, kind) > 0) setAsking({ kind, choice });
    else {
      actions.setVisibility(kind, choice);
      notify(`これからの${label}は${name}になります`);
    }
  }

  function answer(past: boolean) {
    if (!asking) return;
    const { kind, choice } = asking;
    const { label, things } = KIND_WORDS[kind];
    const name = CHOICE_NAMES[choice];
    setAsking(null);
    actions.setVisibility(kind, choice, past);
    backToChoice(kind);
    notify(
      past
        ? `今までの${things}も${name}にしました`
        : `これからの${label}は${name}になります。今までの${things}はそのままです`,
    );
  }

  return (
    <>
      {SHOWN_KINDS.map((kind) => {
        const current = choiceOf(state.settings.visibility[kind]);
        const words = KIND_WORDS[kind];
        const asked = asking?.kind === kind ? asking.choice : null;
        return (
          <fieldset key={kind} className="record-visibility visibility-choices">
            <legend>{words.label}</legend>
            {choicesFor(kind).map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name={`visibility-${kind}`}
                  checked={(asked ?? current) === choice}
                  onChange={() => choose(kind, choice)}
                />
                <span>
                  {CHOICE_NAMES[choice]}
                  <small>{CHOICE_HINTS[choice]}</small>
                </span>
              </label>
            ))}
            {asked ? (
              // Asked here, in 設定 itself: a dialog over 設定 would be a
              // second layer for one question.
              <div
                className="visibility-question"
                role="group"
                aria-label={`今までの${words.things}も${CHOICE_NAMES[asked]}にするか`}
              >
                <p
                  className="visibility-question-title"
                  tabIndex={-1}
                  ref={showQuestion}
                >
                  今までの{words.things}も{CHOICE_NAMES[asked]}にしますか？
                </p>
                <p className="visibility-question-words">
                  これからの{words.label}は{CHOICE_NAMES[asked]}
                  になります。今までの分も、と答えると、今
                  {CHOICE_NAMES[current]}の{words.things}がすべて
                  {CHOICE_NAMES[asked]}になります。
                </p>
                <div className="btns">
                  <button
                    type="button"
                    className="btn fill"
                    onClick={() => answer(true)}
                  >
                    今までの{words.things}も{CHOICE_NAMES[asked]}にする
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => answer(false)}
                  >
                    これからの{words.things}だけ
                  </button>
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => {
                      setAsking(null);
                      backToChoice(kind);
                    }}
                  >
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <p className="palette-note">
                狭めると、今までの{words.things}
                もすぐ狭まります。1つずつ変えることもできます。
              </p>
            )}
          </fieldset>
        );
      })}
    </>
  );
}
