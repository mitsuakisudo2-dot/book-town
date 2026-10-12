"use client";
import { useSyncExternalStore } from "react";
import type { ReportKind } from "./supabase/reports";

/** What the report dialog is about; `name` is how the dialog speaks of it. */
export interface ReportTarget {
  kind: ReportKind;
  id: string;
  name: string;
}

let target: ReportTarget | null = null;
const listeners = new Set<() => void>();
const set = (next: ReportTarget | null) => {
  target = next;
  listeners.forEach((listener) => listener());
};

export const openReport = (next: ReportTarget) => set(next);
export const closeReport = () => set(null);

/** The thing being reported, while the dialog is open. */
export function useReportTarget(): ReportTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => target,
    () => null,
  );
}
