"use client";
import { useEffect, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { isMissingFile, readNewBuild } from "../../lib/new-build";

// A 便り's page comes in its own file (with the composer of a reply and the
// cards of its thread), read when a 便り is first opened over the screen, or
// ahead of that once the town is read and the page has a moment. At its own
// address (/post/) it is the screen, read with the page.
type PageFile = typeof import("./PostPage");
let file: PageFile | null = null;
let reading: Promise<PageFile> | null = null;
const load = () =>
  (reading ??= import("./PostPage").then(
    (read) => (file = read),
    (error) => {
      // Asked again the next time a 便り opens.
      reading = null;
      throw error;
    },
  ));

/**
 * The page over the screen, drawn as soon as its file is here: at once when
 * it was read ahead. Not a Suspense (next/dynamic), whose content shows
 * after a timer that a page held still (a test's clock) never lets run.
 */
export function PostLayer(props: ComponentProps<PageFile["PostLayer"]>) {
  const [here, setHere] = useState(file);
  useEffect(() => {
    if (!here)
      load().then(setHere, (error) => {
        // Gone since a new build went up: read the page from that build.
        if (isMissingFile(error)) readNewBuild();
      });
  }, [here]);
  return here ? <here.PostLayer {...props} /> : null;
}

export const PostPageView = dynamic(() =>
  load().then((read) => read.PostPageView),
);

/** Reads a 便り's page's file ahead, when the page has a moment. */
export function readPostPageAhead() {
  const read = () => void load().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(read);
  else setTimeout(read, 200);
}
