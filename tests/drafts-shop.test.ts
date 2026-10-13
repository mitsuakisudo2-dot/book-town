import assert from "node:assert/strict";
import { draftOwner } from "../src/lib/draft-owner";
import { createKeptDraftStore } from "../src/lib/kept-draft";
import {
  OPEN_SHOP_DRAFT_KEY,
  openShopDraftOptions,
  openShopHasWords,
  openShopUntouched,
  readOpenShopWork,
  type OpenShopWork,
} from "../src/lib/open-shop-draft";
import {
  nineDraftOptions,
  nineForm,
  nineLosesWords,
  profileDraftOptions,
  profileForm,
  profileLosesWords,
  readNineWork,
  readProfileWork,
  sameNine,
  sameProfile,
  type NineWork,
  type ProfileWork,
} from "../src/lib/profile-draft";
import {
  overSaved,
  readShelfName,
  readShopSign,
  sameSign,
  shelfNameDraftOptions,
  shopSignDraftOptions,
  signLosesWords,
  townTook,
} from "../src/lib/shop-draft";
import { townActions, townStore } from "../src/lib/store";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed++;
  console.log("PASS " + name);
}
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const user = (id: string) => ({ id, email: id + "@example.com" });

const opening: OpenShopWork = {
  kind: "one",
  step: "sign",
  picks: { one: ["momo"], nine: ["solaris", "momo"] },
  pop: "眠れない夜に、そっと渡したい。",
  name: "雨音書店",
  tagline: "一頁ぶん、遠回り。",
  theme: "ink",
};

check("work belongs to the demo or to one account, never between", () => {
  // Keyed by draftOwner, the one rule every kept store follows.
  assert.equal(draftOwner({ status: "demo" }), "demo");
  assert.equal(draftOwner({ status: "loading" }), null);
  assert.equal(
    draftOwner({ status: "needs-profile", user: user("a-1") }),
    "a-1",
  );
  assert.equal(draftOwner({ status: "unavailable", user: user("b-2") }), "b-2");
  // One account's opening is not read under another's key.
  const storage = memory();
  const store = createKeptDraftStore(openShopDraftOptions, () => storage);
  store.set("a-1", opening);
  assert.deepEqual(store.get("a-1"), opening);
  assert.equal(store.get("b-2"), null);
  assert.equal(store.get("demo"), null);
  // Keys are only the owner for the opening and the profile, owner/shop for
  // the sign and owner/shop/shelf for a shelf's name.
  assert.equal(openShopDraftOptions.keyPattern.test("demo/mine"), false);
  assert.equal(profileDraftOptions.keyPattern.test("a-1"), true);
  assert.equal(nineDraftOptions.keyPattern.test("demo/mine"), false);
  assert.equal(shopSignDraftOptions.keyPattern.test("demo/mine"), true);
  assert.equal(shopSignDraftOptions.keyPattern.test("demo"), false);
  assert.equal(
    shelfNameDraftOptions.keyPattern.test("a-1/mine/shelf-first"),
    true,
  );
  assert.equal(shelfNameDraftOptions.keyPattern.test("demo/mine"), false);
});

check("an opening keeps its kind, step, books in order, POP and sign", () => {
  const storage = memory();
  const store = createKeptDraftStore(openShopDraftOptions, () => storage);
  store.set("demo", opening);
  const again = createKeptDraftStore(openShopDraftOptions, () => storage);
  again.initialize();
  assert.deepEqual(again.get("demo"), opening);
  assert.deepEqual(again.get("demo")?.picks.nine, ["solaris", "momo"]);
  // Only the kind chosen, nothing picked or written: nothing is kept.
  const untouched: OpenShopWork = {
    kind: "five",
    step: "books",
    picks: {},
    pop: "",
    name: "",
    tagline: "",
    theme: "sage",
  };
  assert.equal(openShopUntouched(untouched), true);
  store.set("demo", untouched);
  assert.equal(store.get("demo"), null);
  assert.equal(storage.data.has(OPEN_SHOP_DRAFT_KEY), false);
  // Every book taken off is still a choice, unlike the usual books.
  assert.equal(openShopUntouched({ ...untouched, picks: { nine: [] } }), false);
  assert.equal(openShopHasWords(untouched), false);
  assert.equal(openShopHasWords({ ...untouched, tagline: "夜" }), true);
});

check("an opening read back must fit the flow", () => {
  assert.deepEqual(readOpenShopWork(opening), opening);
  for (const broken of [
    { ...opening, kind: "ten" },
    { ...opening, step: "kind" },
    { ...opening, kind: "free", step: "books" },
    { ...opening, picks: { five: ["a", "b", "c", "d", "e", "f"] } },
    { ...opening, picks: { one: ["momo", "solaris"] } },
    { ...opening, picks: { nine: ["momo", "momo"] } },
    { ...opening, picks: { free: ["momo"] } },
    { ...opening, picks: ["momo"] },
    { ...opening, picks: { nine: [""] } },
    { ...opening, name: "店".repeat(81) },
    { ...opening, tagline: "あ".repeat(501) },
    { ...opening, pop: "あ".repeat(1001) },
    { ...opening, theme: "neon" },
    { ...opening, name: 3 },
    null,
    "雨音書店",
  ])
    assert.equal(readOpenShopWork(broken), null, JSON.stringify(broken));
  assert.deepEqual(readOpenShopWork({ ...opening, kind: "free", picks: {} }), {
    ...opening,
    kind: "free",
    picks: {},
  });
});

const reader = {
  name: "夜の読書家",
  handle: "reader",
  bio: "SFと翻訳文学のあいだを、ゆっくり歩いています。",
  links: [] as string[],
  lifeNine: ["momo", "solaris", "galaxy-railroad"],
  nineNotes: { solaris: "遠い惑星で、他者を思う。" } as Record<string, string>,
};

check("a profile being changed is kept until it matches the saved one", () => {
  const saved = profileForm(reader);
  assert.deepEqual(saved.links, [""]);
  const work: ProfileWork = { ...saved, bio: "書きかけの自己紹介" };
  assert.equal(sameProfile(work, saved), false);
  assert.equal(sameProfile({ ...saved, links: [""] }, saved), true);
  // A link field added and left empty is still a change, but no words.
  const field = { ...saved, links: ["", ""] };
  assert.equal(sameProfile(field, saved), false);
  assert.equal(profileLosesWords(field, saved), false);
  assert.equal(profileLosesWords(work, saved), true);
  // A field emptied loses no words of the reader's.
  assert.equal(profileLosesWords({ ...saved, bio: "" }, saved), false);
  assert.deepEqual(readProfileWork(work), work);
  // Kept with the card it was written over; nothing changed, nothing kept.
  const storage = memory();
  const store = createKeptDraftStore(profileDraftOptions, () => storage);
  store.set("demo", { work, base: saved });
  store.set("a-1", { work: saved, base: saved });
  const again = createKeptDraftStore(profileDraftOptions, () => storage);
  again.initialize();
  assert.deepEqual(again.get("demo"), { work, base: saved });
  assert.equal(again.get("a-1"), null);
  for (const broken of [
    { ...work, name: "あ".repeat(81) },
    { ...work, handle: "a".repeat(22) },
    { ...work, bio: "あ".repeat(2001) },
    { ...work, links: [] },
    { ...work, links: ["", "", "", "", "", ""] },
    { ...work, links: ["https://" + "a".repeat(400)] },
    { ...work, links: "https://note.com" },
    { ...work, bio: null },
  ])
    assert.equal(readProfileWork(broken), null, JSON.stringify(broken));
});

check("the nine keep their order and words, up to nine books", () => {
  const saved = nineForm(reader);
  const moved: NineWork = {
    ids: ["solaris", "momo", "galaxy-railroad"],
    notes: { ...saved.notes, momo: "いつでも戻ってこられる。" },
  };
  assert.equal(sameNine(moved, saved), false);
  assert.equal(sameNine({ ...saved, notes: { ...saved.notes } }, saved), true);
  // The same books in another order are another nine.
  assert.equal(
    sameNine({ ...saved, ids: [...saved.ids].reverse() }, saved),
    false,
  );
  assert.equal(nineLosesWords(moved, saved), true);
  assert.equal(nineLosesWords({ ...moved, notes: saved.notes }, saved), false);
  assert.deepEqual(readNineWork(moved), moved);
  const ten = Array.from({ length: 10 }, (_, index) => "book-" + index);
  for (const broken of [
    { ids: ten, notes: {} },
    { ids: ["momo", "momo"], notes: {} },
    { ids: ["momo"], notes: { momo: "あ".repeat(501) } },
    { ids: ["momo"], notes: { momo: 5 } },
    { ids: ["momo"], notes: [] },
    {
      ids: ["momo"],
      notes: Object.fromEntries(
        Array.from({ length: 28 }, (_, index) => ["b" + index, "x"]),
      ),
    },
    { ids: "momo", notes: {} },
  ])
    assert.equal(readNineWork(broken), null, JSON.stringify(broken));
});

check("the shop's sign and a shelf's new name are kept as written", () => {
  const saved = {
    name: "夜と寄り道書房",
    tagline: "一頁ぶん、遠回り。",
    description: "",
    theme: "rose" as const,
  };
  const work = { ...saved, description: "書きかけの紹介" };
  assert.equal(sameSign(work, saved), false);
  assert.equal(sameSign({ ...saved }, saved), true);
  assert.equal(signLosesWords(work, saved), true);
  assert.equal(signLosesWords({ ...saved, theme: "ink" }, saved), false);
  assert.deepEqual(readShopSign(work), work);
  assert.equal(readShopSign({ ...work, description: "あ".repeat(2001) }), null);
  assert.equal(readShopSign({ ...work, theme: "blue" }), null);
  assert.deepEqual(readShelfName({ name: "夜にひらく異世界" }), {
    name: "夜にひらく異世界",
  });
  // An emptied field is not brought back after a reload.
  assert.equal(readShelfName({ name: "  " }), null);
  assert.equal(readShelfName({ name: "棚".repeat(81) }), null);
  const storage = memory();
  const store = createKeptDraftStore(shopSignDraftOptions, () => storage);
  store.set("demo/mine", { work, base: saved });
  store.set("a-1/mine", {
    work: { ...work, name: "別の書店" },
    base: saved,
  });
  const again = createKeptDraftStore(shopSignDraftOptions, () => storage);
  again.initialize();
  assert.deepEqual(again.get("demo/mine"), { work, base: saved });
  assert.equal(again.get("a-1/mine")?.work.name, "別の書店");
  // Work that changes nothing from the sign it was written over is not kept,
  // and a side that no longer fits the form drops the entry.
  store.set("demo/mine", { work: saved, base: saved });
  assert.equal(store.get("demo/mine"), null);
  storage.setItem(
    "book-town-shop-sign-drafts-v1",
    JSON.stringify({
      version: 1,
      drafts: {
        "demo/mine": { work, base: { ...saved, theme: "blue" } },
        "demo/other": work,
      },
    }),
  );
  const broken = createKeptDraftStore(shopSignDraftOptions, () => storage);
  broken.initialize();
  assert.deepEqual(broken.getSnapshot().drafts, {});
});

check("kept work follows what was saved since, but for its own changes", () => {
  // Written on the phone over name A; the name was changed to B elsewhere.
  const base = profileForm(reader);
  const kept = { work: { ...base, bio: "電車で書いた自己紹介" }, base };
  const savedNow = { ...base, name: "別の端末で変えた名前" };
  assert.deepEqual(overSaved(kept, savedNow), {
    ...savedNow,
    bio: "電車で書いた自己紹介",
  });
  // A link added here stays; links left as they were follow the saved ones.
  const linked = {
    work: { ...base, links: ["https://note.com/yoru"] },
    base,
  };
  assert.deepEqual(overSaved(linked, savedNow)?.links, [
    "https://note.com/yoru",
  ]);
  assert.deepEqual(
    overSaved(kept, { ...savedNow, links: ["https://example.com/"] })?.links,
    ["https://example.com/"],
  );
  // The same change saved elsewhere leaves nothing to keep.
  assert.equal(overSaved(kept, { ...base, bio: "電車で書いた自己紹介" }), null);
  assert.equal(overSaved(null, base), null);
  // The sign: a new description over an older name keeps the newer name.
  const sign = {
    name: "夜と寄り道書房",
    tagline: "一頁ぶん、遠回り。",
    description: "",
    theme: "rose" as const,
  };
  const keptSign = {
    work: { ...sign, description: "紹介の書きかけ" },
    base: sign,
  };
  assert.deepEqual(overSaved(keptSign, { ...sign, name: "雨音書店" }), {
    ...sign,
    name: "雨音書店",
    description: "紹介の書きかけ",
  });
  // A save the account turned away puts the old sign back; the work held
  // over it (what was sent, over what was there) shows again.
  const sent = { ...sign, tagline: "新しいひとこと" };
  assert.equal(overSaved({ work: sent, base: sign }, sent), null);
  assert.deepEqual(overSaved({ work: sent, base: sign }, sign), sent);
});

check("a change the town turns away is told apart from one it took", () => {
  // The town in this test has no shop of the reader's: nothing to change.
  townStore.initialize();
  assert.equal(
    townTook(() =>
      townActions.updateShop({
        name: "雨音書店",
        description: "",
        tagline: "",
        theme: "sage",
      }),
    ),
    false,
  );
  assert.equal(
    townTook(() => {}),
    false,
  );
  assert.equal(
    townTook(() => townActions.toggleWish("solaris")),
    true,
  );
});

console.log(`drafts-shop ok (${passed} checks)`);
