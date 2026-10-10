import assert from "node:assert/strict";
import { books, readers, seedState } from "../src/lib/data";
import {
  createMemoryRepository,
  deserializeTown,
  serializeTown,
} from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import { ME_ID } from "../src/lib/types";
import { demoFollows, demoPosts, demoReactions } from "../src/lib/social/data";
import {
  SOCIAL_STORAGE_BUDGET,
  createMemorySocialRepository,
  deserializeSocial,
  emptySocialData,
  localSocialRepository,
  serializeSocial,
} from "../src/lib/social/repository";
import {
  ancestorsOf,
  conversationBelow,
  findPost,
  hasReacted,
  isReview,
  postsBy,
  protectionOf,
  reactionCount,
  recommendationsOf,
  replyCount,
  reviewsOf,
  timeline,
} from "../src/lib/social/selectors";
import { createSocialStore, seedSocialState } from "../src/lib/social/store";
import type { PostDraft, PostImage } from "../src/lib/social/types";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 9, 11, 0, 0, tick++)).toISOString();
const draft = (patch: Partial<PostDraft> = {}): PostDraft => ({
  text: "",
  images: [],
  book: null,
  spoiler: false,
  replyTo: null,
  ...patch,
});
const pixel: PostImage = {
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  alt: "テスト画像",
  width: 1,
  height: 1,
};
function fresh(quota = Infinity) {
  const repository = createMemorySocialRepository(emptySocialData(), quota);
  const store = createSocialStore(repository, clock);
  store.initialize();
  return { repository, store };
}
function created(
  result: ReturnType<
    ReturnType<typeof fresh>["store"]["actions"]["createPost"]
  >,
) {
  assert.ok(result.ok, `post was rejected: ${result.ok ? "" : result.reason}`);
  return result.post;
}

check(
  "demo world is internally consistent and honest about who reacted",
  () => {
    const bookIds = new Set(books.map((book) => book.id));
    const readerIds = new Set(readers.map((reader) => reader.id));
    const ids = new Set(demoPosts.map((post) => post.id));
    assert.equal(ids.size, demoPosts.length);
    for (const post of demoPosts) {
      assert.ok(readerIds.has(post.authorId), post.id);
      assert.ok(post.demo);
      if (post.book) assert.ok(bookIds.has(post.book.bookId), post.id);
      if (post.reply) {
        const parent = findPost(seedSocialState, post.reply.parentId);
        assert.ok(parent, `${post.id} parent`);
        assert.equal(post.reply.rootId, parent.reply?.rootId ?? parent.id);
        assert.notEqual(post.book?.purpose, "review");
        assert.ok(Date.parse(post.createdAt) > Date.parse(parent.createdAt));
      } else assert.notEqual(post.book?.purpose, "recommend");
    }
    for (const reaction of demoReactions) {
      const post = findPost(seedSocialState, reaction.postId);
      assert.ok(post && readerIds.has(reaction.readerId));
      assert.notEqual(reaction.readerId, post.authorId);
      if (reaction.kind === "wantToRead") assert.ok(post.book);
    }
    for (const follow of demoFollows)
      assert.ok(
        readerIds.has(follow.followerId) && readerIds.has(follow.followeeId),
      );
    // The demo covers every kind of post the spec names.
    assert.ok(demoPosts.some((post) => !post.book && !post.reply));
    assert.ok(demoPosts.some((post) => post.images.length > 0));
    assert.ok(demoPosts.some((post) => post.book?.purpose === "mention"));
    assert.ok(demoPosts.some((post) => isReview(post) && post.spoiler));
    assert.ok(demoPosts.some((post) => post.book?.purpose === "recommend"));
  },
);

check(
  "timeline shows top-level posts newest first; replies stay in conversations",
  () => {
    const posts = timeline(seedSocialState, "everyone");
    assert.ok(posts.length > 0 && posts.every((post) => post.reply === null));
    for (let i = 1; i < posts.length; i++)
      assert.ok(
        Date.parse(posts[i - 1].createdAt) >= Date.parse(posts[i].createdAt),
      );
    assert.deepEqual(timeline(seedSocialState, "following"), []);
  },
);

check(
  "a free post without a book is a timeline post and never a review",
  () => {
    const { store } = fresh();
    const post = created(
      store.actions.createPost(
        draft({ text: "  今日は雨。\n喫茶店で読書。  " }),
      ),
    );
    assert.equal(post.text, "今日は雨。\n喫茶店で読書。");
    assert.equal(post.book, null);
    assert.equal(timeline(store.getSnapshot(), "everyone")[0].id, post.id);
    assert.ok(
      books.every(
        (book) => !reviewsOf(store.getSnapshot(), book.id).includes(post),
      ),
    );
  },
);

check(
  "attaching a book is not a review; publishing as a review lists it on the work page",
  () => {
    const { store } = fresh();
    const before = reviewsOf(store.getSnapshot(), "momo").length;
    const mention = created(
      store.actions.createPost(
        draft({
          text: "モモを買い直した",
          book: { bookId: "momo", purpose: "mention" },
        }),
      ),
    );
    assert.equal(isReview(mention), false);
    assert.equal(reviewsOf(store.getSnapshot(), "momo").length, before);
    const review = created(
      store.actions.createPost(
        draft({
          text: "時間の話",
          book: { bookId: "momo", purpose: "review" },
        }),
      ),
    );
    assert.equal(reviewsOf(store.getSnapshot(), "momo")[0].id, review.id);
    assert.deepEqual(
      postsBy(store.getSnapshot(), ME_ID, "reviews").map((p) => p.id),
      [review.id],
    );
    assert.equal(postsBy(store.getSnapshot(), ME_ID).length, 2);
  },
);

check("invalid drafts are rejected atomically with a reason", () => {
  const { store } = fresh();
  const before = store.getSnapshot();
  const reasons = [
    store.actions.createPost(draft({ text: "   " })),
    store.actions.createPost(draft({ text: "x".repeat(2001) })),
    store.actions.createPost(
      draft({ text: "x", images: Array(5).fill(pixel) }),
    ),
    store.actions.createPost(
      draft({ text: "x", images: [{ ...pixel, src: "javascript:alert(1)" }] }),
    ),
    store.actions.createPost(
      draft({
        text: "x",
        images: [{ ...pixel, src: "https://example.com/a.png" }],
      }),
    ),
    store.actions.createPost(
      draft({ text: "x", book: { bookId: "missing", purpose: "mention" } }),
    ),
    store.actions.createPost(
      draft({ text: "x", book: { bookId: "momo", purpose: "recommend" } }),
    ),
    store.actions.createPost(
      draft({ images: [pixel], book: { bookId: "momo", purpose: "review" } }),
    ),
    store.actions.createPost(draft({ text: "x", replyTo: "missing" })),
  ].map((result) => (result.ok ? "ok" : result.reason));
  assert.deepEqual(reasons, [
    "empty",
    "too-long",
    "too-many-images",
    "invalid-image",
    "invalid-image",
    "unknown-book",
    "invalid-purpose",
    "review-needs-text",
    "missing-parent",
  ]);
  assert.equal(store.getSnapshot(), before);
});

check("image-only posts are allowed and keep trimmed alt text", () => {
  const { store } = fresh();
  const post = created(
    store.actions.createPost(
      draft({ images: [{ ...pixel, alt: "  積読  " }] }),
    ),
  );
  assert.equal(post.images[0].alt, "積読");
});

check(
  "replies keep the root, a reply's book is always a recommendation",
  () => {
    const { store } = fresh();
    const reply = created(
      store.actions.createPost(
        draft({
          text: "この本も好きかも",
          replyTo: "nagi-re-tou-solaris",
          book: { bookId: "walden", purpose: "review" },
        }),
      ),
    );
    assert.deepEqual(reply.reply, {
      rootId: "tou-solaris",
      parentId: "nagi-re-tou-solaris",
    });
    assert.equal(reply.book?.purpose, "recommend");
    const state = store.getSnapshot();
    assert.ok(!timeline(state, "everyone").includes(reply));
    assert.ok(!reviewsOf(state, "walden").includes(reply));
    assert.equal(recommendationsOf(state, "walden")[0].id, reply.id);
    assert.equal(replyCount(state, "nagi-re-tou-solaris"), 2);
    const root = findPost(state, "tou-solaris")!;
    assert.equal(conversationBelow(state, root).at(-1)?.id, reply.id);
    assert.deepEqual(
      ancestorsOf(state, reply).map((p) => p.id),
      ["tou-solaris", "nagi-re-tou-solaris"],
    );
  },
);

check(
  "spoilers are protected, propagate to replies, and the viewer's report hides a post",
  () => {
    const { store } = fresh();
    const state = store.getSnapshot();
    const spoiler = findPost(state, "nagi-solaris-ending")!;
    assert.equal(protectionOf(state, spoiler), "spoiler");
    assert.equal(
      protectionOf(state, findPost(state, "tou-re-nagi-ending")!),
      "spoiler",
    );
    assert.equal(protectionOf(state, findPost(state, "tou-solaris")!), "none");
    assert.equal(
      store.actions.toggleSpoilerReport("nagi-solaris-ending"),
      false,
    );
    assert.equal(store.actions.toggleSpoilerReport("tou-solaris"), true);
    const reported = store.getSnapshot();
    assert.equal(
      protectionOf(reported, findPost(reported, "tou-solaris")!),
      "reported",
    );
    assert.equal(
      protectionOf(reported, findPost(reported, "nagi-re-tou-solaris")!),
      "reported",
    );
    // Another viewer is unaffected: reports are private until a moderation flow exists.
    assert.equal(
      protectionOf(reported, findPost(reported, "tou-solaris")!, "r-sou"),
      "none",
    );
    assert.equal(store.actions.toggleSpoilerReport("tou-solaris"), true);
    assert.deepEqual(store.getSnapshot().spoilerReports, []);
    assert.equal(store.actions.toggleSpoilerReport("missing"), false);
  },
);

check(
  "authors can flag their own post as a spoiler afterwards, not others' posts",
  () => {
    const { store } = fresh();
    const post = created(
      store.actions.createPost(
        draft({
          text: "結末について",
          book: { bookId: "silence", purpose: "review" },
        }),
      ),
    );
    assert.equal(store.actions.toggleSpoilerReport(post.id), false);
    assert.equal(store.actions.setSpoiler(post.id, true), true);
    assert.equal(
      protectionOf(
        store.getSnapshot(),
        findPost(store.getSnapshot(), post.id)!,
      ),
      "spoiler",
    );
    assert.equal(store.actions.setSpoiler("tou-solaris", true), false);
  },
);

check(
  "likes and 読みたくなった toggle; 読みたくなった needs a book and someone else's post",
  () => {
    const { store } = fresh();
    const likes = reactionCount(store.getSnapshot(), "tou-solaris", "like");
    assert.equal(store.actions.toggleReaction("tou-solaris", "like"), true);
    assert.equal(
      store.actions.toggleReaction("tou-solaris", "wantToRead"),
      true,
    );
    let state = store.getSnapshot();
    assert.equal(reactionCount(state, "tou-solaris", "like"), likes + 1);
    assert.ok(hasReacted(state, "tou-solaris", "wantToRead"));
    assert.equal(
      store.actions.toggleReaction("sou-not-reading", "wantToRead"),
      false,
    );
    const mine = created(
      store.actions.createPost(
        draft({
          text: "自分の本",
          book: { bookId: "momo", purpose: "mention" },
        }),
      ),
    );
    assert.equal(store.actions.toggleReaction(mine.id, "wantToRead"), false);
    assert.equal(store.actions.toggleReaction("missing", "like"), false);
    store.actions.toggleReaction("tou-solaris", "like");
    state = store.getSnapshot();
    assert.equal(reactionCount(state, "tou-solaris", "like"), likes);
  },
);

check(
  "following readers builds the following timeline, including my own posts",
  () => {
    const { store } = fresh();
    assert.equal(store.actions.toggleFollowReader("r-sou"), true);
    assert.equal(store.actions.toggleFollowReader(ME_ID), false);
    assert.equal(store.actions.toggleFollowReader("missing"), false);
    const mine = created(
      store.actions.createPost(draft({ text: "はじめまして" })),
    );
    const following = timeline(store.getSnapshot(), "following");
    assert.ok(following.length > 1);
    assert.ok(
      following.every(
        (post) => post.authorId === "r-sou" || post.id === mine.id,
      ),
    );
  },
);

check(
  "deleting my post removes my reactions to it and leaves replies as a tombstone chain",
  () => {
    const { store } = fresh();
    const root = created(store.actions.createPost(draft({ text: "質問です" })));
    const answer = created(
      store.actions.createPost(draft({ text: "自己レス", replyTo: root.id })),
    );
    store.actions.toggleReaction(root.id, "like");
    assert.equal(store.actions.deletePost("tou-solaris"), false);
    assert.equal(store.actions.deletePost(root.id), true);
    const state = store.getSnapshot();
    assert.equal(findPost(state, root.id), undefined);
    assert.equal(reactionCount(state, root.id, "like"), 0);
    assert.deepEqual(ancestorsOf(state, findPost(state, answer.id)!), [
      { id: root.id, missing: true },
    ]);
    // IDs are never reused, so nothing that pointed at the deleted post can be misattached.
    const next = created(store.actions.createPost(draft({ text: "次" })));
    assert.notEqual(next.id, root.id);
  },
);

check(
  "everything mine survives a reload; demo data is never written to storage",
  () => {
    const { repository, store } = fresh();
    const post = created(
      store.actions.createPost(
        draft({
          text: "保存",
          images: [pixel],
          book: { bookId: "momo", purpose: "review" },
          spoiler: true,
        }),
      ),
    );
    created(
      store.actions.createPost(draft({ text: "返信", replyTo: post.id })),
    );
    store.actions.toggleReaction("tou-solaris", "wantToRead");
    store.actions.toggleFollowReader("r-haru");
    store.actions.toggleSpoilerReport("haru-galaxy");
    const reloaded = createSocialStore(repository, clock);
    reloaded.initialize();
    assert.equal(reloaded.getPersistenceSnapshot(), "saved");
    assert.deepEqual(reloaded.getSnapshot(), store.getSnapshot());
    assert.ok(!repository.raw().includes('tou-solaris","authorId'));
  },
);

check("tampered records are dropped one by one without losing the rest", () => {
  const { repository, store } = fresh();
  const good = created(store.actions.createPost(draft({ text: "残る投稿" })));
  const envelope = JSON.parse(repository.raw());
  envelope.data.posts.push(
    {
      ...good,
      id: "mine-post-50",
      images: [{ ...pixel, src: "javascript:alert(1)" }],
    },
    { ...good, id: "mine-post-51", authorId: "r-nagi" },
    { ...good, id: "tou-solaris" },
    {
      ...good,
      id: "mine-post-52",
      book: { bookId: "momo", purpose: "recommend" },
    },
    {
      ...good,
      id: "mine-post-53",
      reply: { rootId: "wrong-root", parentId: "nagi-re-tou-solaris" },
    },
  );
  envelope.data.reactions.push(
    { postId: "sou-not-reading", kind: "wantToRead" },
    { postId: "missing", kind: "like" },
    { postId: "tou-solaris", kind: "love" },
  );
  envelope.data.following.push("missing", ME_ID);
  envelope.data.spoilerReports.push(good.id, "missing");
  envelope.data.nextPostNumber = 1;
  const loaded = deserializeSocial(JSON.stringify(envelope));
  assert.equal(loaded.status, "recovered");
  assert.deepEqual(
    loaded.data.posts.map((post) => post.id),
    [good.id],
  );
  assert.deepEqual(loaded.data.reactions, []);
  assert.deepEqual(loaded.data.following, []);
  assert.deepEqual(loaded.data.spoilerReports, []);
  assert.equal(loaded.data.nextPostNumber, 2);
  assert.equal(deserializeSocial("{broken").status, "recovered");
  assert.equal(
    deserializeSocial(serializeSocial(emptySocialData())).status,
    "saved",
  );
});

check(
  "a full storage rejects the post instead of keeping it only in memory",
  () => {
    const { store } = fresh(800);
    const before = store.getSnapshot();
    const result = store.actions.createPost(
      draft({ text: "画像つき", images: [pixel, pixel, pixel, pixel] }),
    );
    assert.deepEqual(result, { ok: false, reason: "storage-full" });
    assert.equal(store.getSnapshot(), before);
    assert.ok(store.actions.createPost(draft({ text: "短い" })).ok);
  },
);

check(
  "the browser adapter keeps SNS data within its budget so the town save stays writable",
  () => {
    const heavy: PostImage = {
      ...pixel,
      src: "data:image/jpeg;base64," + "A".repeat(600_000),
    };
    const data = {
      ...emptySocialData(),
      posts: Array.from({ length: 4 }, (_, index) => ({
        id: `mine-post-${index + 1}`,
        authorId: ME_ID,
        createdAt: "2026-10-11T00:00:00.000Z",
        text: "重い画像",
        images: [heavy],
        book: null,
        spoiler: false,
        reply: null,
        demo: false,
      })),
      nextPostNumber: 5,
    };
    assert.ok(serializeSocial(data).length > SOCIAL_STORAGE_BUDGET);
    // Rejected before touching localStorage, in any environment.
    assert.equal(localSocialRepository.save(data), "quota");
    assert.equal(
      localSocialRepository.save({ ...data, posts: data.posts.slice(0, 1) }),
      "unavailable", // No window in Node; under the budget it would be written.
    );
  },
);

check("SSR snapshot stays stable before initialization", () => {
  const store = createSocialStore(createMemorySocialRepository(), clock);
  assert.equal(store.getSnapshot(), seedSocialState);
  assert.equal(store.getServerSnapshot(), seedSocialState);
});

// Wishlist sources live in the town save; they must not disturb existing data.
check(
  "saving from a post records the route once, and unsaving forgets it",
  () => {
    const repository = createMemoryRepository();
    const town = createTownStore(repository, () => "2026-10-11T00:00:00.000Z");
    assert.equal(
      town.actions.saveWishFrom("solaris", {
        kind: "post",
        postId: "tou-solaris",
      }),
      true,
    );
    assert.deepEqual(town.getSnapshot().wishSources, {
      solaris: {
        kind: "post",
        postId: "tou-solaris",
        savedAt: "2026-10-11T00:00:00.000Z",
      },
    });
    // A second route never overwrites the first save.
    assert.equal(
      town.actions.saveWishFrom("solaris", {
        kind: "post",
        postId: "nagi-solaris-ending",
      }),
      false,
    );
    assert.equal(
      town.actions.saveWishFrom("missing", {
        kind: "post",
        postId: "tou-solaris",
      }),
      false,
    );
    assert.deepEqual(
      repository.load().state.wishSources,
      town.getSnapshot().wishSources,
    );
    town.actions.toggleWish("solaris");
    assert.deepEqual(town.getSnapshot().wishlist, []);
    assert.deepEqual(town.getSnapshot().wishSources, {});
    town.actions.toggleWish("solaris");
    assert.deepEqual(town.getSnapshot().wishSources, {});
  },
);

check(
  "old town saves load without sources; orphaned or malformed sources are dropped",
  () => {
    const state = structuredClone(seedState);
    state.wishlist = ["momo", "solaris"];
    const envelope = JSON.parse(serializeTown(state));
    delete envelope.data.wishSources;
    const old = deserializeTown(JSON.stringify(envelope));
    assert.equal(old.status, "saved");
    assert.deepEqual(old.state.wishlist, ["momo", "solaris"]);
    assert.deepEqual(old.state.wishSources, {});
    envelope.data.wishSources = {
      momo: {
        kind: "post",
        postId: "haru-galaxy",
        savedAt: "2026-10-11T00:00:00.000Z",
      },
      solaris: {
        kind: "post",
        postId: "<script>",
        savedAt: "2026-10-11T00:00:00.000Z",
      },
      walden: {
        kind: "post",
        postId: "tou-solaris",
        savedAt: "2026-10-11T00:00:00.000Z",
      },
    };
    const loaded = deserializeTown(JSON.stringify(envelope));
    assert.equal(loaded.status, "saved");
    assert.deepEqual(Object.keys(loaded.state.wishSources), ["momo"]);
  },
);

console.log(`${passed} social checks passed.`);
