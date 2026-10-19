"use client";

import { SCAN_COPY } from "../lib/scan";
import { Icon, Modal } from "./ui";

// 続きから再開 (Figma v4's 09): the time left without ［完了］, offered as
// the scanner opens. Nothing is read meanwhile; 今はしない, 戻る and Escape
// start a new time.

const COPY = SCAN_COPY.resume;

export function ScanResume({
  count,
  onResume,
  onNotNow,
}: {
  /** What that time came to (N冊 登録済み …). */
  count: string;
  onResume: () => void;
  onNotNow: () => void;
}) {
  return (
    <Modal title={COPY.name} onClose={onNotNow}>
      <div className="scan-resume">
        <span className="scan-done-mark" aria-hidden="true">
          <Icon name="again" size={28} />
        </span>
        <p className="scan-resume-count">{count}</p>
        <p className="scan-resume-note">{COPY.kept}</p>
        <button type="button" className="btn fill" onClick={onResume}>
          {COPY.go}
        </button>
        <button type="button" className="text-btn" onClick={onNotNow}>
          {COPY.notNow}
        </button>
      </div>
    </Modal>
  );
}
