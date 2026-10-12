// When this browser last opened a shop, so the street can welcome it for a
// day. Only a convenience: without storage the shop simply takes its place.
const KEY = "book-town-opened-at";
const DAY = 24 * 60 * 60 * 1000;

export function noteShopOpened() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {}
}

export function shopOpenedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return at > 0 && Date.now() - at < DAY;
  } catch {
    return false;
  }
}
