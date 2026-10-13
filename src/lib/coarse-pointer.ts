/**
 * Whether the reader's main pointer is a finger. On a touch screen a text
 * field given the focus raises the keyboard, and the keyboard covers what has
 * just opened. A laptop with a touch screen still points with its trackpad.
 */
export const COARSE_POINTER = "(pointer: coarse)";

type Media = { matchMedia?: (query: string) => { matches: boolean } };

export function coarsePointer(view: Media = globalThis): boolean {
  return view.matchMedia?.(COARSE_POINTER).matches ?? false;
}

/**
 * Whether a sheet opening puts the focus in its first field. A sheet for
 * writing on a touch screen does not: the reader sees it whole and taps the
 * field when ready.
 */
export function focusesFieldOnOpen(
  writing: boolean,
  view: Media = globalThis,
): boolean {
  return !(writing && coarsePointer(view));
}
