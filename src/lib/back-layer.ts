"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

// A layer drawn over the page (a dialog, a book held in hand) is one step of
// 戻る: opening it adds a step to the browser's history, 戻る closes it, and
// closing it by hand takes that step back off, so the next 戻る leaves the
// page just as it would have. A layer that gives way to another (a shelf
// close up, then a book from it) hands its step over. The open layers are
// kept, in order, in the history entry's own state beside the router's,
// which keeps them there.

type LayerState = {
  booktownLayers?: string[];
  /** The page's address beneath each layer, when it opened. */
  booktownBelow?: string[];
  /** Where the page beneath was scrolled when its first layer opened. */
  booktownScroll?: [number, number];
} | null;

const layerState = () => history.state as LayerState;
const stack = (): string[] => layerState()?.booktownLayers ?? [];
const address = () => location.pathname + location.search + location.hash;

/** This step's state, with only the layers kept that `keep` says. */
function keeping(keep: (index: number) => boolean) {
  const {
    booktownLayers = [],
    booktownBelow = [],
    booktownScroll,
    ...rest
  } = layerState() ?? {};
  const layers = booktownLayers.filter((_, index) => keep(index));
  return layers.length
    ? {
        ...rest,
        booktownLayers: layers,
        booktownBelow: booktownBelow.filter((_, index) => keep(index)),
        booktownScroll,
      }
    : rest;
}

// A reload starts the page afresh: layers it had open are not opened again,
// and the step no longer counts them.
if (
  typeof window !== "undefined" &&
  stack().length &&
  (
    performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined
  )?.type === "reload"
)
  history.replaceState(
    keeping(() => false),
    "",
  );

/** The name of the topmost layer recorded for this step, if any. */
export const layerOnTop = (): string | null =>
  typeof window === "undefined" ? null : (stack().at(-1) ?? null);

// Unnamed layers get names no other page load can have given out.
const session = Math.random().toString(36).slice(2, 8);
let made = 0;
const unnamed = (token: string) => token.startsWith("layer-");

type Layer = {
  token: string;
  open: boolean;
  /** Its step is in the history (it may wait for a step coming off). */
  recorded: boolean;
  left: boolean;
  closing: ReturnType<typeof setTimeout> | null;
  /** The step of the history it was set aside on (see `moves`). */
  asideAt: number;
};

// The browser's moves through the history, counted. A layer set aside takes
// its step off a moment later, but a slow phone can hold that moment for
// seconds: long enough for the reader to have gone on to another page and
// come back with 戻る to the very step the layer was on. The page coming back
// opens the layer there again, so a layer set aside before a move leaves the
// history as it is, and hands nothing over.
let moves = 0;
if (typeof window !== "undefined")
  addEventListener("popstate", () => {
    moves += 1;
  });
/** Set aside since the browser last moved: its step is still to come off. */
const goingNow = (layer: Layer) => layer.asideAt === moves;

/** Layers set aside in the last moment, whose step is about to come off. */
const closing = new Set<Layer>();
/** Layers closed while another's step was coming off, waiting for it. */
const shutting = new Set<string>();
/** Layers open now. */
const opened = new Set<Layer>();
/** Those told when a layer opens or closes over the page. */
const watching = new Set<() => void>();
const openedChanged = () => watching.forEach((listener) => listener());

/**
 * Whether a layer is open over the page (a dialog, a 便り's page, a book in
 * hand, 注釈モード): what the page beneath shows for a moment waits.
 */
export function useLayerOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      watching.add(listener);
      return () => {
        watching.delete(listener);
      };
    },
    () => opened.size > 0,
    () => false,
  );
}

/**
 * The layer was closed and its step has yet to come off. A step the browser
 * arrives at meanwhile (another layer's coming off first) may still have it,
 * and does not open it again.
 */
const closed = (token: string) =>
  shutting.has(token) ||
  [...closing].some((layer) => layer.token === token && goingNow(layer));

/**
 * Steps back, and settles once the browser is there. Going back takes a
 * moment; a layer opened meanwhile waits for it, or its own new step would be
 * the one taken off.
 */
let backing: Promise<void> | null = null;
function back(steps: number) {
  const arrived = new Promise<void>((resolve) =>
    addEventListener("popstate", () => resolve(), { once: true }),
  );
  const settled: Promise<void> = arrived.then(() => {
    if (backing === settled) backing = null;
  });
  backing = settled;
  history.go(-steps);
  return arrived;
}

// A link tapped while a closed dialog's step is still coming off waits for
// it; otherwise going back would land after the link and undo it.
if (typeof window !== "undefined")
  addEventListener(
    "click",
    (event) => {
      if (!backing || event.defaultPrevented || event.button !== 0) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download") ||
        link.origin !== location.origin
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void backing.then(() => setTimeout(() => link.click(), 0));
    },
    true,
  );

/**
 * Runs `then` once a layer closed just now has taken its step off the
 * history. Going back puts the page where it was scrolled when the layer
 * opened, so a page that shows the reader something after a layer closes
 * (the books a scan just read in) waits for that first.
 */
export function afterLayerCloses(then: () => void) {
  // After the closed layer's own timer (close, below), which may go back.
  setTimeout(() => {
    if (backing) void backing.then(() => setTimeout(then, 0));
    else then();
  }, 0);
}

/**
 * Goes on to another page from inside dialogs (a post sent, then the
 * timeline): their steps come off first, so that 戻る from there returns to
 * the page beneath. A named layer (a book in hand) stays, to come back to,
 * unless `leaving` says it goes too.
 */
export function leaveLayers(
  go: () => void,
  leaving: (token: string) => boolean = unnamed,
) {
  const layers = stack();
  let count = 0;
  while (count < layers.length && leaving(layers[layers.length - 1 - count]))
    count += 1;
  if (!count) return go();
  const left = new Set(layers.slice(-count));
  for (const layer of opened) if (left.has(layer.token)) layer.left = true;
  void back(count).then(() => setTimeout(go, 0));
}

function close(layer: Layer) {
  if (!layer.open) return;
  layer.open = false;
  takeOff(layer.token);
}

/** Takes a closed layer's step off. */
function takeOff(token: string) {
  // Closed just as another layer's step comes off (a request closed, and at
  // once the book it was asked from): until the browser gets there, the
  // history shows the step being left, with this layer not on top. Taken out
  // of that step, it would stay in the one arrived at, and open again; so it
  // waits, and goes from there.
  if (backing) {
    shutting.add(token);
    void backing.then(() => {
      shutting.delete(token);
      // Opened again meanwhile (the same book, the same step): the step is
      // its own now.
      if ([...opened].some((layer) => layer.open && layer.token === token))
        return;
      takeOff(token);
    });
    return;
  }
  const layers = stack();
  const at = layers.lastIndexOf(token);
  if (at < 0) return;
  // The page changed its address beneath (a tab chosen as the dialog
  // closed): the step stays, as that change, rather than undoing it.
  if (
    at === layers.length - 1 &&
    layerState()?.booktownBelow?.[at] === address()
  )
    void back(1);
  else
    history.replaceState(
      keeping((index) => index !== at),
      "",
    );
}

/** Records the layer's step, unless a layer that just gave way hands it over. */
function record(layer: Layer) {
  if (!layer.open || layer.recorded) return;
  layer.recorded = true;
  const layers = stack();
  const recorded = layers.includes(layer.token);
  // The same layer mounted again takes its own step back; another takes over
  // the step on top.
  const before = [...closing].find(
    (other) =>
      goingNow(other) &&
      (recorded ? other.token === layer.token : other.token === layers.at(-1)),
  );
  if (before) {
    clearTimeout(before.closing!);
    before.closing = null;
    before.open = false;
    closing.delete(before);
  }
  if (before && !recorded)
    history.replaceState(
      {
        ...layerState(),
        booktownLayers: [...layers.slice(0, -1), layer.token],
      },
      "",
    );
  else if (!recorded)
    // Coming back to a step that recorded this layer opens no second one.
    history.pushState(
      {
        ...layerState(),
        booktownLayers: [...layers, layer.token],
        booktownBelow: [...(layerState()?.booktownBelow ?? []), address()],
        booktownScroll: layerState()?.booktownScroll ?? [scrollX, scrollY],
      },
      "",
    );
}

/**
 * Makes the mounted layer one step of 戻る; `onBack` runs when 戻る takes the
 * step off. Closing the layer, by `close` or by unmounting it, takes the step
 * back off.
 *
 * To leave the page from inside the layer, call `leave(go)`. A layer with a
 * `name` (what is open: a book, a list) stays recorded in the step it leaves,
 * so the page can open it again on the way back (`useLayerReturn`); a layer
 * without one is taken off first, and the reader goes on from the page.
 */
export function useBackLayer(onBack: () => void, name?: string) {
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);
  const ref = useRef<Layer>({
    token: "",
    open: false,
    recorded: false,
    left: false,
    closing: null,
    asideAt: 0,
  });

  // A layout effect, so that the layer is set aside in the same moment the
  // page lets it go. Leaving a page is a transition, and React may hold its
  // passive cleanups until the next update: on a slow phone that can be the
  // 戻る that returns to this step, and a layer set aside only then would take
  // the step back off from under the page coming back to it.
  useLayoutEffect(() => {
    const layer = ref.current;
    if (layer.closing) {
      // Mounted again at once (React does this while developing): the same
      // layer, still open.
      clearTimeout(layer.closing);
      layer.closing = null;
      closing.delete(layer);
    } else {
      layer.token = name ?? `layer-${session}-${++made}`;
      layer.open = true;
      layer.recorded = false;
      layer.left = false;
      if (backing) void backing.then(() => record(layer));
      else record(layer);
    }

    opened.add(layer);
    openedChanged();
    const onPop = () => {
      if (!layer.open || !layer.recorded || stack().includes(layer.token))
        return;
      layer.open = false;
      backRef.current();
    };
    addEventListener("popstate", onPop);
    return () => {
      removeEventListener("popstate", onPop);
      opened.delete(layer);
      openedChanged();
      // Set aside while still open: its step comes off, unless another layer
      // takes it over or the page has already moved on.
      if (!layer.open || layer.left) return;
      if (!layer.recorded) {
        layer.open = false;
        return;
      }
      closing.add(layer);
      layer.asideAt = moves;
      layer.closing = setTimeout(() => {
        layer.closing = null;
        closing.delete(layer);
        if (goingNow(layer)) close(layer);
        else layer.open = false;
      }, 0);
    };
    // One step per mount; a layer that is renamed keeps it (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A layer that moves on to another book keeps its one step, renamed.
  useEffect(() => {
    const layer = ref.current;
    if (!name || !layer.open || layer.token === name) return;
    const layers = stack();
    if (layer.recorded && layers.at(-1) === layer.token)
      history.replaceState(
        { ...layerState(), booktownLayers: [...layers.slice(0, -1), name] },
        "",
      );
    layer.token = name;
  }, [name]);

  return {
    close: () => close(ref.current),
    leave: (go: () => void) => {
      const layer = ref.current;
      const onTop =
        layer.open && layer.recorded && stack().at(-1) === layer.token;
      layer.left = true;
      layer.open = false;
      if (name || !onTop) return go();
      // Take the layer's step off first, then go on from the page, so that
      // 戻る from the next page returns to the page, not to a closed layer.
      void back(1).then(() => setTimeout(go, 0));
    },
  };
}

/**
 * Calls `reopen` with the topmost layer recorded for this step when the page
 * is shown on it (once `ready`), or returned to it: a book left in hand for
 * its own page is in hand again on the way back. `reopen` says whether it
 * opened the layer again, and the page goes back to where it was beneath.
 */
export function useLayerReturn(
  reopen: (name: string) => boolean,
  ready = true,
) {
  const ref = useRef(reopen);
  useEffect(() => {
    ref.current = reopen;
  });
  useEffect(() => {
    if (!ready) return;
    const look = () => {
      const top = layerOnTop();
      if (!top || closed(top) || !ref.current(top)) return;
      // Rendered by now; the layer, mounted next, holds the page still here.
      const at = layerState()?.booktownScroll;
      if (at) scrollTo({ left: at[0], top: at[1], behavior: "instant" });
    };
    look();
    addEventListener("popstate", look);
    return () => removeEventListener("popstate", look);
  }, [ready]);
}
