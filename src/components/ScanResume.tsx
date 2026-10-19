"use client";

import { useState } from "react";
import { SCAN_COPY } from "../lib/scan";
import { Icon, Modal } from "./ui";

// 続きから再開 (Figma v4's 09): the time left without ［完了］, offered as
// the scanner opens. Nothing is read meanwhile; 今はしない, 戻る and Escape
// start a new time. Its 連続設定 is shown, and comes back only when pressed
// (資料 3章: a resume must not class the next books unawares).

const COPY = SCAN_COPY.resume;

export function ScanResume({
  count,
  sort,
  onResume,
  onNotNow,
}: {
  /** What that time came to (N冊 登録済み …). */
  count: string;
  /** Its 連続設定 when it was left, in a few words; null for none. */
  sort: string[] | null;
  onResume: (withSort: boolean) => void;
  onNotNow: () => void;
}) {
  const [withSort, setWithSort] = useState(false);
  return (
    <Modal title={COPY.name} onClose={onNotNow}>
      <div className="scan-resume">
        <span className="scan-done-mark" aria-hidden="true">
          <Icon name="again" size={28} />
        </span>
        <p className="scan-resume-count">{count}</p>
        <p className="scan-resume-note">{COPY.kept}</p>
        {sort && (
          <div className="scan-resume-sort">
            <p>
              <span className="scan-resume-sort-name">{COPY.sort}</span>
              {sort.map((word) => (
                <span key={word} className="scan-sort-tag">
                  {word}
                </span>
              ))}
            </p>
            <button
              type="button"
              className="chip"
              aria-pressed={withSort}
              onClick={() => setWithSort((was) => !was)}
            >
              {withSort && <Icon name="check" size={16} />}
              {COPY.sortBack}
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn fill"
          onClick={() => onResume(withSort)}
        >
          {COPY.go}
        </button>
        <button type="button" className="text-btn" onClick={onNotNow}>
          {COPY.notNow}
        </button>
      </div>
    </Modal>
  );
}
