"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  playTone,
  setSoundOn,
  useToneChoice,
  wakeAudio,
  type Moment,
} from "./scan-tones";

// What the continuous scanner (ScanSession.tsx) asks of this device: the
// network, the sound and vibration of a read, the screen kept on while the
// camera reads, and コンパクト表示. The sound's ♪ and コンパクト表示 are
// remembered on this device (localStorage), not by the account.

const subscribeOnline = (changed: () => void) => {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
};
export const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );

const COMPACT_KEY = "book-town-scan-compact";

/**
 * コンパクト表示 (資料 4章, by the reader's choice only): each book of the
 * library on one line, its title and 読了・積読・読書中, so that more of
 * them are in sight. This device remembers it. A book that waits for the
 * reader stays as it was.
 */
export function useCompact() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(COMPACT_KEY) === "on";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOn((was) => {
      try {
        if (was) localStorage.removeItem(COMPACT_KEY);
        else localStorage.setItem(COMPACT_KEY, "on");
      } catch {
        // Not remembered: this time only.
      }
      return !was;
    });
  return [on, toggle] as const;
}
/**
 * The tone chosen in 設定 (scan-tones.ts) when a book is taken in, two lower
 * sounds when nothing is new, and three soft notes as a 段 of この回の棚
 * fills; a short vibration too where the device has one. ♪ turns the sound
 * off (vibration is silent and stays): the same as 音なし in 設定, kept on
 * this device.
 */
export function useScanSound() {
  const choice = useToneChoice();
  const on = choice !== "off";
  const choiceRef = useRef(choice);
  useEffect(() => {
    choiceRef.current = choice;
  }, [choice]);
  // Phones start sound only from a tap: every tap in the scanner wakes it.
  const wake = useCallback(() => {
    wakeAudio();
  }, []);
  /** `nth`: this time's count of books, for the tones that move with it. */
  const play = useCallback((sound: Moment, nth?: number) => {
    try {
      if (typeof navigator.vibrate === "function")
        navigator.vibrate(sound === "nothing-new" ? [20, 60, 20] : 30);
    } catch {
      // Vibration refused: the sound and the card still tell.
    }
    const tone = choiceRef.current;
    if (tone === "off") return;
    playTone(tone, sound, nth);
  }, []);
  const toggle = () => {
    setSoundOn(!on);
    if (!on) wake();
  };
  return { on, toggle, play, wake };
}

/**
 * The screen stays on while the camera reads (資料 10章 ⑩): a phone that
 * dims halfway through fifty books stops the reading. Where the browser
 * cannot keep it on, it dims as it would.
 */
export function useScreenKeptOn(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    void navigator.wakeLock.request("screen").then(
      (got) => {
        if (stopped) void got.release().catch(() => {});
        else lock = got;
      },
      () => {},
    );
    return () => {
      stopped = true;
      void lock?.release().catch(() => {});
    };
  }, [on]);
}
