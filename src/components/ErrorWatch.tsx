"use client";

import { useEffect } from "react";
import {
  reportGate,
  screenError,
  worthSending,
  type ErrorKind,
  type ScreenError,
} from "../lib/screen-errors";
import { isMissingFile, readNewBuild } from "../lib/new-build";
import { BUILD_COMMIT } from "../lib/site-notes";
import {
  supabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "../lib/supabase/config";

type Kept = [ErrorKind, unknown, string?];

declare global {
  interface Window {
    __screenErrors?: Kept[] | null;
  }
}

/**
 * Sends one error to the hosted Supabase. It never throws and never reports
 * its own failure, so a broken line cannot turn into a loop of reports.
 */
function send(error: ScreenError) {
  try {
    void fetch(`${supabaseUrl}/rest/v1/rpc/report_screen_error`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_kind: error.kind,
        p_message: error.message,
        p_place: error.place,
        p_stack: error.stack,
        p_build: error.build,
        p_device: error.device,
      }),
    }).catch(() => {});
  } catch {}
}

/**
 * Hears the errors on this screen (src/lib/screen-errors.ts) and sends each
 * one once, with what could name a reader taken out. Draws nothing. A build
 * without Supabase (the demo) keeps them to itself. A file of the site gone
 * since a new build reads the page again (new-build.ts), in any build.
 */
export function ErrorWatch() {
  useEffect(() => {
    if (!supabaseConfigured) {
      window.__screenErrors = null;
      return;
    }
    const pass = reportGate();
    const hear = (kind: ErrorKind, value: unknown, filename?: string) => {
      try {
        const error = screenError(kind, value, {
          pathname: location.pathname,
          origin: location.origin,
          userAgent: navigator.userAgent,
          touchPoints: navigator.maxTouchPoints,
          build: BUILD_COMMIT ?? "",
        });
        if (worthSending(error, filename) && pass(error)) send(error);
      } catch {}
    };
    const onError = (event: ErrorEvent) => {
      // A picture or script that did not load has no error to tell.
      if (event.error === undefined) return;
      hear("error", event.error ?? event.message, event.filename);
    };
    const onRejection = (event: PromiseRejectionEvent) =>
      hear("rejection", event.reason);
    for (const [kind, value, filename] of window.__screenErrors ?? [])
      hear(kind, value, filename);
    window.__screenErrors = null;
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
    return () => {
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  // A screen's file gone since a new build went up: the page is read again
  // from the new build (new-build.ts), after the error above is sent.
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isMissingFile(event.error)) readNewBuild();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isMissingFile(event.reason)) readNewBuild();
    };
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
    return () => {
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
