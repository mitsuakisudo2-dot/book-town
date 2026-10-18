"use client";

import { useEffect, useState, type RefObject } from "react";
import { japanFormat } from "../lib/japan-time";
import {
  GAPS,
  nextOf,
  readLine,
  SIZES,
  summarize,
  TIMING_COPY,
  timingReport,
  type Timing,
  type TimingSettings,
} from "../lib/scan-timing";
import type { Notify } from "../lib/types";

const RECORDED_AT = japanFormat({
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The scanner's timing panel (scan-timing.ts), under the camera: a frame's
 * read, the books so far and the last book's times, the two settings to try,
 * and ［記録を写す］. It reads the scanner's record twice a second, so the
 * scanner itself never renders for a frame.
 */
export function ScanTiming({
  timing,
  settings,
  onSettings,
  reader,
  video,
  notify,
}: {
  timing: RefObject<Timing>;
  settings: TimingSettings;
  onSettings: (settings: TimingSettings) => void;
  /** The reader in use: native or wasm, once the camera reads. */
  reader: RefObject<string>;
  video: RefObject<HTMLVideoElement | null>;
  notify: Notify;
}) {
  const [now, setNow] = useState<Timing>(() => timing.current);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(timing.current), 500);
    return () => clearInterval(timer);
  }, [timing]);
  const sum = summarize(now);
  const last = now.reads.length - 1;

  function copy() {
    const element = video.current;
    const report = timingReport(timing.current, {
      reader: reader.current || "-",
      picture: element?.videoWidth
        ? `${element.videoWidth}×${element.videoHeight}`
        : "-",
      settings,
      userAgent: navigator.userAgent,
      when: RECORDED_AT.format(new Date()),
    });
    const showInstead = () => setShown(report);
    try {
      void navigator.clipboard.writeText(report).then(() => {
        setShown(null);
        notify(TIMING_COPY.copied);
      }, showInstead);
    } catch {
      showInstead();
    }
  }

  return (
    <section className="scan-timing" aria-label={TIMING_COPY.name}>
      <p>
        {sum.frameMs === null
          ? TIMING_COPY.waiting
          : TIMING_COPY.frame(sum.frameMs, sum.perSecond)}
      </p>
      {last >= 0 && <p>{readLine(now, last)}</p>}
      {sum.firstToLast !== null && (
        <p>{TIMING_COPY.total(sum.books, sum.firstToLast)}</p>
      )}
      <div className="scan-timing-buttons">
        <button
          type="button"
          className="btn"
          onClick={() =>
            onSettings({ ...settings, gap: nextOf(GAPS, settings.gap) })
          }
        >
          {TIMING_COPY.gap(settings.gap)}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            onSettings({ ...settings, size: nextOf(SIZES, settings.size) })
          }
        >
          {TIMING_COPY.size(settings.size)}
        </button>
        <button type="button" className="btn" onClick={copy}>
          {TIMING_COPY.copy}
        </button>
      </div>
      {shown && (
        <>
          <p>{TIMING_COPY.copyHere}</p>
          <textarea
            className="field scan-timing-record"
            readOnly
            value={shown}
            aria-label={TIMING_COPY.copy}
          />
        </>
      )}
    </section>
  );
}
