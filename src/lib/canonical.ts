/**
 * A value as one string, the same however its objects' keys were ordered
 * (a value read back from the database comes in its own order) and leaving
 * out what is undefined, so two values that hold the same compare equal.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

/** A stable number for a text (FNV-1a): the same text, the same number. */
export function textHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A short mark of what a value holds (its canonical string), enough to tell
 * one version of it from the next: kept work remembers the mark of what it
 * began from, so a version saved since (on another device) is told apart.
 */
export const valueMark = (value: unknown): string =>
  textHash(canonical(value)).toString(36);
