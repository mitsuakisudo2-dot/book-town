"use client";

import { useEffect, useRef } from "react";

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
};

/** Layers set aside in the last moment, whose step is about to come off. */
const closing = new Set<Layer>();
/** Layers open now. */
const opened = new Set<Layer>();

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
  const layers = stack();
  const at = layers.lastIndexOf(layer.token);
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
  const before = [...closing].find((other) => other.token === layers.at(-1));
  if (before) {
    clearTimeout(before.closing!);
    before.closing = null;
    before.open = false;
    closing.delete(before);
    history.replaceState(
      {
        ...layerState(),
        booktownLayers: [...layers.slice(0, -1), layer.token],
      },
      "",
    );
  } else if (!layers.includes(layer.token))
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
  });

  useEffect(() => {
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
      // Set aside while still open: its step comes off, unless another layer
      // takes it over or the page has already moved on.
      if (!layer.open || layer.left) return;
      if (!layer.recorded) {
        layer.open = false;
        return;
      }
      closing.add(layer);
      layer.closing = setTimeout(() => {
        layer.closing = null;
        closing.delete(layer);
        close(layer);
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
      if (!top || !ref.current(top)) return;
      // Rendered by now; the layer, mounted next, holds the page still here.
      const at = layerState()?.booktownScroll;
      if (at) scrollTo({ left: at[0], top: at[1], behavior: "instant" });
    };
    look();
    addEventListener("popstate", look);
    return () => removeEventListener("popstate", look);
  }, [ready]);
}
