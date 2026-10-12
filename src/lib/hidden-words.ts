// Words a writer covers inside a post, written ||like this|| (or with the
// full-width ｜｜ a Japanese keyboard types). Readers see a cover over just
// those words until they choose to look, so a review with one spoiling line
// does not have to hide all of itself.
const HIDDEN = /(\|\||｜｜)([\s\S]*?)\1/g;

export type TextPart = { text: string; hidden?: true };

/** Splits a post into what anyone reads and what is covered. */
export function splitHidden(body: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of body.matchAll(HIDDEN)) {
    if (!match[2].trim()) continue;
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: body.slice(last, index) });
    parts.push({ text: match[2], hidden: true });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** The post as a passer-by reads it, for quotes outside the post itself. */
export const coverHidden = (body: string) =>
  splitHidden(body)
    .map((part) => (part.hidden ? "（ネタバレ）" : part.text))
    .join("");

/** The writer's own words with the covers taken off. */
export const uncoverHidden = (body: string) =>
  splitHidden(body)
    .map((part) => part.text)
    .join("");

const OPEN = "||";
const PLACEHOLDER = "隠したい言葉";

/**
 * Covers the selected words of a draft, or leaves a covered place to write in.
 * The returned range selects the covered words so they can be typed over.
 * Null when the marks would not fit.
 */
export function coverSelection(
  body: string,
  start: number,
  end: number,
  max: number,
): { body: string; start: number; end: number } | null {
  const chosen = body.slice(start, end);
  const words = chosen.trim() ? chosen : PLACEHOLDER;
  const next =
    body.slice(0, start) +
    OPEN +
    words +
    OPEN +
    body.slice(chosen ? end : start);
  if (next.length > max) return null;
  return {
    body: next,
    start: start + OPEN.length,
    end: start + OPEN.length + words.length,
  };
}
