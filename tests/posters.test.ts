import assert from "node:assert/strict";
import { demoPosters, seedState } from "../src/lib/data";
import {
  cleanPosterDraft,
  emptyPage,
  FOLDED_POSTER_NAMES,
  OWN_POSTER_REVIEW_WORDS,
  pagesFromRows,
  pagesToRows,
  pageRowBookIds,
  posterBookIds,
  posterProblem,
  postersLeftOutOfBook,
  postersOf,
  postersOfBook,
  posterSpoilerView,
  posterThumbName,
  posterTitle,
  restorePoster,
  timelinePosters,
  POSTER_LIMITS,
  type Poster,
  type PosterDraft,
} from "../src/lib/posters";
import { notificationsFor } from "../src/lib/notifications";
import { posterPath } from "../src/lib/paths";
import { createMemoryRepository } from "../src/lib/repository";
import {
  reviewCoverOf,
  reviewCoverWords,
  reviewNoteOf,
  reviewNoteWords,
} from "../src/lib/social";
import { createTownStore } from "../src/lib/store";
import type { FiledReport } from "../src/lib/supabase/reports";
import { ME_ID, type SpoilerDisplay, type TownState } from "../src/lib/types";

// Checks how a poster is made, kept and found. Everything runs inside main()
// because tsx compiles this file as CommonJS.

const books = new Set(seedState.books.map((book) => book.id));

const draft = (fields: Partial<PosterDraft> = {}): PosterDraft => ({
  template: "lineup",
  theme: "navy",
  font: "mincho",
  pages: [
    { heading: "夜の本", text: "眠れない夜に。", bookIds: ["solaris", "momo"] },
  ],
  spoiler: false,
  inTimeline: true,
  status: "published",
  ...fields,
});

/** A poster of the viewer's own, put up, marked as a spoiler. */
const ownSpoiler: Poster = {
  ...draft({
    template: "one_book",
    spoiler: true,
    pages: [
      { heading: "最後に", text: "結末の話。", bookIds: ["hundred-years"] },
    ],
  }),
  id: "me-poster-1",
  authorId: ME_ID,
  createdAt: "2026-10-13T00:00:00Z",
  updatedAt: "2026-10-13T00:00:00Z",
};
const withSetting = (spoilerDisplay: SpoilerDisplay): TownState => ({
  ...seedState,
  posters: [...seedState.posters, ownSpoiler],
  settings: { ...seedState.settings, spoilerDisplay },
});

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  console.log("PASS " + name);
}

async function main() {
  await check("the 見本's posters are whole and can be put up", () => {
    assert.ok(demoPosters.length >= 3);
    for (const poster of demoPosters) {
      const clean = cleanPosterDraft(poster, books);
      assert.ok(clean, poster.id);
      assert.equal(posterProblem(clean), null, poster.id);
    }
  });

  await check(
    "a poster's fields are kept only as far as they are well formed",
    () => {
      assert.deepEqual(
        cleanPosterDraft(
          draft({
            pages: [{ heading: "  夜の本 ", text: " ", bookIds: ["solaris"] }],
          }),
          books,
        )?.pages,
        [{ heading: "夜の本", text: "", bookIds: ["solaris"] }],
      );
      for (const bad of [
        draft({ template: "ranking" as never }),
        draft({ theme: "neon" as never }),
        draft({ font: "comic" as never }),
        draft({ pages: [] }),
        draft({
          pages: Array.from({ length: POSTER_LIMITS.pages + 1 }, emptyPage),
        }),
        draft({ pages: [{ ...emptyPage(), heading: "あ".repeat(61) }] }),
        draft({ pages: [{ ...emptyPage(), text: "あ".repeat(2001) }] }),
        draft({ pages: [{ ...emptyPage(), bookIds: ["no-such-book"] }] }),
        draft({ pages: [{ ...emptyPage(), bookIds: ["momo", "momo"] }] }),
        draft({
          template: "one_book",
          pages: [{ ...emptyPage(), bookIds: ["momo", "solaris"] }],
        }),
        draft({
          template: "text",
          pages: [{ ...emptyPage(), bookIds: ["momo"] }],
        }),
      ])
        assert.equal(cleanPosterDraft(bad, books), null, JSON.stringify(bad));
      // Only "draft" keeps a poster to its maker.
      assert.equal(
        cleanPosterDraft({ ...draft(), status: "nope" }, books)?.status,
        "published",
      );
    },
  );

  await check("what a poster still needs, in the maker's words", () => {
    assert.equal(posterProblem(draft()), null);
    assert.equal(
      posterProblem(
        draft({ pages: [{ heading: "夜", text: "", bookIds: ["momo"] }] }),
      ),
      "本を2冊以上選んでください。",
    );
    assert.equal(
      posterProblem(
        draft({
          pages: [{ heading: "", text: "", bookIds: ["momo", "solaris"] }],
        }),
      ),
      "見出しを書いてください。",
    );
    assert.equal(
      posterProblem(
        draft({
          template: "one_book",
          pages: [
            { heading: "", text: "好き", bookIds: ["momo"] },
            { heading: "", text: "", bookIds: [] },
          ],
        }),
      ),
      "2ページ目に、本を1冊選んでください。",
    );
    assert.equal(
      posterProblem(
        draft({
          template: "one_book",
          pages: [{ heading: "", text: "", bookIds: ["momo"] }],
        }),
      ),
      "ひとことを書いてください。",
    );
    assert.equal(
      posterProblem(draft({ template: "text", pages: [emptyPage()] })),
      "見出しか本文を書いてください。",
    );
  });

  await check("a poster is named by its heading, or else its book", () => {
    const shelf = seedState.books;
    assert.equal(posterTitle(draft(), shelf), "夜の本");
    assert.equal(
      posterTitle(
        draft({ pages: [{ heading: "", text: "", bookIds: ["momo"] }] }),
        shelf,
      ),
      "『モモ』",
    );
    assert.deepEqual(
      posterBookIds(
        draft({
          pages: [
            { heading: "", text: "", bookIds: ["momo", "solaris"] },
            { heading: "", text: "", bookIds: ["solaris", "walden"] },
          ],
        }),
      ),
      ["momo", "solaris", "walden"],
    );
  });

  await check("pages go to the database as blocks and come back", () => {
    const pages = [
      { heading: "夜の本", text: "眠れない夜に。", bookIds: ["solaris"] },
      { heading: "", text: "続き", bookIds: [] },
    ];
    const rows = pagesToRows(pages, (id) => "row-" + id);
    assert.deepEqual(rows, [
      {
        blocks: [
          { type: "heading", text: "夜の本" },
          { type: "books", book_ids: ["row-solaris"] },
          { type: "text", text: "眠れない夜に。" },
        ],
      },
      { blocks: [{ type: "text", text: "続き" }] },
    ]);
    assert.deepEqual(pageRowBookIds(rows), ["row-solaris"]);
    assert.deepEqual(
      pagesFromRows(rows, (id) => id.replace("row-", "")),
      pages,
    );
    assert.equal(pagesFromRows({ blocks: [] }), null);
    assert.equal(pagesFromRows([{ title: "x" }]), null);
  });

  await check("a kept poster loses a book that is gone, not itself", () => {
    const poster = restorePoster(
      {
        ...draft({
          pages: [{ heading: "夜", text: "", bookIds: ["momo", "gone"] }],
        }),
        id: "me-poster-1",
        authorId: ME_ID,
        createdAt: "2026-10-13T00:00:00Z",
      },
      books,
    );
    assert.deepEqual(poster?.pages[0].bookIds, ["momo"]);
    assert.equal(poster?.updatedAt, "2026-10-13T00:00:00Z");
    assert.equal(restorePoster({ ...draft(), id: "x" }, books), null);
  });

  await check("drafts are their maker's; a book's posters lead with it", () => {
    const state = {
      ...seedState,
      posters: [
        ...seedState.posters,
        {
          ...draft({ status: "draft" }),
          id: "me-poster-1",
          authorId: ME_ID,
          createdAt: "2026-10-13T00:00:00Z",
          updatedAt: "2026-10-13T00:00:00Z",
        },
        {
          ...draft({
            pages: [
              { heading: "前", text: "", bookIds: ["walden", "momo"] },
              { heading: "後", text: "", bookIds: ["solaris", "fahrenheit"] },
            ],
          }),
          id: "poster-late",
          authorId: "r-sou",
          createdAt: "2026-10-13T09:00:00Z",
          updatedAt: "2026-10-13T09:00:00Z",
        },
      ],
    };
    assert.deepEqual(
      postersOf(state, ME_ID).map((poster) => poster.id),
      ["me-poster-1"],
    );
    assert.deepEqual(
      postersOf(state, "r-sou").map((poster) => poster.id),
      ["poster-late", "poster-sou-slow"],
    );
    // Others never see a draft, not even on a book's page.
    assert.ok(
      !postersOfBook(state, "momo").some(
        (poster) => poster.id === "me-poster-1",
      ),
    );
    // Solaris is on the first page of 凪's poster, on the second of the later one.
    assert.deepEqual(
      postersOfBook(state, "solaris").map((poster) => poster.id),
      ["poster-nagi-night-sf", "poster-late"],
    );
  });

  await check(
    "a reader who leaves spoilers out is not shown others' spoiler posters",
    () => {
      const haru = "poster-haru-last-page";
      const ids = (posters: Poster[]) => posters.map((poster) => poster.id);
      // 印あり: behind its door for one who folds, open for one who shows
      // all (けにーさん 10-16 05:43Z); listed for both.
      for (const mode of ["show_all", "fold_possible"] as const) {
        const state = withSetting(mode);
        const poster = state.posters.find((entry) => entry.id === haru)!;
        assert.equal(
          posterSpoilerView(state, poster),
          mode === "show_all" ? "open" : "folded",
          mode,
        );
        assert.ok(ids(timelinePosters(state)).includes(haru), mode);
        assert.ok(ids(postersOf(state, "r-haru")).includes(haru), mode);
        assert.ok(
          ids(postersOfBook(state, "hundred-years")).includes(haru),
          mode,
        );
        assert.equal(postersLeftOutOfBook(state, "hundred-years"), false);
      }
      // 出さない: not on the timeline, the maker's profile or the book's page,
      // which says once that some were left out.
      const state = withSetting("leave_out");
      const poster = state.posters.find((entry) => entry.id === haru)!;
      assert.equal(posterSpoilerView(state, poster), "left_out");
      assert.ok(!ids(timelinePosters(state)).includes(haru));
      assert.ok(!ids(postersOf(state, "r-haru")).includes(haru));
      assert.ok(!ids(postersOfBook(state, "hundred-years")).includes(haru));
      assert.equal(postersLeftOutOfBook(state, "hundred-years"), true);
      assert.equal(postersLeftOutOfBook(state, "solaris"), false);
      // Posters without the mark are as they were.
      const nagi = state.posters.find(
        (entry) => entry.id === "poster-nagi-night-sf",
      )!;
      assert.equal(posterSpoilerView(state, nagi), "open");
      assert.ok(ids(timelinePosters(state)).includes(nagi.id));
      // The maker always sees their own, behind its door.
      assert.equal(posterSpoilerView(state, ownSpoiler), "folded");
      assert.ok(ids(timelinePosters(state)).includes(ownSpoiler.id));
      assert.ok(ids(timelinePosters(state, true)).includes(ownSpoiler.id));
      assert.ok(ids(postersOf(state, ME_ID)).includes(ownSpoiler.id));
      assert.ok(
        ids(postersOfBook(state, "hundred-years")).includes(ownSpoiler.id),
      );
      // Following nobody, the timeline's フォロー中 has the viewer's own only.
      assert.deepEqual(ids(timelinePosters(withSetting("show_all"), true)), [
        ownSpoiler.id,
      ]);
    },
  );

  await check(
    "a poster folded by reports is covered for others and explained to its maker",
    () => {
      const filed: FiledReport = {
        id: "report-1",
        kind: "poster",
        targetId: "poster-sumire-weekend",
        reason: "spam",
        status: "checked",
        createdAt: "2026-10-13T01:00:00Z",
        statusAt: "2026-10-13T02:00:00Z",
      };
      const state: TownState = {
        ...withSetting("fold_possible"),
        reviewFolds: {
          "poster:poster-nagi-night-sf": {
            state: "folded",
            since: "2026-10-13T02:00:00Z",
          },
          "poster:me-poster-1": {
            state: "held",
            since: "2026-10-13T02:00:00Z",
          },
        },
        myReports: [filed],
      };
      const cover = (id: string) => {
        const poster = state.posters.find((entry) => entry.id === id)!;
        return reviewCoverOf(state, "poster", id, poster.authorId);
      };
      const note = (id: string) => {
        const poster = state.posters.find((entry) => entry.id === id)!;
        return reviewNoteOf(state, "poster", id, poster.authorId);
      };
      assert.equal(cover("poster-nagi-night-sf"), "folded");
      // Reported by the reader: folded on their screen, whatever came of it.
      assert.equal(cover("poster-sumire-weekend"), "reported");
      assert.equal(cover("poster-shiori-look-again"), null);
      // Its maker gets no cover, only the note.
      assert.equal(cover("me-poster-1"), null);
      assert.equal(note("me-poster-1"), "held");
      assert.equal(note("poster-nagi-night-sf"), null);
      // Folded, it stays in its place.
      assert.ok(
        timelinePosters(state).some(
          (poster) => poster.id === "poster-nagi-night-sf",
        ),
      );
      // Said of a poster as a poster, never as a post.
      assert.equal(
        reviewCoverWords("poster", "folded"),
        "通報があったため、運営が確かめるまで、たたんでいます",
      );
      assert.equal(
        reviewCoverWords("poster", "reported"),
        "あなたが通報したポスターです",
      );
      assert.equal(
        reviewCoverWords("post", "reported"),
        "あなたが通報した便りです",
      );
      assert.equal(
        reviewNoteWords("poster", "folded"),
        "通報があったため、運営が確かめるまで、みんなの画面ではたたんで表示しています。ポスターは消えていません。",
      );
      assert.equal(
        reviewNoteWords("post", "folded"),
        "通報があったため、運営が確かめるまで、みんなの画面ではたたんで表示しています。便りは消えていません。",
      );
      assert.equal(
        reviewNoteWords("poster", "held"),
        "運営が確かめるまで、ほかの人からは見えないようにしています。問題がなければ、元に戻ります。",
      );
      // What a folded poster is called says nothing of its words or books.
      assert.deepEqual(FOLDED_POSTER_NAMES, {
        folded: "たたんでいるポスター",
        reported: "あなたが通報したポスター",
      });
    },
  );

  await check(
    "the maker hears of a folded or held poster, in a poster's words",
    () => {
      const notices = (fold: "folded" | "held", id = ownSpoiler.id) =>
        notificationsFor({
          ...withSetting("fold_possible"),
          reviewFolds: {
            ["poster:" + id]: { state: fold, since: "2026-10-13T02:00:00Z" },
          },
        }).filter((notice) => notice.id.startsWith("review-"));
      assert.deepEqual(
        notices("folded").map((notice) => [
          notice.id,
          notice.text,
          notice.href,
          notice.createdAt,
        ]),
        [
          [
            "review-folded:poster:" + ownSpoiler.id,
            "通報があったため、運営が確かめるまで、あなたのポスター「最後に」をみんなの画面ではたたんでいます。ポスターは消えていません",
            posterPath(ownSpoiler.id),
            "2026-10-13T02:00:00Z",
          ],
        ],
      );
      assert.deepEqual(
        notices("held").map((notice) => [notice.text, notice.href]),
        [
          [
            "運営が確かめるまで、あなたのポスター「最後に」をほかの人から見えないようにしています。問題がなければ、元に戻ります",
            posterPath(ownSpoiler.id),
          ],
        ],
      );
      // Another reader's folded poster is not the viewer's news.
      assert.deepEqual(notices("folded", "poster-nagi-night-sf"), []);
    },
  );

  await check(
    "two of the maker's folded posters read apart; one taken down is no news",
    () => {
      const since = "2026-10-13T02:00:00Z";
      const second: Poster = {
        ...ownSpoiler,
        id: "me-poster-2",
        spoiler: false,
        pages: [{ heading: "", text: "雨の日に。", bookIds: ["momo"] }],
      };
      const town = withSetting("fold_possible");
      const state: TownState = {
        ...town,
        posters: [...town.posters, second],
        reviewFolds: {
          "poster:me-poster-1": { state: "folded", since },
          "poster:me-poster-2": { state: "folded", since },
        },
      };
      const told = (from: TownState) =>
        notificationsFor(from)
          .filter((notice) => notice.id.startsWith("review-"))
          .map((notice) => [notice.text, notice.href]);
      assert.deepEqual(told(state), [
        [
          "通報があったため、運営が確かめるまで、あなたのポスター「最後に」をみんなの画面ではたたんでいます。ポスターは消えていません",
          posterPath("me-poster-1"),
        ],
        [
          "通報があったため、運営が確かめるまで、あなたのポスター『モモ』をみんなの画面ではたたんでいます。ポスターは消えていません",
          posterPath("me-poster-2"),
        ],
      ]);
      // Held and then taken down by its maker: nothing is left to say.
      const id = crypto.randomUUID();
      const store = createTownStore({
        kind: "account",
        newId: () => crypto.randomUUID(),
        load: () => ({
          state: structuredClone({
            ...town,
            posters: [...town.posters, { ...second, id }],
            reviewFolds: { ["poster:" + id]: { state: "held", since } },
          }),
          status: "saved",
        }),
        save: () => "saved",
      });
      store.initialize();
      assert.equal(told(store.getSnapshot()).length, 1);
      assert.equal(store.actions.deletePoster(id), true);
      assert.deepEqual(told(store.getSnapshot()), []);
      assert.deepEqual(store.getSnapshot().reviewFolds, {});
    },
  );

  await check(
    "a thumb's spoken name says what its tile shows, and the maker's note",
    () => {
      const books = seedState.books;
      const plain = { ...ownSpoiler, spoiler: false };
      assert.equal(posterThumbName(plain, books, null), "ポスター 最後に");
      assert.equal(
        posterThumbName(ownSpoiler, books, null),
        "ネタバレを含むポスター（『百年の孤独』）",
      );
      // Folded: the words on its tile (たたんでいます, and why), none of its own.
      assert.equal(
        posterThumbName(plain, books, "folded"),
        "ポスター たたんでいます（通報があったため）",
      );
      assert.equal(
        posterThumbName(plain, books, "reported"),
        "ポスター たたんでいます（あなたが通報したため）",
      );
      assert.deepEqual(OWN_POSTER_REVIEW_WORDS, {
        folded: "通報があり、みんなの画面ではたたんでいます",
        held: "運営が確かめるまで、ほかの人には見えません",
      });
    },
  );

  await check(
    "the store makes, puts up and takes down the viewer's posters",
    () => {
      let now = new Date("2026-10-13T01:00:00Z");
      const repository = createMemoryRepository();
      const store = createTownStore(repository, () => now);
      const { actions } = store;
      store.initialize();

      // Not put up while it is unfinished; kept as a draft.
      const unfinished = draft({
        pages: [{ heading: "", text: "", bookIds: ["momo"] }],
      });
      assert.equal(actions.savePoster(unfinished), null);
      const id = actions.savePoster({ ...unfinished, status: "draft" });
      assert.equal(id, "me-poster-1");
      // Someone else's poster cannot be changed or taken down.
      assert.equal(actions.savePoster(draft(), "poster-nagi-night-sf"), null);
      actions.deletePoster("poster-nagi-night-sf");
      assert.ok(
        store
          .getSnapshot()
          .posters.some((poster) => poster.id === "poster-nagi-night-sf"),
      );

      now = new Date("2026-10-13T05:00:00Z");
      assert.equal(actions.savePoster(draft(), id!), id);
      const putUp = store
        .getSnapshot()
        .posters.find((poster) => poster.id === id)!;
      assert.equal(putUp.status, "published");
      // Put up, a draft is new on the board.
      assert.equal(putUp.createdAt, "2026-10-13T05:00:00.000Z");
      assert.equal(putUp.authorId, ME_ID);

      // Kept in this browser, and only the viewer's own.
      const reloaded = createTownStore(repository);
      reloaded.initialize();
      const kept = reloaded.getSnapshot().posters;
      assert.equal(kept.filter((poster) => poster.id === id).length, 1);
      assert.equal(kept.length, seedState.posters.length + 1);

      assert.equal(actions.deletePoster(id!), true);
      assert.ok(
        !store.getSnapshot().posters.some((poster) => poster.id === id),
      );
      assert.equal(actions.deletePoster(id!), false);
    },
  );

  await check(
    "while the account's town loads, a poster is not said to be kept",
    () => {
      let saves = 0;
      const store = createTownStore({
        kind: "account",
        newId: () => crypto.randomUUID(),
        load: () => new Promise(() => {}),
        save: () => {
          saves++;
          return "saved";
        },
      });
      store.initialize();
      // The editor keeps the maker's words only when this says nothing was kept.
      assert.equal(
        store.actions.savePoster(
          draft({
            template: "text",
            pages: [{ heading: "見出し", text: "本文", bookIds: [] }],
          }),
        ),
        null,
      );
      assert.equal(store.getSnapshot().posters.length, 0);
      assert.equal(saves, 0);
    },
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
