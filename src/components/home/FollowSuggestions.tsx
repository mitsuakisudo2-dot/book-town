"use client";

import Link from "next/link";
import { ownersToFollow } from "../../lib/social";
import { profilePath } from "../../lib/paths";
import { isDatabaseId, isSampleId } from "../../lib/record-kind";
import { useTownBackend } from "../../lib/store";
import { quotedTitle } from "../../lib/book-name";
import { ReaderAvatar } from "../ui";
import type { Shared } from "./Letters";

/** Following nobody yet: a few owners, each with words of their own to read. */
export function FollowSuggestions({ state, actions, notify }: Shared) {
  // With an account, only owners who can receive a follow are suggested.
  const savedIn = useTownBackend();
  const owners = ownersToFollow(state).filter(
    ({ shop }) => savedIn !== "account" || isDatabaseId(shop.id),
  );
  if (!owners.length) return null;
  return (
    <section className="follow-suggestions" aria-labelledby="follow-first">
      <h2 id="follow-first">フォローすると、その店主の投稿がここに届きます</h2>
      <ul>
        {owners.map(({ shop, owner, pop, book }) => (
          <li key={shop.id}>
            <Link href={profilePath(owner.id)} className="follow-owner">
              <ReaderAvatar reader={owner} size={36} />
              <span>
                <b>{shop.name}</b>
                <small>
                  {owner.name}
                  {isSampleId(owner.id) && " · 見本"}
                </small>
              </span>
            </Link>
            <p className="follow-pop">
              {quotedTitle(book)}に添えたPOP：{pop}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                actions.toggleFollow(shop.id);
                notify(shop.name + "をフォローしました");
              }}
            >
              フォロー
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
