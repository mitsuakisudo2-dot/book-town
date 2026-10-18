"use client";

import { postDraftKey, returnPostWords } from "./post-draft";
import {
  readRecordChanges,
  recordWorkKey,
  returnRecordWork,
} from "./record-draft";
import type { Missed } from "./supabase/sync";
import { writtenWords, type RelationTable, type Write } from "./town-remote";
import type { ShopTable, WalkWrite } from "./walk-remote";
import { keepShelvesNotSent } from "./shelves-draft";
import { failure, KEPT } from "./words";

// Changes that did not reach the database (supabase/sync.ts): what the
// screens call each one, the line that tells the reader, and the words of a
// 便り or a record turned away, put back where they were written from.

const RELATIONS: Record<RelationTable, string> = {
  shop_follows: "フォロー",
  blocks: "ブロック",
  book_marks: "本の印",
  pop_reactions: "POPへの反応",
  post_reactions: "いいね",
  spoiler_reports: "「ネタバレでは？」",
};

const MARKS: Record<string, string> = {
  wish: "読みたい",
  favorite: "好きな本",
  library: "本棚の本",
  finished: "読了",
};

/** What the screens call the change a town write makes. */
export function townWriteLabels(write: Write): string[] {
  switch (write.kind) {
    case "books":
    case "copy-books":
      return ["本の登録"];
    case "fix-books":
      return ["本の直し"];
    case "profile":
      return ["プロフィール"];
    case "nine":
      return ["人生の9冊"];
    case "create-shop":
      return ["書店の開店"];
    case "update-shop":
      return ["看板と紹介"];
    case "shelves":
      return ["書店の棚"];
    case "delete-posts":
      return ["便りの削除"];
    case "posts":
      return write.rows.map((row) => (row.parent_id ? "返信" : "便り"));
    case "mark-spoilers":
      return ["ネタバレの印"];
    case "like-taps":
      return ["いいね"];
    case "end-sessions":
    case "sessions":
      return ["読書の時間"];
    case "delete-records":
      return ["読書の記録の削除"];
    case "records":
    case "update-record":
      return ["読書の記録"];
    case "reader-settings":
      return ["設定"];
    case "delete-posters":
      return ["ポスターの削除"];
    case "posters":
    case "update-poster":
      return ["ポスター"];
    case "remove":
    case "add":
      return write.rows.map((row) =>
        write.table === "post_reactions" && row.kind === "want"
          ? "読みたくなった"
          : write.table === "book_marks"
            ? (MARKS[row.kind] ?? RELATIONS.book_marks)
            : RELATIONS[write.table],
      );
    case "library-shelves":
      return ["本棚の棚"];
    case "shelf-books":
      return ["棚の本"];
    case "library-entries":
      return ["ライブラリの本"];
  }
}

const SHOP_TABLES: Record<ShopTable, string> = {
  shop_reactions: "店主へのひとこと",
  saved_shops: "あとで寄る書店",
  shop_visits: "立ち寄り",
};

/** What the screens call the change a walk write makes. */
export function walkWriteLabels(write: WalkWrite): string[] {
  switch (write.kind) {
    case "scene":
      return ["店内の飾りつけ"];
    case "reactions":
      return write.rows.map((row) =>
        row.message ? SHOP_TABLES.shop_reactions : "書店への反応",
      );
    case "visits":
      return [SHOP_TABLES.shop_visits];
    case "saved":
      return [SHOP_TABLES.saved_shops];
    case "pops":
    case "unpop":
      return ["POPへの反応"];
    case "forget":
      return [SHOP_TABLES[write.table]];
  }
}

/** The names, each once, in the order they came. */
const named = (labels: string[]) => [...new Set(labels)].join("、");

/**
 * The line that tells what did not reach the database: what it turned away,
 * and what was not sent because it had changed on another device, each with
 * whether the work is kept to go on with. Null for nothing.
 */
export function missedLine(
  refused: string[],
  elsewhere: string[],
  wordsKept: boolean,
  elsewhereKept = false,
): string | null {
  const lines = [
    refused.length &&
      failure({
        what: `${named(refused)}を保存できませんでした`,
        kept: wordsKept ? KEPT.draft : undefined,
      }),
    elsewhere.length &&
      failure({
        what: `別の端末で先に変わっていたため、${named(elsewhere)}の変更は送りませんでした`,
        kept: elsewhereKept ? KEPT.draft : undefined,
      }),
  ].filter((line): line is string => Boolean(line));
  return lines.length ? lines.join("") : null;
}

/**
 * Puts the words of 便り and records the database turned away back into
 * `owner`'s drafts, so nothing written is lost: a 便り into the composer of
 * 投稿する (its reply's page may be gone), after the words already there,
 * or where it was written when they would not fit; a record into its draft.
 * Whether any words were kept.
 */
export function keepMissedWords(owner: string, writes: Write[]): boolean {
  let kept = false;
  for (const write of writes) {
    const { posts, records } = writtenWords(write);
    for (const post of posts) {
      if (!post.body.trim()) continue;
      const words = {
        body: post.body,
        bookId: post.bookId,
        spoiler: post.spoiler,
      };
      const from = post.parentId
        ? { parentId: post.parentId }
        : { bookId: post.bookId ?? undefined };
      if (
        returnPostWords(postDraftKey(owner), words) ||
        returnPostWords(postDraftKey(owner, from), words)
      )
        kept = true;
    }
    for (const record of records) {
      const { body, feelings, spoiler, audience } = record;
      const work = readRecordChanges(
        // Only what the write carries: a change sends some of these.
        Object.fromEntries(
          Object.entries({ feelings, note: body, spoiler, audience }).filter(
            ([, value]) => value !== undefined,
          ),
        ),
      );
      const key =
        "recordId" in record
          ? recordWorkKey({ owner, recordId: record.recordId, bookId: "" })
          : recordWorkKey({ owner, bookId: record.bookId });
      if (work && returnRecordWork(key, work)) kept = true;
    }
  }
  return kept;
}

/**
 * Changes whose work the screen it was made on keeps in this browser until
 * the database has it (人生の9冊, a poster, the scene of 店内).
 */
const KEPT_TOWN = new Set<Write["kind"]>(["nine", "posters", "update-poster"]);
const KEPT_WALK = new Set<WalkWrite["kind"]>(["scene"]);

/** Some changes, every one of them kept to go on with. */
const allKept = <W extends { kind: string }>(writes: W[], kept: Set<string>) =>
  writes.length > 0 && writes.every((write) => kept.has(write.kind));

/**
 * What the town tells of a batch it missed, its words kept for `owner`, and
 * the shelves not sent because they had changed on another device.
 */
export function townMissedLine(
  missed: Missed<Write>,
  owner: string | null,
): string | null {
  const wordsKept = owner !== null && keepMissedWords(owner, missed.refused);
  const shelvesKept =
    owner !== null && keepShelvesNotSent(owner, missed.elsewhere);
  return missedLine(
    missed.refused.flatMap(townWriteLabels),
    missed.elsewhere.flatMap(townWriteLabels),
    wordsKept || allKept(missed.refused, KEPT_TOWN),
    allKept(
      missed.elsewhere,
      shelvesKept ? new Set([...KEPT_TOWN, "shelves"]) : KEPT_TOWN,
    ),
  );
}

/** What the walk tells of a batch it missed. */
export const walkMissedLine = (missed: Missed<WalkWrite>) =>
  missedLine(
    missed.refused.flatMap(walkWriteLabels),
    missed.elsewhere.flatMap(walkWriteLabels),
    allKept(missed.refused, KEPT_WALK),
    allKept(missed.elsewhere, KEPT_WALK),
  );
