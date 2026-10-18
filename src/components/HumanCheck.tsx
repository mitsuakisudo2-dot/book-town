"use client";

import { useCallback, useEffect, useRef } from "react";
import { humanCheckKey, loadTurnstile, type Turnstile } from "../lib/turnstile";

/** How long a press waits for an answer still on its way. */
const WAIT_MS = 15_000;

/**
 * Cloudflare Turnstile on the login screen (src/lib/turnstile.ts). The check
 * starts as the screen opens, so the answer is usually there before anything
 * is pressed; a passkey's window then opens at once, as a browser wants it to
 * on a tap. `boxRef` is where Turnstile asks for a tap when it cannot tell, and
 * stays empty otherwise. `take()` gives one answer for one try (an answer
 * works once) and starts the next; without a site key for this host it gives
 * nothing and the login goes on as before.
 */
export function useHumanCheck() {
  const box = useRef<HTMLDivElement>(null);
  const turnstile = useRef<Turnstile | null>(null);
  const widget = useRef<string | null>(null);
  const answer = useRef<string | null>(null);
  const needed = useRef(false);
  const waiting = useRef<((answer: string | undefined) => void)[]>([]);

  const hand = (value: string | undefined) => {
    for (const resolve of waiting.current.splice(0)) resolve(value);
  };

  useEffect(() => {
    const key = humanCheckKey(location.hostname);
    if (!key || !box.current) return;
    needed.current = true;
    let gone = false;
    loadTurnstile()
      .then((loaded) => {
        if (gone || !box.current) return;
        turnstile.current = loaded;
        widget.current = loaded.render(box.current, {
          sitekey: key,
          action: "login",
          appearance: "interaction-only",
          language: "ja",
          size: "flexible",
          "refresh-expired": "auto",
          callback: (token) => {
            answer.current = token;
            hand(token);
          },
          "expired-callback": () => {
            answer.current = null;
          },
          "error-callback": () => {
            answer.current = null;
            hand(undefined);
          },
        });
      })
      // Without Cloudflare's script the try goes without an answer, and
      // Supabase's refusal says what happened.
      .catch(() => hand(undefined));
    return () => {
      gone = true;
      if (widget.current) turnstile.current?.remove(widget.current);
      widget.current = null;
      hand(undefined);
    };
  }, []);

  const take = useCallback(async (): Promise<string | undefined> => {
    if (!needed.current) return undefined;
    let value = answer.current ?? undefined;
    if (!value)
      value = await new Promise<string | undefined>((resolve) => {
        waiting.current.push(resolve);
        setTimeout(() => resolve(undefined), WAIT_MS);
      });
    answer.current = null;
    if (widget.current) turnstile.current?.reset(widget.current);
    return value;
  }, []);

  return { boxRef: box, take };
}
