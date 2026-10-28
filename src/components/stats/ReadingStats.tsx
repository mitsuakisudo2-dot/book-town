"use client";

// 読書の統計 (管理表 19, 刷新版): under 読書をはじめる, the period band
// (日・週・月・年・ぜんぶ, ‹ ›), 見る本, and the reader's cards as they arranged
// them (reader_settings.stats_layout, else the first twelve). A half or wide
// card answers one question; pressed, the whole of it rises from below. The
// period and 見る本 live in the address (url-state.ts).

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { TownState } from "../../lib/types";
import {
  BOOK_KINDS,
  kindOf,
  layoutOf,
  onlyBooks,
  periodAt,
  PERIOD_KINDS,
  readingSpeed,
  statsData,
  type BookKind,
  type PeriodKind,
  type StatCard,
  type StatsLayout,
} from "../../lib/reading-stats";
import { useBookFacts } from "../../lib/reading-stats/facts-session";
import {
  PERIOD_NAMES,
  periodTitle,
  STATS_WORDS as W,
} from "../../lib/reading-stats/words";
import { useUrlParam } from "../../lib/url-state";
import { Icon, Modal } from "../ui";
import { CardFull, cardTitle, type StatsView } from "./StatCards";
import { StatsBoard } from "./StatsBoard";
import { useSheetPull } from "./useSheetPull";
import "./reading-stats.css";

type BandKind = Exclude<PeriodKind, "custom">;
const BAND: BandKind[] = PERIOD_KINDS.filter(
  (kind): kind is BandKind => kind !== "custom",
);

/** The device's zone: the period's days are the reader's own. */
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function ReadingStats({
  state,
  now,
  onArrange,
}: {
  state: TownState;
  now: number;
  /** Keeps the reader's arrangement (actions.setStatsLayout). */
  onArrange: (layout: StatsLayout) => void;
}) {
  const [kindParam, setKind] = useUrlParam("span");
  const [stepParam, setStep] = useUrlParam("at");
  const [kindsParam, setKinds] = useUrlParam("kind");
  const kind: BandKind = BAND.includes(kindParam as BandKind)
    ? (kindParam as BandKind)
    : "year";
  const step = Math.min(0, Math.trunc(Number(stepParam) || 0));
  const kept = BOOK_KINDS.find((entry) => entry.kind === kindsParam)?.kind ?? null;
  const [open, setOpen] = useState<StatCard | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const ids = useMemo(
    () => [
      ...Object.keys(state.libraryEntries),
      ...state.readingSessions.flatMap((session) =>
        session.bookId ? [session.bookId] : [],
      ),
    ],
    [state.libraryEntries, state.readingSessions],
  );
  const facts = useBookFacts(state.books, ids);
  // Counted again when the records or the facts change, not on every tick.
  const minute = Math.floor(now / 60_000);
  const all = useMemo(
    () => statsData(state, minute * 60_000, deviceZone(), facts),
    [state, minute, facts],
  );
  const data = useMemo(
    () =>
      kept
        ? onlyBooks(all, (bookId) => kindOf(facts(bookId)?.genre ?? null) === kept)
        : all,
    [all, kept, facts],
  );
  const kinds = useMemo(
    () =>
      BOOK_KINDS.filter((entry) =>
        all.library.some(
          (row) => kindOf(facts(row.bookId)?.genre ?? null) === entry.kind,
        ),
      ),
    [all, facts],
  );
  const period = periodAt(kind, all.today, step, all.first ?? all.today);
  const view: StatsView = {
    state,
    data,
    period,
    speed: readingSpeed(data, period),
    now,
  };

  return (
    <section className="stats" aria-label="読書の統計">
      <div className="stats-band-bar">
        <div className="stats-periods" role="group" aria-label="期間">
          {BAND.map((one) => (
            <button
              key={one}
              type="button"
              aria-pressed={one === kind}
              onClick={() => {
                setKind(one === "year" ? null : one);
                setStep(null);
              }}
            >
              {PERIOD_NAMES[one]}
            </button>
          ))}
        </div>
        <div className="stats-period-step">
          <button
            type="button"
            aria-label="前へ"
            disabled={kind === "all" || all.first === null || period.from <= all.first}
            onClick={() => setStep(String(step - 1))}
          >
            <Icon name="back" size={18} />
          </button>
          <h2>{periodTitle(period)}</h2>
          <button
            type="button"
            aria-label="次へ"
            disabled={step >= 0}
            onClick={() => setStep(step + 1 >= 0 ? null : String(step + 1))}
          >
            <Icon name="chevron" size={18} />
          </button>
        </div>
        {kinds.length > 1 && (
          <label className="stats-kinds">
            <span>{W.kindsLabel}</span>
            <select
              value={kept ?? ""}
              onChange={(event) => setKinds(event.target.value || null)}
            >
              <option value="">{W.kindsAll}</option>
              {kinds.map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {entry.kind}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <StatsBoard
        tiles={layoutOf(state.settings.statsLayout)}
        view={view}
        onKeep={onArrange}
        onOpen={setOpen}
      />
      {open && (
        <Modal title={cardTitle(open, view)} onClose={close} fromBottom>
          <Sheet onClose={close}>
            <CardFull card={open} view={view} />
          </Sheet>
        </Modal>
      )}
    </section>
  );
}

/** A card in full, in the sheet from below; pulled down, it closes. */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSheetPull(ref, onClose);
  return (
    <div className="stats-sheet" ref={ref}>
      {children}
    </div>
  );
}

export type { BookKind };
