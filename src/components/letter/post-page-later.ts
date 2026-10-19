import dynamic from "next/dynamic";

// A 便り's page comes in its own file (with the composer of a reply and the
// cards of its thread), read when a 便り is first opened over the screen, or
// ahead of that once the town is read and the page has a moment. At its own
// address (/post/) it is the screen, read with the page.
const load = () => import("./PostPage");

// Its own (empty) wait while the file comes: the screen beneath stays as it
// is until the page can open over it.
export const PostLayer = dynamic(() => load().then((file) => file.PostLayer), {
  loading: () => null,
});

export const PostPageView = dynamic(() =>
  load().then((file) => file.PostPageView),
);

/** Reads a 便り's page's file ahead, when the page has a moment. */
export function readPostPageAhead() {
  const read = () => void load();
  if ("requestIdleCallback" in window) requestIdleCallback(read);
  else setTimeout(read, 200);
}
