"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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

const SOUND_KEY = "book-town-scan-sound";
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
type Sound = "in" | "nothing-new";

/**
 * A short tone when a book is taken in, two lower ones when nothing is new;
 * the same as a short vibration where the device has one. ♪ turns the sound
 * off (vibration is silent and stays), and this device remembers it.
 */
export function useScanSound() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const onRef = useRef(on);
  useEffect(() => {
    onRef.current = on;
  }, [on]);
  const context = useRef<AudioContext | null>(null);
  useEffect(
    () => () => {
      void context.current?.close().catch(() => {});
      context.current = null;
    },
    [],
  );
  // Phones start sound only from a tap: every tap in the scanner wakes it.
  const wake = useCallback(() => {
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return;
      context.current ??= new Context();
      if (context.current.state === "suspended")
        void context.current.resume().catch(() => {});
    } catch {
      // No sound on this device.
    }
  }, []);
  const play = useCallback(
    (sound: Sound) => {
      try {
        if (typeof navigator.vibrate === "function")
          navigator.vibrate(sound === "in" ? 30 : [20, 60, 20]);
      } catch {
        // Vibration refused: the sound and the card still tell.
      }
      if (!onRef.current) return;
      wake();
      const audio = context.current;
      if (!audio) return;
      const tone = (
        hz: number,
        after: number,
        length: number,
        peak: number,
      ) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + after;
        oscillator.type = "sine";
        oscillator.frequency.value = hz;
        // From near silence and back, so it never clicks.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
      };
      if (sound === "in") tone(1046.5, 0, 0.08, 0.18);
      else {
        tone(587, 0, 0.07, 0.14);
        tone(440, 0.1, 0.09, 0.14);
      }
    },
    [wake],
  );
  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      if (next) localStorage.removeItem(SOUND_KEY);
      else localStorage.setItem(SOUND_KEY, "off");
    } catch {
      // Remembered for this time only.
    }
    if (next) wake();
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
