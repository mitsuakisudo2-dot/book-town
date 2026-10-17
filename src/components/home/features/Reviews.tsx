"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import type { Post, TownState } from "../../../lib/types";
import { findReader } from "../../../lib/social";
import { postPath } from "../../../lib/paths";
import { isSample } from "../../../lib/tonight";
import { bookById, bookTitle } from "../../../lib/book-name";
import { BookJacket, ReaderAvatar } from "../../ui";
import { openPost } from "../../letter/post-layer";
import { SampleTag } from "../FeatureBand";

/** A plain click, not one meant for a new tab or window. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * 感想が面白い本: the book, a few lines of what was said about it and who
 * said it. A tap opens the 便り's page, as a card's does. No stars, no counts.
 */
export function Reviews({ posts, state }: { posts: Post[]; state: TownState }) {
  return posts.map((post) => {
    const book = bookById(state.books, post.bookId);
    const writer = findReader(state, post.authorId);
    if (!book) return null;
    return (
      <li key={post.id}>
        <Link
          href={postPath(post.id)}
          className="home-review"
          onClick={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            openPost(post.id, event.currentTarget);
          }}
        >
          <span className="home-tile-book" aria-hidden="true">
            <BookJacket book={book} sizes="116px" />
          </span>
          <b className="home-review-title">{bookTitle(book)}</b>
          <span className="home-review-words">「{post.body}」</span>
          <span className="home-review-by">
            {writer && <ReaderAvatar reader={writer} size={20} />}
            {writer?.name}
            {isSample(post.authorId) && <SampleTag />}
          </span>
        </Link>
      </li>
    );
  });
}
