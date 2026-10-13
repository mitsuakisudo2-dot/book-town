"use client";
import dynamic from "next/dynamic";
import { useCanAnnotate } from "../lib/site-notes-session";
import type { Notify } from "../lib/types";

// Loaded only once the database says this reader is staff: everyone else
// never fetches 注釈モード's code or styles, and sees nothing of it.
const SiteNotes = dynamic(() => import("./SiteNotes"), { ssr: false });

/** 注釈モード for staff; renders nothing for everyone else and loads nothing either. */
export function SiteNotesGate({ notify }: { notify: Notify }) {
  return useCanAnnotate() ? <SiteNotes notify={notify} /> : null;
}
