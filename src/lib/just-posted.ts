// The post written a moment ago, so its card can glow once where it lands.
// Kept in memory only: a reload simply shows the post as it is.
const GLOW_FOR = 6000;
let last: { id: string; at: number } | null = null;

export function notePosted(id: string) {
  last = { id, at: Date.now() };
}

export function postedJustNow(id: string): boolean {
  return last?.id === id && Date.now() - last.at < GLOW_FOR;
}
