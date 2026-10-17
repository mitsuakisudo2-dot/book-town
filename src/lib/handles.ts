import type { Reader } from "./types";
import { failure } from "./words";

export const DEFAULT_HANDLE = "reader";

/** A public ID: 3–20 lowercase letters, digits or underscores, shown as @handle. */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

/** IDs nobody may take. The database refuses the same list (profiles.handle). */
export const RESERVED_HANDLES: readonly string[] = [
  "admin",
  "administrator",
  "api",
  "booktown",
  "help",
  "moderator",
  "official",
  "root",
  "settings",
  "staff",
  "support",
  "system",
];

export const normalizeHandle = (raw: string): string =>
  raw.trim().replace(/^@/, "").toLowerCase();

/** Why a handle cannot be used, or null when it can. */
export function handleProblem(
  handle: string,
  others: Pick<Reader, "handle">[],
): string | null {
  if (!HANDLE_PATTERN.test(handle))
    return "IDは3〜20文字の半角英小文字・数字・_（アンダーバー）で入力してください。";
  if (RESERVED_HANDLES.includes(handle))
    return failure({
      what: "このIDは使えません",
      next: "別のIDにしてください",
    });
  if (others.some((reader) => reader.handle === handle))
    return "このIDはほかの読書家が使っています。";
  return null;
}
