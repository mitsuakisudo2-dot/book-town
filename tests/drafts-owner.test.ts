import assert from "node:assert/strict";
import { createKeptDraftStore, keepForOwner } from "../src/lib/kept-draft";
import {
  adoptVisitorPosts,
  createPostDraftStore,
  joinPostDrafts,
  POST_DRAFT_KEY,
  postDraftKey,
  readingDraftKey,
  type PostDraft,
} from "../src/lib/post-draft";
import {
  adoptVisitorPosters,
  POSTER_DRAFT_KEY,
  POSTER_DRAFT_OPTIONS,
  posterWorkFor,
  posterWorkKey,
  type KeptPosterWork,
} from "../src/lib/poster-draft";

// Post and poster drafts are kept by owner, like every other kept draft, and
// what a browser kept before they were is given to the first owner to come.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}
const memory = (entries: Record<string, Record<string, unknown>> = {}) => {
  const data = new Map<string, string>(
    Object.entries(entries).map(([key, drafts]) => [
      key,
      JSON.stringify({ version: 1, drafts }),
    ]),
  );
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
type Memory = ReturnType<typeof memory>;
const storedKeys = (storage: Memory, key: string) =>
  Object.keys(JSON.parse(storage.data.get(key) ?? '{"drafts":{}}').drafts);
const words = (body: string, patch: Partial<PostDraft> = {}): PostDraft => ({
  body,
  bookId: null,
  spoiler: false,
  ...patch,
});
const posterWork = (heading: string, at = "2026-10-12T00:00:00.000Z") =>
  ({
    template: "one_book",
    theme: "kinari",
    font: "mincho",
    pages: [{ heading, text: "", bookIds: ["momo"] }],
    spoiler: false,
    inTimeline: true,
    at,
  }) satisfies KeptPosterWork;
const posterDrafts = (storage: Memory) =>
  createKeptDraftStore(POSTER_DRAFT_OPTIONS, () => storage);

check("post and poster draft keys begin with their owner", () => {
  assert.equal(postDraftKey("u-1"), "u-1:new-post");
  assert.equal(postDraftKey("u-1", { bookId: "momo" }), "u-1:review:momo");
  assert.equal(
    postDraftKey("u-1", { parentId: "p-1", bookId: "momo" }),
    "u-1:reply:p-1",
  );
  assert.equal(readingDraftKey("demo", "s-1"), "demo:reading:s-1");
  assert.equal(posterWorkKey({ owner: "u-1" }), "u-1:new");
  assert.equal(
    posterWorkKey({ owner: "u-1", bookId: "momo" }),
    "u-1:book:momo",
  );
  assert.equal(
    posterWorkKey({ owner: "visitor", posterId: "x-1", bookId: "momo" }),
    "visitor:poster:x-1",
  );
  assert.deepEqual(posterWorkFor("u-1:poster:x-1"), { posterId: "x-1" });
  assert.deepEqual(posterWorkFor("demo:book:momo"), { bookId: "momo" });
  assert.deepEqual(posterWorkFor("demo:new"), {});
  // Only keys with an owner are kept from now on.
  const storage = memory();
  const posts = createPostDraftStore(() => storage);
  for (const key of ["new-post", "review:momo", ":new-post", "u 1:new-post"])
    posts.update(key, { body: "誰の？" });
  const posters = posterDrafts(storage);
  for (const key of ["new", "book:momo", "poster:x-1", ":new"])
    posters.set(key, posterWork("誰の？"));
  assert.equal(storage.data.size, 0);
});

check("another owner on the same browser sees none of the drafts", () => {
  const storage = memory();
  const posts = createPostDraftStore(() => storage);
  posts.update(postDraftKey("u-1"), { body: "Aの書きかけ" });
  posts.update(readingDraftKey("u-1", "s-1"), { body: "Aの読書メモ" });
  const posters = posterDrafts(storage);
  posters.set(posterWorkKey({ owner: "u-1", bookId: "momo" }), posterWork("A"));
  const again = createPostDraftStore(() => storage);
  assert.equal(again.get(postDraftKey("u-2")), null);
  assert.equal(again.get(readingDraftKey("u-2", "s-1")), null);
  assert.equal(again.get(postDraftKey("u-1"))?.body, "Aの書きかけ");
  const postersAgain = posterDrafts(storage);
  assert.equal(
    postersAgain.get(posterWorkKey({ owner: "u-2", bookId: "momo" })),
    null,
  );
  // The other owner's work stays as it was, for when they come back.
  posts.update(postDraftKey("u-2"), { body: "Bの書きかけ" });
  assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY), [
    "u-1:new-post",
    "u-1:reading:s-1",
    "u-2:new-post",
  ]);
});

check("drafts kept before owners are taken once, by the first owner", () => {
  const storage = memory({
    [POST_DRAFT_KEY]: {
      "new-post": words("前からの書きかけ"),
      "review:momo": words("前からの感想"),
      "reading:s-1": words("前からの読書メモ"),
      "reply:p-1": { body: 3 },
      "u-1:review:momo": words("Aがもう書いていた感想"),
    },
    [POSTER_DRAFT_KEY]: {
      new: posterWork("前からのポスター"),
      "book:momo": { ...posterWork("前の版から"), from: "abc" },
    },
  });
  const posts = createPostDraftStore(() => storage);
  posts.initialize();
  // Not shown as they are, to anyone.
  assert.deepEqual(Object.keys(posts.getSnapshot().drafts), [
    "u-1:review:momo",
  ]);
  posts.claim("u-1");
  assert.equal(posts.get("u-1:new-post")?.body, "前からの書きかけ");
  assert.equal(posts.get("u-1:reading:s-1")?.body, "前からの読書メモ");
  // What the owner already keeps under the same key stays theirs.
  assert.equal(posts.get("u-1:review:momo")?.body, "Aがもう書いていた感想");
  assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY).sort(), [
    "u-1:new-post",
    "u-1:reading:s-1",
    "u-1:review:momo",
  ]);
  // Given once: the next owner, here or after a reload, finds none.
  posts.claim("u-2");
  assert.equal(posts.get("u-2:new-post"), null);
  const reloaded = createPostDraftStore(() => storage);
  reloaded.claim("u-2");
  assert.equal(reloaded.get("u-2:new-post"), null);
  assert.equal(reloaded.get("u-2:review:momo"), null);
  // Poster work too, with its time and the mark of the poster it began from.
  const posters = posterDrafts(storage);
  assert.deepEqual(posters.get("demo:new"), posterWork("前からのポスター"));
  assert.equal(posters.get("demo:book:momo")?.from, "abc");
  assert.deepEqual(storedKeys(storage, POSTER_DRAFT_KEY), [
    "demo:new",
    "demo:book:momo",
  ]);
  assert.equal(posterDrafts(storage).get("u-1:new"), null);
});

check("the first owner to write takes the old draft before writing", () => {
  const storage = memory({
    [POST_DRAFT_KEY]: { "new-post": words("前からの書きかけ") },
  });
  const posts = createPostDraftStore(() => storage);
  posts.update("demo:new-post", { spoiler: true });
  assert.deepEqual(posts.get("demo:new-post"), {
    body: "前からの書きかけ",
    bookId: null,
    spoiler: true,
  });
  assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY), ["demo:new-post"]);
});

check("storage that throws does not lose the old drafts", () => {
  const old = { "new-post": words("前からの書きかけ") };
  const full = memory({ [POST_DRAFT_KEY]: old });
  const before = full.data.get(POST_DRAFT_KEY);
  // A full browser turns writes away but still removes what it is told to.
  full.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const posts = createPostDraftStore(() => full);
  posts.claim("u-1");
  // The owner has them on this page; the browser still has them as they were.
  assert.equal(posts.get("u-1:new-post")?.body, "前からの書きかけ");
  assert.equal(posts.getSnapshot().saved, false);
  assert.equal(full.data.get(POST_DRAFT_KEY), before);
  posts.update("u-1:reply:p-1", { body: "返信" });
  posts.clear("u-1:reply:p-1");
  assert.equal(full.data.get(POST_DRAFT_KEY), before);
  // Storage that cannot be read is not written over either.
  const unreadable = memory({ [POST_DRAFT_KEY]: old });
  unreadable.getItem = () => {
    throw new Error("SecurityError");
  };
  const blind = createPostDraftStore(() => unreadable);
  blind.claim("u-1");
  assert.equal(blind.get("u-1:new-post"), null);
  assert.deepEqual(storedKeys(unreadable, POST_DRAFT_KEY), ["new-post"]);
  // Once the browser stores again, the next page takes them.
  const working = memory();
  working.data.set(POST_DRAFT_KEY, before!);
  const next = createPostDraftStore(() => working);
  next.claim("u-1");
  assert.equal(next.get("u-1:new-post")?.body, "前からの書きかけ");
  assert.deepEqual(storedKeys(working, POST_DRAFT_KEY), ["u-1:new-post"]);
});

check("with two tabs open, the old drafts are still taken once", () => {
  const storage = memory({
    [POST_DRAFT_KEY]: { "new-post": words("前からの書きかけ") },
  });
  const first = createPostDraftStore(() => storage);
  const second = createPostDraftStore(() => storage);
  // Both tabs read the browser before either knows whose it is.
  first.initialize();
  second.initialize();
  first.claim("u-1");
  // The second tab, not signed in yet, takes nothing, and does not put the
  // old drafts back when it writes; what the first took stays.
  second.claim("visitor");
  assert.equal(second.get("visitor:new-post"), null);
  second.update("visitor:review:momo", { body: "訪問者の感想" });
  assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY), [
    "u-1:new-post",
    "visitor:review:momo",
  ]);
  // A tab that read the browser before another wrote to it goes by what
  // the browser holds when its owner is known.
  const third = createPostDraftStore(() => storage);
  third.initialize();
  storage.data.set(
    POST_DRAFT_KEY,
    JSON.stringify({
      version: 1,
      drafts: { "u-1:new-post": words("Aの書きかけ"), "new-post": words("x") },
    }),
  );
  third.claim("u-1");
  assert.equal(third.get("u-1:new-post")?.body, "Aの書きかけ");
  assert.equal(third.get("visitor:review:momo"), null);
  third.update("u-1:reply:p-1", { body: "返信" });
  assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY), [
    "u-1:new-post",
    "u-1:reply:p-1",
  ]);
});

check("the old drafts are taken within the post drafts' limit", () => {
  // At most 50 were kept before, so all of them fit.
  const fifty = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [
      "review:b" + index,
      words("感想" + index),
    ]),
  );
  const storage = memory({ [POST_DRAFT_KEY]: fifty });
  const posts = createPostDraftStore(() => storage);
  posts.claim("u-1");
  assert.equal(Object.keys(posts.getSnapshot().drafts).length, 50);
  assert.equal(posts.get("u-1:review:b0")?.body, "感想0");
  // With the owner's own past the limit, the old ones go first.
  const own = Object.fromEntries(
    Array.from({ length: 45 }, (_, index) => [
      "u-1:reply:p" + index,
      words("返信" + index),
    ]),
  );
  const crowded = memory({
    [POST_DRAFT_KEY]: {
      ...Object.fromEntries(Object.entries(fifty).slice(0, 10)),
      ...own,
    },
  });
  const full = createPostDraftStore(() => crowded);
  full.claim("u-1");
  const kept = storedKeys(crowded, POST_DRAFT_KEY);
  assert.equal(kept.length, 50);
  assert.ok(Object.keys(own).every((key) => kept.includes(key)));
  assert.deepEqual(
    kept.filter((key) => key.startsWith("u-1:review:")),
    [5, 6, 7, 8, 9].map((index) => "u-1:review:b" + index),
  );
});

check(
  "a visitor's post and poster drafts go with them into the account",
  () => {
    const storage = memory({
      [POST_DRAFT_KEY]: {
        "visitor:new-post": words("ログイン前の書きかけ"),
        "visitor:reply:p-1": words("ログイン前の返信"),
        "visitor:review:momo": words("訪問者の感想"),
        "u-1:review:momo": words("Aの感想"),
        "u-2:new-post": words("Bの書きかけ"),
      },
      [POSTER_DRAFT_KEY]: {
        "visitor:book:momo": posterWork("訪問者のポスター"),
        "visitor:new": posterWork("訪問者の新しいポスター"),
        "u-1:new": posterWork("Aのポスター"),
      },
    });
    const posts = createPostDraftStore(() => storage);
    adoptVisitorPosts("u-1", posts);
    assert.equal(posts.get("u-1:new-post")?.body, "ログイン前の書きかけ");
    assert.equal(posts.get("u-1:reply:p-1")?.body, "ログイン前の返信");
    assert.equal(posts.get("visitor:new-post"), null);
    // The account's own draft wins; the visitor's waits where it was.
    assert.equal(posts.get("u-1:review:momo")?.body, "Aの感想");
    assert.equal(posts.get("visitor:review:momo")?.body, "訪問者の感想");
    assert.equal(posts.get("u-2:new-post")?.body, "Bの書きかけ");
    assert.equal(posts.get("u-2:reply:p-1"), null);
    const posters = posterDrafts(storage);
    adoptVisitorPosters("u-1", posters);
    assert.deepEqual(
      posters.get("u-1:book:momo"),
      posterWork("訪問者のポスター"),
    );
    assert.equal(posters.get("visitor:book:momo"), null);
    assert.equal(posters.get("u-1:new")?.pages[0].heading, "Aのポスター");
    assert.equal(
      posters.get("visitor:new")?.pages[0].heading,
      "訪問者の新しいポスター",
    );
    // Kept so in the browser, for the next page.
    assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY).sort(), [
      "u-1:new-post",
      "u-1:reply:p-1",
      "u-1:review:momo",
      "u-2:new-post",
      "visitor:review:momo",
    ]);
  },
);

check("a hand-over at the limit lets no other draft go", () => {
  // The browser holds the most it keeps: the account's own drafts and a
  // visitor's, oldest first. Handing over moves drafts, it adds none.
  const drafts: Record<string, PostDraft> = {};
  for (let index = 0; index < 25; index++) {
    drafts["u-1:reply:p" + index] = words("Aの返信" + index);
    drafts["visitor:review:b" + index] = words("訪問者の感想" + index);
  }
  const storage = memory({ [POST_DRAFT_KEY]: drafts });
  const posts = createPostDraftStore(() => storage);
  adoptVisitorPosts("u-1", posts);
  // Each keeps its place: only the visitor's keys change.
  assert.deepEqual(
    storedKeys(storage, POST_DRAFT_KEY),
    Object.keys(drafts).map((key) => key.replace(/^visitor:/, "u-1:")),
  );
  assert.equal(posts.get("u-1:reply:p0")?.body, "Aの返信0");
  assert.equal(posts.get("u-1:review:b0")?.body, "訪問者の感想0");
  // Written after the hand-over, a new draft lets the oldest go, as ever.
  posts.update("u-1:new-post", { body: "新しい投稿" });
  assert.equal(posts.get("u-1:reply:p0"), null);
  assert.equal(Object.keys(posts.getSnapshot().drafts).length, 50);
});

check("words written before the owner was known lose nothing kept", () => {
  const storage = memory({
    [POST_DRAFT_KEY]: {
      "new-post": words("アップデート前の書きかけ"),
      "u-1:review:momo": words("前に残していた感想", { spoiler: true }),
    },
  });
  const posts = createPostDraftStore(() => storage);
  const keep = (key: string, draft: PostDraft) =>
    keepForOwner(posts, key, draft, joinPostDrafts);
  // Nothing kept there: kept as written.
  assert.ok(keep("u-1:reply:p-1", words("返信の言葉")));
  assert.equal(posts.get("u-1:reply:p-1")?.body, "返信の言葉");
  // Kept there already: the new words go after it, on a new line.
  assert.ok(keep("u-1:review:momo", words("確かめるあいだに書いた")));
  assert.deepEqual(posts.get("u-1:review:momo"), {
    body: "前に残していた感想\n確かめるあいだに書いた",
    bookId: null,
    spoiler: true,
  });
  // The old draft taken by the owner on the way is joined the same way.
  assert.ok(keep("u-1:new-post", words("新しい言葉", { bookId: "momo" })));
  assert.deepEqual(posts.get("u-1:new-post"), {
    body: "アップデート前の書きかけ\n新しい言葉",
    bookId: "momo",
    spoiler: false,
  });
  // Nothing new written, or the same words: the kept draft stays as it is.
  const before = storage.data.get(POST_DRAFT_KEY);
  assert.ok(keep("u-1:new-post", words("")));
  assert.ok(keep("u-1:reply:p-1", words("返信の言葉")));
  assert.equal(storage.data.get(POST_DRAFT_KEY), before);
  // Too long for one post together: nothing is kept, and the kept draft is
  // as it was (the screen holds the new words).
  assert.equal(keep("u-1:new-post", words("長".repeat(990))), false);
  assert.equal(storage.data.get(POST_DRAFT_KEY), before);
  // Up to the length of a post, with the new line.
  const half = words("長".repeat(500));
  assert.equal(
    joinPostDrafts(half, words("続".repeat(499)))?.body.length,
    1000,
  );
  assert.equal(joinPostDrafts(half, words("続".repeat(500))), null);
  // Poster work cannot be joined: it is kept only where there is none.
  const posters = posterDrafts(storage);
  posters.set("u-1:new", posterWork("前のポスター"));
  assert.equal(keepForOwner(posters, "u-1:new", posterWork("新しい")), false);
  assert.equal(posters.get("u-1:new")?.pages[0].heading, "前のポスター");
  assert.ok(keepForOwner(posters, "u-1:book:momo", posterWork("新しい")));
  assert.equal(posters.get("u-1:book:momo")?.pages[0].heading, "新しい");
});

check("signing in first takes the old drafts for the account", () => {
  // Written signed out before drafts had owners, then signed in.
  const storage = memory({
    [POST_DRAFT_KEY]: {
      "new-post": words("前からの書きかけ"),
      "visitor:review:momo": words("訪問者の感想"),
    },
  });
  const posts = createPostDraftStore(() => storage);
  adoptVisitorPosts("u-1", posts);
  assert.deepEqual(storedKeys(storage, POST_DRAFT_KEY).sort(), [
    "u-1:new-post",
    "u-1:review:momo",
  ]);
});

console.log(`${passed} owned draft checks passed.`);
