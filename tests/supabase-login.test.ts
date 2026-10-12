import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { supabaseAccountBackend } from "../src/lib/supabase/account-backend";
import type { Database } from "../src/lib/supabase/database.types";

// Signs in against a real local Supabase (`supabase start`): the auth server,
// the email it sends, the REST API and the row level security together.
// Reads the stack's URLs and keys from the environment that
// `supabase status -o env` prints. Everything runs inside main() because tsx
// compiles this file as CommonJS.

const env = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is missing; run \`supabase status -o env\`.`);
  return value;
};
const API_URL = env("API_URL");
const MAILPIT_URL = env("MAILPIT_URL");
const PUBLISHABLE_KEY = env("PUBLISHABLE_KEY");
const SECRET_KEY = env("SECRET_KEY");

const admin = createClient(API_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const browserClient = () =>
  createClient<Database>(API_URL, PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

// Each run uses fresh addresses and IDs, so the test can run again on the same stack.
const run = Date.now().toString(36);

async function invite(name: string) {
  const email = `${name}-${run}@example.jp`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  assert.ifError(error);
  return { email, id: data.user!.id };
}

/** The newest code mailed to this address, read from the local mail catcher. */
async function mailedCode(email: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`,
    ).then((response) => response.json());
    const id = search.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`).then(
        (response) => response.json(),
      );
      const code = /\b(\d{6})\b/.exec(message.Text || message.HTML)?.[1];
      if (code) return { subject: message.Subject as string, code };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No code arrived for " + email);
}

/** The sign-in link in the newest email to this address. */
async function mailedLink(email: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`,
    ).then((response) => response.json());
    const id: string | undefined = search.messages?.[0]?.ID;
    if (id && !linksRead.has(id)) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`).then(
        (response) => response.json(),
      );
      const href = /href="([^"]+)"/.exec(message.HTML)?.[1];
      if (href) {
        linksRead.add(id);
        return href.replaceAll("&amp;", "&");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No link arrived for " + email);
}
const linksRead = new Set<string>();

async function main() {
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed += 1;
    console.log("PASS " + name);
  }

  const aki = await invite("aki");
  const client = browserClient();
  const backend = supabaseAccountBackend(client);
  const users: (string | null)[] = [];
  backend.onUserChange((user) => users.push(user?.id ?? null));
  const handle = `aki_${run}`.slice(0, 20);

  await check("an address nobody invited gets no code", async () => {
    assert.equal(
      await backend.sendCode(`stranger-${run}@example.jp`),
      "not-invited",
    );
  });

  await check("an invited address gets a six-digit code by email", async () => {
    assert.equal(await backend.sendCode(aki.email), null);
    const { subject } = await mailedCode(aki.email);
    assert.equal(subject, "Book Town のログインコード");
  });

  await check(
    "a wrong code is refused and the right one signs in",
    async () => {
      const { code } = await mailedCode(aki.email);
      const wrong = code === "000000" ? "111111" : "000000";
      assert.equal(await backend.verifyCode(aki.email, wrong), "invalid-code");
      assert.equal(await backend.verifyCode(aki.email, code), null);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(users.at(-1), aki.id);
    },
  );

  await check("a first sign-in has no profile yet", async () => {
    assert.equal(await backend.loadProfile(aki.id), null);
  });

  await check("the database refuses a reserved ID", async () => {
    assert.deepEqual(
      await backend.createProfile({
        id: aki.id,
        handle: "booktown",
        name: "アキ",
      }),
      { failure: "invalid-profile" },
    );
  });

  await check("nobody can create a profile for someone else", async () => {
    const ben = await invite("ben");
    const result = await backend.createProfile({
      id: ben.id,
      handle: `ben_${run}`.slice(0, 20),
      name: "ベン",
    });
    assert.ok("failure" in result);
    assert.equal(await backend.loadProfile(ben.id), null);
  });

  await check("the profile is created and read back", async () => {
    const result = await backend.createProfile({
      id: aki.id,
      handle,
      name: "アキ",
    });
    assert.ok("profile" in result);
    assert.equal(result.profile.handle, handle);
    assert.equal((await backend.loadProfile(aki.id))?.name, "アキ");
  });

  await check("a second reader cannot take the same ID", async () => {
    const chi = await invite("chi");
    const other = browserClient();
    const otherBackend = supabaseAccountBackend(other);
    otherBackend.onUserChange(() => {});
    assert.equal(await otherBackend.sendCode(chi.email), null);
    const { code } = await mailedCode(chi.email);
    assert.equal(await otherBackend.verifyCode(chi.email, code), null);
    assert.deepEqual(
      await otherBackend.createProfile({ id: chi.id, handle, name: "チー" }),
      { failure: "handle-taken" },
    );
  });

  await check("the link in the email signs in on this site only", async () => {
    const linkFor = async (name: string, redirect: string) => {
      const { email } = await invite(name);
      const { error } = await browserClient().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirect },
      });
      assert.ifError(error);
      const href = await mailedLink(email);
      const response = await fetch(href, { redirect: "manual" });
      return response.headers.get("location") ?? "";
    };
    const back = await linkFor("dan", "http://127.0.0.1:5173/login/");
    assert.match(back, /^http:\/\/127\.0\.0\.1:5173\/login\/#access_token=/);
    // A site that is not on the project's list never receives the session.
    const elsewhere = await linkFor(
      "eve",
      "https://booktown.example.com/login/",
    );
    assert.ok(!elsewhere.startsWith("https://booktown.example.com"));
    assert.ok(elsewhere.startsWith("http://127.0.0.1:3000"));
  });

  await check("signing out ends the session", async () => {
    await backend.signOut();
    assert.equal((await client.auth.getSession()).data.session, null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(users.at(-1), null);
  });

  console.log(passed + " Supabase login checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
