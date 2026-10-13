"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAccountState } from "./account-session";
import { getSupabase } from "./supabase/client";
import { supabaseConfigured } from "./supabase/config";
import { askCanAnnotate } from "./supabase/site-notes";

// Whether the signed-in person is staff, asked once per account and page
// load. A visitor and the demo build never ask; anyone who is not staff gets
// false, and so no 注釈 button and no part of 注釈モード.

let asked: { userId: string; answer: boolean | null } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True only for a signed-in staff account in a build with Supabase. */
export function useCanAnnotate(): boolean {
  const account = useAccountState();
  const userId =
    supabaseConfigured && account.status === "signed-in"
      ? account.user.id
      : null;
  const answer = useSyncExternalStore(
    subscribe,
    () => (asked && asked.userId === userId ? asked.answer : null),
    () => null,
  );
  useEffect(() => {
    if (!userId || asked?.userId === userId) return;
    const client = getSupabase();
    if (!client) return;
    const asking = { userId, answer: null };
    asked = asking;
    void askCanAnnotate(client).then((yes) => {
      // Someone else signed in meanwhile: their own question is under way.
      if (asked !== asking) return;
      asked = { userId, answer: yes };
      listeners.forEach((listener) => listener());
    });
  }, [userId]);
  return userId !== null && answer === true;
}
