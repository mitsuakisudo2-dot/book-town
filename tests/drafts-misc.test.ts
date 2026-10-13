import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CODE_LIFE_MS,
  HANDLE_FIELD_MAX_LENGTH,
  SENT_CODE,
  profileWorkStore,
  readProfileWork,
  readSentCode,
  sentCodeStore,
} from "../src/lib/account-draft";
import { NAME_MAX_LENGTH } from "../src/lib/account";
import { imeKey } from "../src/lib/keys";
import { homeAddressOf, readHomeAddresses } from "../src/lib/last-address";
import { enterPressed } from "../src/lib/search/use-book-search";

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

{
  // The keys a kana conversion takes are the keyboard's, in every browser.
  assert.equal(imeKey({ isComposing: true, keyCode: 27 }), true);
  assert.equal(imeKey({ isComposing: false, keyCode: 229 }), true);
  assert.equal(imeKey({ isComposing: false, keyCode: 27 }), false);
  assert.equal(imeKey({ keyCode: 13 }), false);
  const enter = (isComposing: boolean, keyCode = 13) => ({
    key: "Enter",
    keyCode,
    nativeEvent: { isComposing },
  });
  assert.equal(enterPressed(enter(false)), true);
  assert.equal(enterPressed(enter(true)), false);
  assert.equal(enterPressed(enter(false, 229)), false);
  assert.equal(
    enterPressed({
      key: "a",
      keyCode: 65,
      nativeEvent: { isComposing: false },
    }),
    false,
  );
}

{
  // A sent code is kept while it can still sign in, and only its address.
  const hosted = JSON.parse(
    readFileSync(
      new URL("../supabase/hosted-auth.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(CODE_LIFE_MS, hosted.code.expiresInSeconds * 1000);
  const now = Date.parse("2026-10-13T10:00:00Z");
  const sent = { email: "aki@example.jp", sentAt: now - 60_000 };
  assert.deepEqual(readSentCode(sent, now), sent);
  assert.deepEqual(
    readSentCode({ ...sent, code: "123456", extra: 1 }, now),
    sent,
  );
  assert.equal(
    readSentCode({ ...sent, sentAt: now - CODE_LIFE_MS }, now),
    null,
  );
  assert.equal(readSentCode({ ...sent, sentAt: now + 3600_000 }, now), null);
  assert.equal(readSentCode({ ...sent, email: "not an address" }, now), null);
  assert.equal(
    readSentCode({ ...sent, email: "a".repeat(250) + "@x.jp" }, now),
    null,
  );
  assert.equal(readSentCode({ ...sent, sentAt: "1" }, now), null);
  assert.equal(readSentCode(null, now), null);
  assert.equal(readSentCode("aki@example.jp", now), null);
}

{
  // The first profile fits the form's fields, or is not read back.
  assert.deepEqual(readProfileWork({ name: "アキ", handle: "aki" }), {
    name: "アキ",
    handle: "aki",
  });
  assert.equal(
    readProfileWork({ name: "あ".repeat(NAME_MAX_LENGTH + 1), handle: "" }),
    null,
  );
  assert.equal(
    readProfileWork({
      name: "",
      handle: "a".repeat(HANDLE_FIELD_MAX_LENGTH + 1),
    }),
    null,
  );
  assert.equal(readProfileWork({ name: "アキ" }), null);
  assert.equal(readProfileWork(7), null);
}

{
  // The stores the sign-in page uses read nothing on the server.
  assert.equal(sentCodeStore.getServerSnapshot().loaded, false);
  assert.equal(profileWorkStore.getServerSnapshot().loaded, false);
}

{
  // Both are kept in this browser tab's sessionStorage. Each person's first
  // profile is kept apart, and only by a real user id; spaces are no work.
  const session = memory();
  Object.assign(globalThis, { window: { sessionStorage: session } });
  const aki = "8f6a2c1e-5b7d-4e1a-9c3f-2d4b6a8e0c11";
  const ren = "3c1d2b4a-7e6f-4a5b-8c9d-0e1f2a3b4c5d";
  profileWorkStore.set(aki, { name: "アキ", handle: "aki_books" });
  profileWorkStore.set(ren, { name: "  ", handle: "" });
  profileWorkStore.set("me", { name: "誰か", handle: "" });
  assert.deepEqual(profileWorkStore.get(aki), {
    name: "アキ",
    handle: "aki_books",
  });
  assert.equal(profileWorkStore.get(ren), null);
  assert.equal(profileWorkStore.get("me"), null);
  const kept = JSON.parse(session.data.get("book-town-first-profile-v1")!);
  assert.deepEqual(Object.keys(kept.drafts), [aki]);
  profileWorkStore.clear(aki);
  assert.equal(session.data.has("book-town-first-profile-v1"), false);

  // The sign-in keeps one entry, the address and the time, never a code.
  const sentAt = Date.now();
  sentCodeStore.set(SENT_CODE, { email: "aki@example.jp", sentAt });
  assert.deepEqual(JSON.parse(session.data.get("book-town-sign-in-v1")!), {
    version: 1,
    drafts: { sent: { email: "aki@example.jp", sentAt } },
  });
  sentCodeStore.set("other", { email: "ren@example.jp", sentAt });
  assert.equal(sentCodeStore.get("other"), null);
  sentCodeStore.clear(SENT_CODE);
  assert.equal(session.data.size, 0);
}

{
  // A Home tab keeps its filter and lane, not how far the street went.
  assert.equal(
    homeAddressOf("/", "?rounds=4&lane=2&show=following"),
    "/?show=following&lane=2",
  );
  assert.equal(homeAddressOf("/", "?rounds=3"), "/");
  assert.equal(homeAddressOf("/", ""), "/");
  assert.equal(
    homeAddressOf("/timeline/", "?show=following&utm=x"),
    "/timeline/?show=following",
  );
  assert.equal(homeAddressOf("/search/", "?q=モモ"), null);
  assert.equal(homeAddressOf("/timeline", "?show=following"), null);
}

{
  // Kept addresses are read back only as this module writes them.
  assert.deepEqual(
    readHomeAddresses({
      addresses: {
        "/": "/?show=following&lane=1",
        "/timeline/": "/timeline/?show=following",
      },
      last: "/timeline/",
    }),
    {
      addresses: {
        "/": "/?show=following&lane=1",
        "/timeline/": "/timeline/?show=following",
      },
      last: "/timeline/",
    },
  );
  assert.deepEqual(
    readHomeAddresses({
      addresses: {
        "/": "https://elsewhere.example/?show=following",
        "/timeline/": "/search/?show=following",
      },
      last: "/",
    }),
    { addresses: {}, last: "/" },
  );
  assert.deepEqual(
    readHomeAddresses({
      addresses: { "/": "/?rounds=9&show=following" },
      last: "/",
    }),
    { addresses: {}, last: "/" },
  );
  assert.equal(readHomeAddresses({ addresses: {}, last: "/search/" }), null);
  assert.equal(readHomeAddresses(null), null);
  assert.equal(readHomeAddresses("/"), null);
}

console.log("drafts-misc ok");
