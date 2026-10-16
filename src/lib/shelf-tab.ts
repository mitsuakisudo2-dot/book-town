// 本棚 in the main navigation opens, for now, the 登録 list on the reader's
// own profile (`/profiles/me/?books=library`), until the library has a page
// of its own. The list sits below the profile's top, so a tap on 本棚 asks
// the profile to bring it into view: once the profile opens, or at once when
// it is open already. Coming back to the page (戻る, a reload) asks nothing.

let asked = false;
const listeners = new Set<() => void>();

/** 本棚 tapped: the 登録 list comes into view, here or on arrival. */
export function requestShelf() {
  asked = true;
  listeners.forEach((listener) => listener());
}

/** Whether 本棚 was tapped since last asked; asking takes the tap. */
export function takeShelfRequest() {
  const was = asked;
  asked = false;
  return was;
}

export function onShelfRequest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
