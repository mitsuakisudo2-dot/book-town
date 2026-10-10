"use client";

import { recommendationsOf, reviewsOf } from "../../lib/social/selectors";
import { useSocialStore } from "../../lib/social/store";
import { Icon } from "../ui";
import { PostCard } from "./PostCard";
import { useSocialUI } from "./SocialContext";
import "./social.css";

/** The work page's conversation: reviews, then books recommended in replies. */
export function BookReviews({ bookId }: { bookId: string }) {
  const { social } = useSocialStore();
  const { compose } = useSocialUI();
  const reviews = reviewsOf(social, bookId);
  const recommendations = recommendationsOf(social, bookId);
  const protectedCount = reviews.filter((post) => post.spoiler).length;
  return (
    <section
      className="sns-book-reviews"
      id="reviews"
      aria-labelledby="book-reviews-title"
    >
      <div className="sns-section-head">
        <div>
          <span className="eyebrow">READERS&rsquo; NOTES</span>
          <h2 id="book-reviews-title">みんなの感想</h2>
          <p>
            {reviews.length
              ? `${reviews.length}件の感想` +
                (protectedCount
                  ? `。うち${protectedCount}件はネタバレを含むため、開くまで本文を隠しています。`
                  : "")
              : "この本について、最初の言葉を残してみませんか。"}
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => compose({ book: { bookId, purpose: "review" } })}
        >
          <Icon name="edit" size={15} />
          感想を書く
        </button>
      </div>
      <div className="sns-list">
        {reviews.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            context="work"
            hideBookId={bookId}
          />
        ))}
      </div>
      {recommendations.length > 0 && (
        <div className="sns-recommendations">
          <h3>会話の中で薦められた本</h3>
          <p>誰かへの返信に、この本が添えられました。</p>
          <div className="sns-list">
            {recommendations.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                context="work"
                showReplyTo
                hideBookId={bookId}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
