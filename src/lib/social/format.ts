// A fixed time zone keeps prerendered HTML and the hydrated client identical.
// Relative times ("3分前") would differ between build time and view time.
const parts = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatPostTime(iso: string): string {
  const values = Object.fromEntries(
    parts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${values.month}月${values.day}日 ${values.hour}:${values.minute}`;
}

export function formatPostDateTime(iso: string): string {
  const values = Object.fromEntries(
    parts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${values.year}年${values.month}月${values.day}日 ${values.hour}:${values.minute}`;
}
