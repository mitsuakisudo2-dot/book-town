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
import { Modal } from "./ui";

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
 * one asks once whether the earlier ones widen too
 * (「これまでの分も広げますか？」), and only when there are some.
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
        return (
          <fieldset key={kind} className="record-visibility visibility-choices">
            <legend>{KIND_WORDS[kind].label}</legend>
            {choicesFor(kind).map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name={`visibility-${kind}`}
                  checked={current === choice}
                  onChange={() => choose(kind, choice)}
                />
                <span>
                  {CHOICE_NAMES[choice]}
                  <small>{CHOICE_HINTS[choice]}</small>
                </span>
              </label>
            ))}
            <p className="palette-note">
              狭めると、今までの{KIND_WORDS[kind].things}
              もすぐ狭まります。1つずつ変えることもできます。
            </p>
          </fieldset>
        );
      })}
      {asking && (
        <Modal title="見せる範囲" onClose={() => setAsking(null)}>
          <div
            className="visibility-question"
            role="group"
            aria-label="今までの分も広げるか"
          >
            <p className="visibility-question-title">
              今までの{KIND_WORDS[asking.kind].things}も
              {CHOICE_NAMES[asking.choice]}にしますか？
            </p>
            <p className="visibility-question-words">
              これからの{KIND_WORDS[asking.kind].label}は
              {CHOICE_NAMES[asking.choice]}になります。1つずつ別の範囲にした
              {KIND_WORDS[asking.kind].things}は、そのままです。
            </p>
            <div className="btns">
              <button
                type="button"
                className="btn fill"
                onClick={() => answer(true)}
              >
                今までの{KIND_WORDS[asking.kind].things}も
                {CHOICE_NAMES[asking.choice]}にする
              </button>
              {/* The narrower answer waits under the finger. */}
              <button
                type="button"
                className="btn quiet"
                autoFocus
                onClick={() => answer(false)}
              >
                これからの{KIND_WORDS[asking.kind].things}だけ
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
