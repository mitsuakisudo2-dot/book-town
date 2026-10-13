import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "./database.types";
import type { SiteNote, SiteNoteSpot } from "../site-notes";

// 注釈モード's calls to the database. Only staff are let in by row level
// security; for anyone else every call here is refused or comes back empty.

type Client = SupabaseClient<Database>;

/** The columns the screen reads back. */
export const SITE_NOTE_COLUMNS =
  "id, page, x, y, viewport_w, viewport_h, scroll_y, target, layer, anchor, anchor_x, anchor_y, body, device, created_at";

type SiteNoteRow = Pick<
  Tables<"site_notes">,
  | "id"
  | "page"
  | "x"
  | "y"
  | "viewport_w"
  | "viewport_h"
  | "scroll_y"
  | "target"
  | "layer"
  | "anchor"
  | "anchor_x"
  | "anchor_y"
  | "body"
  | "device"
  | "created_at"
>;

export function siteNoteFrom(row: SiteNoteRow): SiteNote {
  return {
    id: row.id,
    page: row.page,
    x: row.x,
    y: row.y,
    viewportW: row.viewport_w,
    viewportH: row.viewport_h,
    scrollY: row.scroll_y,
    target: row.target,
    layer: row.layer,
    anchor: row.anchor,
    anchorX: row.anchor_x,
    anchorY: row.anchor_y,
    body: row.body,
    device: row.device,
    createdAt: row.created_at,
  };
}

/** Whether the signed-in person is staff; false on any error (no button, asked again next load). */
export async function askCanAnnotate(client: Client): Promise<boolean> {
  const { data, error } = await client.rpc("can_annotate");
  return !error && data === true;
}

/** The caller's notes not taken back whose page starts with `pathname`, oldest first. */
export async function loadOpenNotes(
  client: Client,
  pathname: string,
): Promise<SiteNote[]> {
  const { data, error } = await client
    .from("site_notes")
    .select(SITE_NOTE_COLUMNS)
    .is("removed_at", null)
    .like("page", pathname.replace(/[\\%_]/g, "\\$&") + "%")
    .order("created_at")
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(siteNoteFrom);
}

/** Leaves a note. The database fills in who left it and when. */
export async function leaveSiteNote(
  client: Client,
  spot: SiteNoteSpot,
  body: string,
  device: string,
  build: string | null,
): Promise<{ note: SiteNote } | { failure: "limit" | "failed" }> {
  const { data, error } = await client
    .from("site_notes")
    .insert({
      page: spot.page,
      x: spot.x,
      y: spot.y,
      viewport_w: spot.viewportW,
      viewport_h: spot.viewportH,
      scroll_y: spot.scrollY,
      target: spot.target,
      layer: spot.layer,
      anchor: spot.anchor,
      anchor_x: spot.anchorX,
      anchor_y: spot.anchorY,
      body,
      device,
      build,
    })
    .select(SITE_NOTE_COLUMNS)
    .single();
  if (error || !data)
    return {
      failure:
        error?.code === "23514" && /an hour/.test(error.message)
          ? "limit"
          : "failed",
    };
  return { note: siteNoteFrom(data) };
}

/** Takes a note back, or returns it. True when the database did it. */
export async function setSiteNoteRemoved(
  client: Client,
  id: string,
  removed: boolean,
): Promise<boolean> {
  // The database dates it with its own clock, whatever time is sent.
  const { data, error } = await client
    .from("site_notes")
    .update({ removed_at: removed ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  return !error && data?.length === 1;
}
