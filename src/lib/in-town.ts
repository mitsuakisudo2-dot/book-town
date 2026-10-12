// The pages of the town this tab has walked through, so a page can tell
// whether going back stays in the town or leaves it (a page opened directly
// from a shared link has nothing of the town behind it).
let trail: string[] = [];
let replacing = false;
let poppedTo: string | null = null;
const listeners = new Set<() => void>();

const here = () => location.pathname + location.search;

if (typeof window !== "undefined")
  addEventListener("popstate", () => {
    poppedTo = here();
  });

/** Called just before a navigation that takes the place of this page. */
export function noteReplacing() {
  replacing = true;
}

/** Called once a page of the town has appeared. */
export function notePageShown() {
  const page = here();
  const at = poppedTo === page ? trail.lastIndexOf(page) : -1;
  if (at >= 0) trail = trail.slice(0, at + 1);
  // The same page shown again (React may run the effect twice) is no step.
  else if (trail[trail.length - 1] === page) return;
  else if (replacing && trail.length) trail[trail.length - 1] = page;
  else trail.push(page);
  replacing = false;
  poppedTo = null;
  listeners.forEach((listener) => listener());
}

export function subscribeTrail(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when going back returns to another page of the town. */
export const canGoBackInTown = () => trail.length > 1;
