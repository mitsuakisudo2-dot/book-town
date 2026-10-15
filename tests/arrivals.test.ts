import assert from "node:assert/strict";
import { emptyArrived, takeIn, type Arrived } from "../src/lib/arrived";
import {
  BACKOFF_MAX,
  NUDGE_GAP,
  PILL_BUDGET,
  POLL_EVERY,
  createArrivals,
  createLetterReads,
  freshFor,
  olderFrom,
  olderPage,
  sinceOf,
  type ArrivalsClock,
  type ArrivalsTown,
  type LetterReadsTown,
} from "../src/lib/arrivals";
import { seedState } from "../src/lib/data";
import { notificationsFor } from "../src/lib/notifications";
import { OLDER_PAGE, type TownReads } from "../src/lib/town-backend";
import { ME_ID, type Post, type TownState } from "../src/lib/types";

// The 便り that arrive while Home is open (PR 2): they wait outside the town
// until the reader asks, polling runs only while Home shows in view, and the
// pill has eight seconds on screen in all before a dot says it instead. The
// time is a hand-driven clock; the town is a stand-in with the store's
// shape. Everything runs inside main() because tsx compiles this file as
// CommonJS.

const MIN = 60_000;
/** Two days after the demo's newest post. */
const NOW = Date.parse("2026-10-12T12:00:00+09:00");

/** The demo town of a reader who follows ナギ's shop (r-nagi). */
const home = (change: Partial<TownState> = {}): TownState => ({
  ...structuredClone(seedState),
  following: ["shop-orbit"],
  ...change,
});

const letter = (
  id: string,
  authorId: string,
  minutes: number,
  extra: Partial<Post> = {},
): Post => ({
  id,
  authorId,
  body: "便り " + id,
  bookId: null,
  spoiler: false,
  parentId: null,
  createdAt: new Date(NOW + minutes * MIN).toISOString(),
  likes: 0,
  wants: 0,
  readingMode: null,
  ...extra,
});
const came = (...posts: Post[]): Arrived => ({ ...emptyArrived(), posts });
const ids = (arrived: Arrived | null) =>
  arrived?.posts.map((post) => post.id) ?? [];

/** Lets every promise settled so far run its callbacks. */
const flush = () => new Promise<void>((done) => setImmediate(done));

/** A clock whose time moves only when the test says. */
function fakeClock(start = NOW) {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: ArrivalsClock = {
    now: () => now,
    setTimeout(run, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    /** Moves the time on, running each timer when its time comes. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await flush();
        let due: [number, { at: number; run: () => void }] | null = null;
        for (const entry of timers)
          if (entry[1].at <= end && (!due || entry[1].at < due[1].at))
            due = entry;
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
      await flush();
    },
    pending: () => timers.size,
  };
}

type Answer = Arrived | "fail" | Promise<Arrived>;

/** The store as arrivals see it, with reads answered from a queue. */
function fakeTown(start: TownState) {
  let state = start;
  let generation = 1;
  let reading = true;
  /** The `since` of each read asked for. */
  const asked: (string | null)[] = [];
  /** What the next reads answer; an empty queue answers nothing new. */
  const answers: Answer[] = [];
  const absorbed: Arrived[] = [];
  /** What each older read asked for, and what older and by-id reads answer. */
  const olderAsked: { before: string; authors: string[] }[] = [];
  const olderAnswers: Answer[] = [];
  const postAnswers: Answer[] = [];
  let readings = 1;
  const answer = (queue: Answer[]) => {
    const next = queue.shift() ?? emptyArrived();
    return next === "fail"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(next);
  };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const reads = (): TownReads | null =>
    reading
      ? {
          generation,
          newer(since) {
            asked.push(since);
            const answer = answers.shift() ?? emptyArrived();
            if (answer === "fail") return Promise.reject(new Error("offline"));
            return Promise.resolve(answer);
          },
          older(before, authors) {
            olderAsked.push({ before, authors });
            return answer(olderAnswers);
          },
          post: () => answer(postAnswers),
        }
      : null;
  const town: ArrivalsTown & LetterReadsTown = {
    reads,
    state: () => state,
    reading: () => readings,
    absorb(arrived, from) {
      if (from !== generation) return false;
      const next = takeIn(state, arrived);
      if (next === state) return false;
      state = next;
      absorbed.push(arrived);
      notify();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    town,
    asked,
    answers,
    absorbed,
    olderAsked,
    olderAnswers,
    postAnswers,
    state: () => state,
    /** The reader changes the town (a follow): kept, as a commit would. */
    change(next: TownState) {
      state = next;
      notify();
    },
    /** The same town read again (after a refused change). */
    reread(next: TownState) {
      readings += 1;
      state = next;
      notify();
    },
    /** A sign-in or sign-out: another town, read again. */
    switchTown(next: TownState) {
      generation += 1;
      state = next;
      notify();
    },
    /** The demo, or the town still loading: nothing to read. */
    setReading(on: boolean) {
      reading = on;
      notify();
    },
  };
}

function setUp(start = home()) {
  const town = fakeTown(start);
  const time = fakeClock();
  let seen = true;
  const arrivals = createArrivals(town.town, {
    clock: time.clock,
    visible: () => seen,
  });
  return {
    ...town,
    time,
    arrivals,
    /** The page out of view or back, as visibilitychange tells it. */
    see(on: boolean, { nudge = true } = {}) {
      seen = on;
      if (nudge) arrivals.wake();
    },
  };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void> | void) {
    await run();
    passed += 1;
    console.log(`PASS ${name}`);
  }

  await check(
    "reads come every minute only while Home shows and the page is in view",
    async () => {
      const { arrivals, asked, time, see } = setUp();
      await time.advance(5 * MIN);
      assert.equal(asked.length, 0, "nobody watches: no reads");

      const stop = arrivals.watch();
      // The town was just read: the first read waits its minute.
      await time.advance(POLL_EVERY - 1);
      assert.equal(asked.length, 0);
      await time.advance(1);
      assert.equal(asked.length, 1);
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 2);

      see(false);
      await time.advance(10 * MIN);
      assert.equal(asked.length, 2, "out of view: no reads");
      see(true);
      await time.advance(0);
      assert.equal(asked.length, 3, "back in view: a read at once");
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 4);

      stop();
      await time.advance(10 * MIN);
      assert.equal(asked.length, 4, "Home closed: no reads");
      assert.equal(time.pending(), 0, "and no timer left");

      // Back on Home after a while: what came meanwhile is read at once.
      const again = arrivals.watch();
      await time.advance(0);
      assert.equal(asked.length, 5);
      // Two panes watching are one watcher.
      const other = arrivals.watch();
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 6);
      again();
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 7, "one pane still shows");
      other();
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 7);
    },
  );

  await check("a timer that comes due out of view does not read", async () => {
    const { arrivals, asked, time, see } = setUp();
    const stop = arrivals.watch();
    // Out of view without a nudge: not every browser sends one.
    see(false, { nudge: false });
    await time.advance(5 * MIN);
    assert.equal(asked.length, 0);
    see(true);
    await time.advance(0);
    assert.equal(asked.length, 1);
    stop();
  });

  await check(
    "the demo, or a town still loading, has nothing to read",
    async () => {
      const { arrivals, asked, time, setReading } = setUp();
      setReading(false);
      const stop = arrivals.watch();
      arrivals.wake();
      await time.advance(10 * MIN);
      assert.equal(asked.length, 0);
      assert.equal(time.pending(), 0);
      assert.deepEqual(arrivals.getSnapshot(), {
        arrived: null,
        retired: false,
      });
      assert.equal(await arrivals.read(), false);
      assert.deepEqual(await arrivals.refresh(), {
        failed: false,
        taken: null,
      });
      // The town comes: reads start.
      setReading(true);
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 1);
      stop();
    },
  );

  await check(
    "what arrives waits outside the town, each once, never the town's own or the reader's",
    async () => {
      const { arrivals, answers, asked, time, state } = setUp();
      const before = state();
      const stop = arrivals.watch();
      answers.push(
        came(
          letter("n1", "r-nagi", 1),
          seedState.posts[0], // the town has it
          letter("mine", ME_ID, 2), // written here
        ),
      );
      await time.advance(POLL_EVERY);
      assert.deepEqual(ids(arrivals.getSnapshot().arrived), ["n1"]);
      assert.equal(state(), before, "the town itself is untouched");
      // Read from the newest of others' 便り the town has.
      assert.equal(asked[0], "2026-10-10T21:40:00+09:00");

      // The same again, with one more: each once.
      answers.push(came(letter("n1", "r-nagi", 1), letter("n2", "r-tou", 3)));
      await time.advance(POLL_EVERY);
      assert.deepEqual(ids(arrivals.getSnapshot().arrived), ["n1", "n2"]);
      // From the newest waiting.
      assert.equal(asked[1], letter("n1", "r-nagi", 1).createdAt);

      // Only what waits already: nothing new, the same snapshot.
      const snapshot = arrivals.getSnapshot();
      let told = 0;
      const unlisten = arrivals.subscribe(() => (told += 1));
      answers.push(came(letter("n2", "r-tou", 3)));
      assert.equal(await arrivals.read(), false);
      assert.equal(arrivals.getSnapshot(), snapshot);
      assert.equal(told, 0);
      unlisten();
      assert.equal(asked[2], letter("n2", "r-tou", 3).createdAt);
      stop();
    },
  );

  await check("two reads asked at once are one read", async () => {
    const { arrivals, answers, asked, time } = setUp();
    let answer!: (arrived: Arrived) => void;
    answers.push(new Promise<Arrived>((done) => (answer = done)));
    const first = arrivals.read();
    const second = arrivals.read();
    assert.equal(first, second);
    assert.equal(asked.length, 1);
    answer(came(letter("n1", "r-nagi", 1)));
    assert.equal(await first, true);
    await time.advance(0);
    assert.deepEqual(ids(arrivals.getSnapshot().arrived), ["n1"]);
  });

  await check(
    "after a failure reads wait twice as long, up to ten minutes, and a nudge reads at once",
    async () => {
      const { arrivals, answers, asked, time } = setUp();
      answers.push("fail", "fail", "fail", "fail", "fail", "fail");
      const stop = arrivals.watch();
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 1);
      const waits = [2, 4, 8, 10, 10].map((minutes) => minutes * MIN);
      for (const wait of waits) {
        const count: number = asked.length;
        await time.advance(wait - 1);
        assert.equal(asked.length, count, `not before ${wait / MIN} min`);
        await time.advance(1);
        assert.equal(asked.length, count + 1, `after ${wait / MIN} min`);
      }
      assert.equal(waits.at(-1), BACKOFF_MAX);
      // The network is back: a nudge reads at once, failures or not long ago.
      await time.advance(1000);
      arrivals.wake();
      await time.advance(0);
      assert.equal(asked.length, 7);
      // That read went well: back to every minute.
      await time.advance(POLL_EVERY);
      assert.equal(asked.length, 8);
      stop();
    },
  );

  await check("a nudge just after a read waits its turn", async () => {
    const { arrivals, asked, time } = setUp();
    const stop = arrivals.watch();
    await time.advance(POLL_EVERY);
    assert.equal(asked.length, 1);
    await time.advance(NUDGE_GAP - 1);
    arrivals.wake(); // pageshow, online
    await time.advance(0);
    assert.equal(asked.length, 1);
    await time.advance(1);
    arrivals.wake();
    await time.advance(0);
    assert.equal(asked.length, 2);
    // The minute counts from that read.
    await time.advance(POLL_EVERY - 1);
    assert.equal(asked.length, 2);
    await time.advance(1);
    assert.equal(asked.length, 3);
    stop();
  });

  await check(
    "the pill has eight seconds on screen in all, across its showings, then a dot",
    async () => {
      const { arrivals, answers, time, see } = setUp();
      arrivals.shown(true);
      // Nothing waits: the time does not run.
      await time.advance(20_000);
      answers.push(came(letter("n1", "r-nagi", 1)));
      await arrivals.read();
      assert.equal(arrivals.getSnapshot().retired, false);

      await time.advance(5_000);
      arrivals.shown(false); // the reader scrolled down: the bar hid it
      await time.advance(10 * MIN);
      assert.equal(arrivals.getSnapshot().retired, false);
      arrivals.shown(true);
      await time.advance(1_000);
      // Out of view does not count either.
      see(false);
      await time.advance(10 * MIN);
      assert.equal(arrivals.getSnapshot().retired, false);
      see(true);
      await time.advance(PILL_BUDGET - 6_000 - 1);
      assert.equal(arrivals.getSnapshot().retired, false);
      await time.advance(1);
      assert.equal(arrivals.getSnapshot().retired, true, "the dot");
      assert.deepEqual(ids(arrivals.getSnapshot().arrived), ["n1"]);

      // More arriving keeps the dot; the pill does not come back.
      answers.push(came(letter("n2", "r-nagi", 2)));
      await arrivals.read();
      assert.equal(arrivals.getSnapshot().retired, true);
      assert.deepEqual(ids(arrivals.getSnapshot().arrived), ["n1", "n2"]);
      arrivals.shown(false);
    },
  );

  await check(
    "a tap takes all that waits into the town, and the pill starts over",
    async () => {
      const { arrivals, answers, time, absorbed, state } = setUp();
      arrivals.shown(true);
      answers.push(came(letter("n1", "r-nagi", 1), letter("n0", "r-tou", -30)));
      await arrivals.read();
      await time.advance(PILL_BUDGET);
      assert.equal(arrivals.getSnapshot().retired, true);

      const taken = arrivals.take();
      assert.deepEqual(ids(taken), ["n1", "n0"]);
      assert.equal(absorbed.length, 1, "by the town's absorb");
      assert.deepEqual(arrivals.getSnapshot(), {
        arrived: null,
        retired: false,
      });
      // In the town's order: oldest first, the new at the end.
      assert.deepEqual(
        state()
          .posts.slice(-2)
          .map((post) => post.id),
        ["n0", "n1"],
      );
      // Taking again takes nothing.
      assert.equal(arrivals.take(), null);
      assert.equal(absorbed.length, 1);

      // The next one gets its eight seconds again.
      answers.push(came(letter("n3", "r-nagi", 3)));
      await arrivals.read();
      await time.advance(PILL_BUDGET - 1);
      assert.equal(arrivals.getSnapshot().retired, false);
      await time.advance(1);
      assert.equal(arrivals.getSnapshot().retired, true);
      arrivals.shown(false);
    },
  );

  await check(
    "what waits for one town is let go when another comes",
    async () => {
      const { arrivals, answers, absorbed, switchTown, time } = setUp();
      const stop = arrivals.watch();
      answers.push(came(letter("n1", "r-nagi", 1)));
      await time.advance(POLL_EVERY);
      assert.deepEqual(ids(arrivals.getSnapshot().arrived), ["n1"]);
      switchTown(home({ following: [] })); // signed out
      assert.equal(arrivals.getSnapshot().arrived, null);
      assert.equal(arrivals.take(), null);
      assert.equal(absorbed.length, 0);

      // A read on its way while the town changes is dropped.
      let answer!: (arrived: Arrived) => void;
      answers.push(new Promise<Arrived>((done) => (answer = done)));
      const reading = arrivals.read();
      switchTown(home());
      answer(came(letter("n2", "r-nagi", 2)));
      assert.equal(await reading, false);
      assert.equal(arrivals.getSnapshot().arrived, null);
      stop();
    },
  );

  await check(
    "a pull reads now and takes all that came, even when the read fails",
    async () => {
      const { arrivals, answers, absorbed } = setUp();
      answers.push(came(letter("n1", "r-nagi", 1)));
      await arrivals.read();
      answers.push("fail");
      const failed = await arrivals.refresh();
      assert.equal(failed.failed, true);
      assert.deepEqual(ids(failed.taken), ["n1"]);
      answers.push(came(letter("n2", "r-nagi", 2)));
      const pulled = await arrivals.refresh();
      assert.equal(pulled.failed, false);
      assert.deepEqual(ids(pulled.taken), ["n2"]);
      const none = await arrivals.refresh();
      assert.deepEqual(none, { failed: false, taken: null });
      assert.equal(absorbed.length, 2);
    },
  );

  await check(
    "the pill and the dot count only new 便り each pane would show at its top",
    () => {
      const town = home();
      const arrived = came(
        letter("followed", "r-nagi", 1),
        letter("other", "r-tou", 2),
        letter("reply", "r-nagi", 3, { parentId: "p-1" }),
        letter("mine", ME_ID, 4),
        seedState.posts[0],
      );
      const fresh = freshFor(town, arrived, NOW);
      // Ten days quiet but for five 便り: ホーム tops up with 「街の便り」,
      // and the other reader's shows there.
      assert.deepEqual(
        fresh.home.map((entry) => entry.id),
        ["followed", "other"],
      );
      // 便りだけ is the followed ones only.
      assert.deepEqual(
        fresh.letters.map((entry) => entry.id),
        ["followed"],
      );
      // One more followed makes six of late: no 「街の便り」, so the other
      // reader's would not show on ホーム.
      const busy = freshFor(
        town,
        came(...arrived.posts, letter("followed2", "r-nagi", 5)),
        NOW,
      );
      assert.deepEqual(
        busy.home.map((entry) => entry.id),
        ["followed2", "followed"],
      );
      // Nothing new: nothing for either.
      assert.deepEqual(freshFor(town, came(seedState.posts[0]), NOW), {
        home: [],
        letters: [],
      });
      assert.deepEqual(freshFor(town, null, NOW), { home: [], letters: [] });
    },
  );

  await check("reads start from the newest of others' 便り", () => {
    const town = home();
    assert.equal(sinceOf(town, null), "2026-10-10T21:40:00+09:00");
    // The reader's own carry this device's time: never the start.
    const mine = { ...town, posts: [...town.posts, letter("m", ME_ID, 60)] };
    assert.equal(sinceOf(mine, null), "2026-10-10T21:40:00+09:00");
    assert.equal(
      sinceOf(town, came(letter("n1", "r-nagi", 1))),
      letter("n1", "r-nagi", 1).createdAt,
    );
    assert.equal(sinceOf({ ...town, posts: [] }, null), null);
  });

  await check(
    "taking in keeps what is there in place and needs a known writer, book and post",
    () => {
      const town = home();
      const next = takeIn(
        town,
        came(
          letter("ok", "r-nagi", 1, { bookId: "solaris" }),
          letter("stranger", "r-unknown", 2),
          letter("no-book", "r-nagi", 3, { bookId: "no-such-book" }),
          letter("orphan", "r-tou", 4, { parentId: "gone" }),
          letter("reply", "r-tou", 5, { parentId: "ok" }),
          letter("early", "r-tou", -60 * 24 * 3),
        ),
      );
      const added = next.posts
        .filter((post) => !town.posts.includes(post))
        .map((post) => post.id);
      assert.deepEqual(added.sort(), ["early", "ok", "reply"]);
      // What was there keeps its order.
      assert.deepEqual(
        next.posts
          .filter((post) => town.posts.includes(post))
          .map((post) => post.id),
        town.posts.map((post) => post.id),
      );
      // The same twice changes nothing.
      assert.equal(takeIn(next, came(letter("ok", "r-nagi", 1))), next);
    },
  );

  await check(
    "便りだけ's older pages start below the oldest followed 便り read in order",
    () => {
      const uuid = (n: number) =>
        `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const followed = letter(uuid(1), "r-nagi", -60);
      const older = letter(uuid(2), "r-nagi", -120);
      const others = letter(uuid(3), "r-tou", -600);
      const linked = letter(uuid(4), "r-nagi", -60 * 24 * 90);
      const reply = letter(uuid(5), "r-nagi", -900, { parentId: uuid(3) });
      const town = home({
        // The demo's own posts carry readable ids: never read from the
        // database, so never where a page starts.
        posts: [...seedState.posts, linked, others, reply, older, followed],
      });
      // Not one read after the town (opened by a link, or an older page),
      // nor others' or replies.
      assert.equal(
        olderFrom({ ...town, readAfter: { [linked.id]: "alone" } }, NOW),
        older.createdAt,
      );
      assert.equal(
        olderFrom({ ...town, readAfter: { [linked.id]: "older" } }, NOW),
        older.createdAt,
      );
      assert.equal(olderFrom(town, NOW), linked.createdAt);
      // Following nobody with 便り read: below the oldest post read.
      assert.equal(
        olderFrom(home({ following: [], posts: [others, reply] }), NOW),
        reply.createdAt,
      );
      // Nothing read: from now.
      assert.equal(
        olderFrom(home({ posts: [] }), NOW),
        new Date(NOW).toISOString(),
      );

      // A page: its 便り as 便りだけ shows them, the last when short.
      const page = came(older, followed, others, reply);
      const { entries, done } = olderPage(town, page);
      assert.deepEqual(
        entries.map((entry) => entry.id),
        [followed.id, older.id],
      );
      assert.equal(done, true);
      const full = came(
        ...Array.from({ length: OLDER_PAGE }, (_, n) =>
          letter(uuid(100 + n), "r-nagi", -1000 - n),
        ),
      );
      assert.equal(olderPage(takeIn(town, full), full).done, false);
      assert.equal(
        olderPage(takeIn(town, full), full).entries.length,
        OLDER_PAGE,
      );
    },
  );

  await check(
    "posts read after the town by the reader's asking make no notices",
    () => {
      const uuid = (n: number) =>
        `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const DAY = 60 * 24;
      const town = home();
      const ids = (state: TownState) =>
        notificationsFor(state).map((notice) => notice.id);
      // An older page: the reader's own old 便り with a like and a 読みたい,
      // a reply to it, and a followed writer's old 便り.
      const mine = letter(uuid(10), ME_ID, -60 * DAY, {
        wants: 2,
        likers: [
          {
            readerId: "r-nagi",
            taps: 1,
            at: letter("x", ME_ID, -59 * DAY).createdAt,
          },
        ],
      });
      const reply = letter(uuid(11), "r-tou", -59 * DAY, {
        parentId: mine.id,
      });
      const theirs = letter(uuid(12), "r-nagi", -61 * DAY);
      const page = came(mine, reply, theirs);
      const paged = takeIn(town, { ...page, how: "older" });
      assert.deepEqual(paged.readAfter, {
        [mine.id]: "older",
        [reply.id]: "older",
        [theirs.id]: "older",
      });
      assert.deepEqual(ids(paged), ids(town));
      // Taken in unmarked, the same posts would each make one: the marks
      // are what keep them out.
      const unmarked = ids(takeIn(town, page)).filter(
        (id) => !ids(town).includes(id),
      );
      assert.deepEqual(unmarked.sort(), [
        "follow:" + theirs.id,
        `like:${mine.id}:r-nagi`,
        "reply:" + reply.id,
        `wants:${mine.id}:2`,
      ]);

      // One 便り opened by its id: it and its old replies are marked, a
      // reply written since the town was read is new, and tells.
      const linked = letter(uuid(13), ME_ID, -90 * DAY);
      const oldReply = letter(uuid(14), "r-tou", -89 * DAY, {
        parentId: linked.id,
      });
      const newReply = letter(uuid(15), "r-tou", 30, { parentId: linked.id });
      const alone = takeIn(town, {
        ...came(linked, oldReply, newReply),
        how: "alone",
      });
      assert.deepEqual(alone.readAfter, {
        [linked.id]: "alone",
        [oldReply.id]: "alone",
      });
      const told = ids(alone).filter((id) => !ids(town).includes(id));
      assert.deepEqual(told, ["reply:" + newReply.id]);
      // An older page bringing it again takes it in order.
      const later = takeIn(alone, { ...came(linked), how: "older" });
      assert.equal(later.readAfter?.[linked.id], "older");
      assert.equal(takeIn(later, { ...came(linked), how: "older" }), later);
    },
  );

  await check(
    "older pages go on from the last, start again for a writer followed since, and stop when done",
    async () => {
      const uuid = (n: number) =>
        `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const floor = letter(uuid(1), "r-nagi", -60 * 24 * 10);
      const start = home({ posts: [...seedState.posts, floor] });
      const t = fakeTown(start);
      const letters = createLetterReads(t.town);
      const page = (from: number, count: number, author = "r-nagi") =>
        came(
          ...Array.from({ length: count }, (_, n) =>
            letter(uuid(from + n), author, -60 * 24 * 11 - (from + n)),
          ),
        );
      const first = page(100, OLDER_PAGE);
      t.olderAnswers.push(first);
      const one = await letters.older(NOW);
      assert.deepEqual(t.olderAsked[0], {
        before: floor.createdAt,
        authors: [ME_ID, "r-nagi"],
      });
      assert.equal(one?.done, false);
      assert.equal(one?.entries.length, OLDER_PAGE);
      const oldest = first.posts.at(-1)!.createdAt;
      assert.deepEqual(t.state().olderRead, {
        authors: [ME_ID, "r-nagi"],
        before: oldest,
        done: false,
      });
      // The next goes on below the last page, not from the town's floor.
      t.olderAnswers.push(page(200, 3));
      const two = await letters.older(NOW);
      assert.equal(t.olderAsked[1].before, oldest);
      assert.equal(two?.done, true);
      assert.equal(two?.entries.length, 3);
      // Done: nothing more is asked.
      assert.deepEqual(await letters.older(NOW), { entries: [], done: true });
      assert.equal(t.olderAsked.length, 2);
      // Following another shop since: from the town's own reading again,
      // for all the writers, so none of the new writer's are skipped.
      t.change({ ...t.state(), following: ["shop-orbit", "shop-rain"] });
      t.olderAnswers.push(page(300, 2, "r-sumire"));
      await letters.older(NOW);
      assert.deepEqual(t.olderAsked[2], {
        before: floor.createdAt,
        authors: [ME_ID, "r-nagi", "r-sumire"],
      });
      // Following fewer goes on as before (it was done).
      t.change({ ...t.state(), following: ["shop-orbit"] });
      assert.deepEqual(await letters.older(NOW), { entries: [], done: true });
      assert.equal(t.olderAsked.length, 3);
    },
  );

  await check(
    "older and by-id reads are dropped when the town is read again meanwhile",
    async () => {
      const uuid = (n: number) =>
        `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const t = fakeTown(home());
      const letters = createLetterReads(t.town);
      const old = letter(uuid(1), "r-nagi", -60 * 24 * 40);
      const reply = letter(uuid(2), "r-tou", -60 * 24 * 39, {
        parentId: old.id,
      });
      // One by its id: taken in, marked as read alone.
      t.postAnswers.push(came(old, reply));
      assert.equal(await letters.post(old.id), true);
      assert.equal(t.state().readAfter?.[old.id], "alone");
      assert.equal(t.state().readAfter?.[reply.id], "alone");
      // The town read again (a refused change) while a read was on its way:
      // what came is not put into the new reading.
      const fresh = home();
      let resolve: (arrived: Arrived) => void = () => {};
      t.postAnswers.push(new Promise<Arrived>((done) => (resolve = done)));
      const asked = letters.post(old.id);
      t.reread(fresh);
      resolve(came(old, reply));
      assert.equal(await asked, false);
      assert.equal(t.state(), fresh);
      t.olderAnswers.push(new Promise<Arrived>((done) => (resolve = done)));
      const page = letters.older(NOW);
      t.reread(home());
      resolve(came(old));
      assert.equal(await page, null);
      assert.equal(t.state().olderRead, undefined);
      // Another town (a sign-out) likewise.
      t.olderAnswers.push(new Promise<Arrived>((done) => (resolve = done)));
      const other = letters.older(NOW);
      t.switchTown(home());
      resolve(came(old));
      assert.equal(await other, null);
      assert.equal(t.state().posts.includes(old), false);
      // A failed read says so; nothing changes.
      t.postAnswers.push("fail");
      await assert.rejects(letters.post(old.id));
      t.olderAnswers.push("fail");
      await assert.rejects(letters.older(NOW));
      // The demo reads none.
      t.setReading(false);
      assert.equal(await letters.post(old.id), false);
      assert.equal(await letters.older(NOW), null);
    },
  );

  await check(
    "what waited for a town left is gone before Home shows again",
    async () => {
      const { arrivals, answers, time, switchTown, setReading } = setUp();
      let stop = arrivals.watch();
      answers.push(came(letter("n1", "r-nagi", 1)));
      await time.advance(POLL_EVERY);
      assert.ok(arrivals.getSnapshot().arrived);
      stop();
      // Signed in as another, away from Home: nobody heard it.
      switchTown(home({ following: ["shop-rain"] }));
      assert.ok(arrivals.getSnapshot().arrived);
      // Back on Home within the minute: nothing of the other town waits.
      stop = arrivals.watch();
      assert.equal(arrivals.getSnapshot().arrived, null);
      stop();
      // Likewise while a town is on its way.
      answers.push(came(letter("n2", "r-sumire", 2)));
      stop = arrivals.watch();
      await time.advance(POLL_EVERY);
      assert.ok(arrivals.getSnapshot().arrived);
      stop();
      setReading(false);
      stop = arrivals.watch();
      assert.equal(arrivals.getSnapshot().arrived, null);
      stop();
    },
  );

  console.log(`${passed} arrivals checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
