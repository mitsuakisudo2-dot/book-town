import assert from "node:assert/strict";
import { demoPosters, seedState } from "../src/lib/data";
import {
  cleanPosterDraft,
  emptyPage,
  pagesFromRows,
  pagesToRows,
  pageRowBookIds,
  posterBookIds,
  posterProblem,
  postersOf,
  postersOfBook,
  posterTitle,
  restorePoster,
  POSTER_LIMITS,
  type PosterDraft,
} from "../src/lib/posters";
import { createMemoryRepository } from "../src/lib/repository";
import { createTownStore } from "../src/lib/store";
import { ME_ID } from "../src/lib/types";

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

      actions.deletePoster(id!);
      assert.ok(
        !store.getSnapshot().posters.some((poster) => poster.id === id),
      );
    },
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
