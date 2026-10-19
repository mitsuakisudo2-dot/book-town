"use client";

import { useState } from "react";
import type { ScanSort } from "../lib/library-journal";
import type { LibraryShelf, ReadingStatus } from "../lib/library";
import { SCAN_COPY } from "../lib/scan";
import { Modal } from "./ui";

// 連続設定 (資料 3章, Figma v4's 02): what the next books read are given as
// they come in. As in the library (applySet), 積読 turns 持っている on, and
// 持っている turned off after leaves 積読 as it is (けにーさん 2026-10-18).

const COPY = SCAN_COPY.sort;

export function ScanSortSheet({
  sort,
  statuses,
  shelves,
  onSet,
  onClose,
}: {
  /** The setting now, or null for none. */
  sort: ScanSort | null;
  statuses: { status: ReadingStatus; label: string }[];
  /** The shelves the reader fills by hand. */
  shelves: LibraryShelf[];
  onSet: (sort: ScanSort) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ReadingStatus | null>(
    sort?.status ?? null,
  );
  // 持っている starts on (資料 3章, けにーさん 2026-10-18).
  const [owned, setOwned] = useState(sort?.owned !== "no");
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(sort?.shelves ?? []),
  );
  const live = new Set(shelves.map((shelf) => shelf.id));

  return (
    <Modal title={COPY.name} onClose={onClose} fromBottom>
      <div className="scan-sort-sheet">
        <p className="scan-sort-lead">{COPY.lead}</p>
        <section>
          <h3 id="scan-sort-status">{COPY.status}</h3>
          <div
            className="scan-sort-statuses"
            role="radiogroup"
            aria-labelledby="scan-sort-status"
          >
            {[...statuses, { status: null, label: COPY.none }].map((choice) => (
              <button
                key={choice.status ?? "none"}
                type="button"
                role="radio"
                className="chip"
                aria-checked={status === choice.status}
                onClick={() => {
                  setStatus(choice.status);
                  if (choice.status === "tsundoku") setOwned(true);
                }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </section>
        <label className="scan-sort-owned">
          <span>
            <strong>{COPY.owned}</strong>
            <small>{COPY.ownedOff}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="scan-switch"
            checked={owned}
            onChange={(event) => setOwned(event.target.checked)}
          />
        </label>
        <fieldset className="scan-sort-shelves">
          <legend>
            {COPY.shelves}
            {shelves.length > 1 && <small>{COPY.several}</small>}
          </legend>
          {shelves.length ? (
            shelves.map((shelf) => (
              <label key={shelf.id} className="scan-sort-shelf">
                <input
                  type="checkbox"
                  checked={picked.has(shelf.id)}
                  onChange={(event) =>
                    setPicked((was) => {
                      const next = new Set(was);
                      if (event.target.checked) next.add(shelf.id);
                      else next.delete(shelf.id);
                      return next;
                    })
                  }
                />
                <span>{shelf.name}</span>
              </label>
            ))
          ) : (
            <p className="scan-item-none">{SCAN_COPY.noShelves}</p>
          )}
        </fieldset>
        <button
          type="button"
          className="btn fill scan-sort-go"
          onClick={() =>
            onSet({
              status,
              owned: owned ? "yes" : "no",
              shelves: [...picked].filter((id) => live.has(id)),
            })
          }
        >
          {COPY.go}
        </button>
        <p className="scan-sort-foot">{COPY.anytime}</p>
      </div>
    </Modal>
  );
}
