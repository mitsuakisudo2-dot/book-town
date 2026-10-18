import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "@playwright/test";
import { failureMessages } from "../src/lib/account";
import { passkeyFailure } from "../src/lib/supabase/account-backend";

// Makes and uses a passkey against a real local Supabase (`supabase start`,
// passkeys on in supabase/config.toml) in a real browser, with Chromium's
// stand-in authenticator in place of a fingerprint or a phone. A passkey
// only works on pages under its relying party, `localhost` locally, so the
// page is served at http://localhost:4319 (one of config.toml's origins).
// Everything runs inside main() because tsx compiles this file as CommonJS.

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
const PORT = 4319;

const admin = createClient(API_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
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

async function mailedCode(email: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`,
    ).then((response) => response.json());
    const id: string | undefined = search.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`).then(
        (response) => response.json(),
      );
      const code = /\b(\d{6})\b/.exec(message.Text || message.HTML)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No code arrived for " + email);
}

// supabase-js as the browser loads it, on an empty page of this origin.
const SUPABASE_JS = readFileSync(
  join(require.resolve("@supabase/supabase-js"), "..", "umd", "supabase.js"),
);
const server = createServer((request, response) => {
  if (request.url === "/supabase.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(SUPABASE_JS);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    '<!doctype html><meta charset="utf-8"><script src="/supabase.js"></script>',
  );
});

/** What a call answered, as the page saw it: enough to map its error. */
type Answer = {
  error: null | {
    __isWebAuthnError?: boolean;
    code?: string;
    status?: number;
    message?: string;
    cause?: { name?: string };
  };
  data: unknown;
};

/** Runs a call of the page's client and brings back what it answered. */
const call = (page: Page, body: string): Promise<Answer> =>
  page.evaluate(async (source) => {
    const client = (window as unknown as { client: unknown }).client;
    const run = new Function("client", `return (async () => ${source})()`);
    const { data, error } = await run(client);
    return {
      data: data ?? null,
      error: error
        ? {
            __isWebAuthnError: error.__isWebAuthnError,
            code: error.code,
            status: error.status,
            message: error.message,
            cause: error.cause ? { name: error.cause.name } : undefined,
          }
        : null,
    };
  }, body);

async function openPage(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  // One authenticator per page, like one phone: it keeps what it makes.
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  await page.evaluate(
    ([url, key]) => {
      const w = window as unknown as {
        supabase: { createClient: (u: string, k: string) => unknown };
        client: unknown;
      };
      w.client = w.supabase.createClient(url, key);
    },
    [API_URL, PUBLISHABLE_KEY],
  );
  return { page, cdp, authenticatorId, context };
}

async function signInWithCode(page: Page, email: string) {
  const asked = await call(
    page,
    `client.auth.signInWithOtp({ email: ${JSON.stringify(email)}, options: { shouldCreateUser: false } })`,
  );
  assert.equal(asked.error, null);
  const code = await mailedCode(email);
  const verified = await call(
    page,
    `client.auth.verifyOtp({ email: ${JSON.stringify(email)}, token: "${code}", type: "email" })`,
  );
  assert.equal(verified.error, null);
}

const signedInEmail = async (page: Page) =>
  (
    (await call(page, "client.auth.getUser()")).data as {
      user: { email: string } | null;
    }
  ).user?.email ?? null;

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  // Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
  const browser = await chromium.launch({
    executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  });
  let passed = 0;
  async function check(name: string, body: () => Promise<void>) {
    await body();
    passed += 1;
    console.log("PASS " + name);
  }
  try {
    const aki = await invite("passkey-aki");
    const ren = await invite("passkey-ren");
    const device = await openPage(browser);
    const { page } = device;

    await check("a passkey is made only while signed in", async () => {
      const answer = await call(page, "client.auth.registerPasskey()");
      assert.ok(answer.error);
      await signInWithCode(page, aki.email);
      const made = await call(page, "client.auth.registerPasskey()");
      assert.equal(made.error, null);
      const listed = await call(page, "client.auth.passkey.list()");
      assert.equal(listed.error, null);
      assert.equal((listed.data as unknown[]).length, 1);
    });

    await check("the same device makes one passkey, said so", async () => {
      const again = await call(page, "client.auth.registerPasskey()");
      assert.ok(again.error);
      assert.equal(passkeyFailure(again.error), "passkey-exists");
    });

    await check("signed out, the passkey signs in without a code", async () => {
      await call(page, "client.auth.signOut()");
      assert.equal(await signedInEmail(page), null);
      const signedIn = await call(page, "client.auth.signInWithPasskey()");
      assert.equal(signedIn.error, null);
      assert.equal(await signedInEmail(page), aki.email);
      const listed = await call(page, "client.auth.passkey.list()");
      const [passkey] = listed.data as { last_used_at?: string }[];
      assert.ok(passkey.last_used_at, "the sign-in is noted on it");
    });

    await check(
      "after a change of address, the passkey signs in with the new one",
      async () => {
        const next = `passkey-aki-next-${run}@example.jp`;
        const { error } = await admin.auth.admin.updateUserById(aki.id, {
          email: next,
          email_confirm: true,
        });
        assert.ifError(error);
        await call(page, "client.auth.signOut()");
        const signedIn = await call(page, "client.auth.signInWithPasskey()");
        assert.equal(signedIn.error, null);
        assert.equal(await signedInEmail(page), next);
      },
    );

    await check("another reader sees only their own passkeys", async () => {
      const other = await openPage(browser);
      await signInWithCode(other.page, ren.email);
      const listed = await call(other.page, "client.auth.passkey.list()");
      assert.equal(listed.error, null);
      assert.deepEqual(listed.data, []);
      // Aki's passkey, asked for by its id, is not Ren's to remove.
      const mine = await call(page, "client.auth.passkey.list()");
      const [{ id }] = mine.data as { id: string }[];
      const removed = await call(
        other.page,
        `client.auth.passkey.delete({ passkeyId: "${id}" })`,
      );
      assert.ok(removed.error);
      const still = await call(page, "client.auth.passkey.list()");
      assert.equal((still.data as unknown[]).length, 1);
      await other.context.close();
    });

    await check(
      "a removed passkey no longer signs in, and says why",
      async () => {
        const mine = await call(page, "client.auth.passkey.list()");
        const [{ id }] = mine.data as { id: string }[];
        const removed = await call(
          page,
          `client.auth.passkey.delete({ passkeyId: "${id}" })`,
        );
        assert.equal(removed.error, null);
        await call(page, "client.auth.signOut()");
        // The device still offers it; the auth server no longer knows it.
        const refused = await call(page, "client.auth.signInWithPasskey()");
        assert.ok(refused.error);
        assert.equal(passkeyFailure(refused.error), "passkey-unknown");
        assert.equal(await signedInEmail(page), null);
      },
    );

    await check(
      "closing the browser's window is not a failure to tell",
      async () => {
        // A device with no passkey for the town: the browser's window has
        // nothing to offer, and closes with nothing chosen.
        await device.cdp.send("WebAuthn.removeVirtualAuthenticator", {
          authenticatorId: device.authenticatorId,
        });
        await device.cdp.send("WebAuthn.addVirtualAuthenticator", {
          options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        });
        const closed = await call(page, "client.auth.signInWithPasskey()");
        assert.ok(closed.error);
        assert.equal(passkeyFailure(closed.error), "passkey-cancelled");
        assert.equal(failureMessages["passkey-cancelled"], "");
      },
    );

    await check("a passkey of a deleted account goes with it", async () => {
      const gone = await invite("passkey-gone");
      const phone = await openPage(browser);
      await signInWithCode(phone.page, gone.email);
      assert.equal(
        (await call(phone.page, "client.auth.registerPasskey()")).error,
        null,
      );
      await call(phone.page, "client.auth.signOut()");
      const { error } = await admin.auth.admin.deleteUser(gone.id);
      assert.ifError(error);
      const refused = await call(phone.page, "client.auth.signInWithPasskey()");
      assert.equal(passkeyFailure(refused.error), "passkey-unknown");
      await phone.context.close();
    });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(passed + " passkey checks passed against local Supabase");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
