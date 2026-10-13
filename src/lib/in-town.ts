// The pages of the town this tab has walked through, so a page can tell
// whether going back stays in the town or leaves it (a page opened directly
// from a shared link has nothing of the town behind it).
let trail: string[] = [];
let poppedTo: string | null = null;
const listeners = new Set<() => void>();

const here = () => location.pathname + location.search;

if (typeof window !== "undefined")
  addEventListener("popstate", () => {
    // A dialog closed by 戻る stays on the same page: no page to step back to.
    if (here() !== trail[trail.length - 1]) poppedTo = here();
  });

/** Called once a page of the town has appeared. */
export function notePageShown() {
  const page = here();
  const at = poppedTo === page ? trail.lastIndexOf(page) : -1;
  if (at >= 0) trail = trail.slice(0, at + 1);
  // The same page shown again (React may run the effect twice) is no step.
  else if (trail[trail.length - 1] === page) return;
  else trail.push(page);
  poppedTo = null;
  listeners.forEach((listener) => listener());
}

/** The page's address changed in place (a tab, a filter): same step, new address. */
export function noteAddressChanged() {
  if (trail.length) trail[trail.length - 1] = here();
}

export function subscribeTrail(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when going back returns to another page of the town. */
export const canGoBackInTown = () => trail.length > 1;
