"use client";

import { formatPostTime, postAge } from "../../lib/social";
import { useNow } from "../../lib/now";

/**
 * When a post was written, in a list: いま, 5分前, 3時間前, then the day.
 * The static page and the first render show the whole time, as the post's
 * page always does, so the HTML and the browser agree.
 */
export function PostWhen({
  at,
  className,
}: {
  at: string;
  className?: string;
}) {
  const now = useNow();
  const whole = formatPostTime(at);
  return (
    <time className={className} dateTime={at} title={whole}>
      {now === null ? whole : postAge(at, now)}
    </time>
  );
}
