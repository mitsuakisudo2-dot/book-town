import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import {
  authChanges,
  desiredAuth,
  redact,
  shown,
} from "../scripts/supabase-auth.mjs";
import { deploymentLine, logLines, validBranch } from "../scripts/vercel.mjs";

// The scripts that change the hosted Supabase and Vercel settings, without
// calling either: what they ask for, and what they let into the public log.

const settings = JSON.parse(readFileSync("supabase/hosted-auth.json", "utf8"));
const template = readFileSync("supabase/templates/magic_link.html", "utf8");
const KEY = "re_abcdefgh_12345678";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log("PASS " + name);
}

/** A value from one section of supabase/config.toml. */
function local(section: string, key: string) {
  const toml = readFileSync("supabase/config.toml", "utf8");
  const body = toml.split(`\n[${section}]\n`)[1]?.split("\n[")[0] ?? "";
  const line = body.split("\n").find((l) => l.startsWith(key + " = "));
  assert.ok(line, `${section}.${key} is in supabase/config.toml`);
  return JSON.parse(line.slice(key.length + 3));
}

interface Seen {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** A stand-in API: answers each request with `answer`, and remembers it. */
async function standIn(
  answer: (seen: Seen) => { status?: number; body: unknown },
) {
  const seen: Seen[] = [];
  const read = async (request: IncomingMessage) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    return text ? JSON.parse(text) : null;
  };
  const server = createServer(async (request, response) => {
    const entry = {
      method: request.method ?? "",
      url: request.url ?? "",
      body: await read(request),
    };
    seen.push(entry);
    const { status = 200, body } = answer(entry);
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Runs a script the way the workflow does; resolves with its exit and output. */
function run(script: string, args: string[], env: Record<string, string>) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env } },
      (error, stdout, stderr) =>
        resolve({
          code: error ? Number(error.code ?? 1) : 0,
          output: stdout + stderr,
        }),
    );
  });
}

const TOKEN = "sbp_token_for_tests_000";

// tsx compiles tests as CommonJS, so the checks run inside main().
async function main() {
  await check(
    "the hosted project gets the same code and email as the local one",
    () => {
      assert.equal(settings.code.length, local("auth.email", "otp_length"));
      assert.equal(
        settings.code.expiresInSeconds,
        local("auth.email", "otp_expiry"),
      );
      assert.equal(
        settings.magicLink.subject,
        local("auth.email.template.magic_link", "subject"),
      );
      assert.equal(
        "./supabase/" + settings.magicLink.template,
        local("auth.email.template.magic_link", "content_path"),
      );
      // The email promises the code lasts ten minutes.
      assert.equal(settings.code.expiresInSeconds, 600);
      assert.match(template, /10分/);
      assert.match(template, /\{\{ \.Token \}\}/);
    },
  );

  await check("without a Resend key only the code settings change", () => {
    assert.deepEqual(desiredAuth(settings, { template, resendKey: "" }), {
      mailer_otp_length: 6,
      mailer_otp_exp: 600,
    });
  });

  await check("with a Resend key the email goes through Resend", () => {
    const wanted = desiredAuth(settings, { template, resendKey: KEY });
    assert.equal(wanted.smtp_host, "smtp.resend.com");
    assert.equal(wanted.smtp_port, "465");
    assert.equal(wanted.smtp_user, "resend");
    assert.equal(wanted.rate_limit_email_sent, 30);
    assert.equal(wanted.mailer_templates_magic_link_content, template);
    // The key is sent as the password, never kept with the other settings.
    assert.ok(!Object.values(wanted).includes(KEY));
  });

  await check("only what differs is changed", () => {
    const wanted = desiredAuth(settings, { template, resendKey: KEY });
    const current = { ...wanted, smtp_port: 465, smtp_pass: KEY };
    assert.deepEqual(authChanges(current, wanted, KEY), []);
    assert.deepEqual(
      authChanges({ ...current, mailer_otp_exp: 3600 }, wanted, KEY),
      ["mailer_otp_exp"],
    );
    // A password that comes back hidden is sent again.
    assert.deepEqual(
      authChanges({ ...current, smtp_pass: "********" }, wanted, KEY),
      ["smtp_pass"],
    );
    assert.deepEqual(
      authChanges({}, { mailer_otp_length: 6, mailer_otp_exp: 600 }, ""),
      ["mailer_otp_length", "mailer_otp_exp"],
    );
  });

  await check(
    "the public log never shows the password or the whole email",
    () => {
      assert.equal(shown("smtp_pass", KEY), "(hidden)");
      assert.equal(shown("jwt_secret", "x"), "(hidden)");
      assert.equal(shown("smtp_host", null), "(not set)");
      assert.equal(shown("rate_limit_email_sent", 30), "30");
      const email = shown("mailer_templates_magic_link_content", template);
      assert.match(email, /^\d+ characters, sha256 [0-9a-f]{12}$/);
      assert.equal(
        redact(`bad key ${KEY} and sbp_0123456789abcdef`, ["secret-token"]),
        "bad key *** and ***",
      );
      assert.equal(
        redact("token secret-token here", ["secret-token"]),
        "token *** here",
      );
    },
  );

  await check("only plain branch names reach Vercel", () => {
    assert.ok(validBranch("main"));
    assert.ok(validBranch("claude/stage2-storage"));
    for (const name of ["", "-x", "a..b", "a b", "a;b", "$(x)", undefined])
      assert.ok(!validBranch(name as string), String(name));
  });

  await check("deployments and build logs read on one line each", () => {
    assert.equal(
      deploymentLine({
        created: Date.UTC(2026, 9, 12, 14, 28),
        readyState: "ERROR",
        meta: { githubCommitSha: "fc24c62aaaaaaa" },
        target: null,
        url: "book-town-abc.vercel.app",
        errorCode: "BUILD_FAILED",
        errorMessage: "Command failed",
      }),
      "2026-10-12T14:28:00Z ERROR     fc24c62 preview https://book-town-abc.vercel.app BUILD_FAILED: Command failed",
    );
    assert.deepEqual(
      logLines([
        { type: "stderr", text: "Error: x" },
        { type: "delimiter", text: "--" },
        { type: "stdout", payload: { text: "Building" } },
        { type: "stdout", text: "  " },
        null,
      ]),
      ["Building", "Error: x"],
    );
  });

  await check(
    "the settings script checks, applies and reads back",
    async () => {
      let project: Record<string, unknown> = {
        mailer_otp_length: 6,
        mailer_otp_exp: 3600,
        smtp_pass: null,
        site_url: "https://book-town-851k.vercel.app",
      };
      const api = await standIn(({ method, url, body }) => {
        assert.equal(url, "/projects/ref123/config/auth");
        if (method === "PATCH") project = { ...project, ...body };
        // Like Supabase, the password is not sent back.
        return { body: { ...project, smtp_pass: null } };
      });
      const env = {
        SUPABASE_API_URL: api.url,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_PROJECT_ID: "ref123",
      };

      const looked = await run("scripts/supabase-auth.mjs", ["check"], env);
      assert.equal(looked.code, 0, looked.output);
      assert.match(looked.output, /mailer_otp_exp: 3600 -> 600/);
      assert.match(looked.output, /RESEND_API_KEY is not set/);
      assert.deepEqual(
        api.seen.map((s) => s.method),
        ["GET"],
      );

      const applied = await run("scripts/supabase-auth.mjs", ["apply"], {
        ...env,
        RESEND_API_KEY: KEY,
      });
      assert.equal(applied.code, 0, applied.output);
      const patch = api.seen.find((s) => s.method === "PATCH")?.body ?? {};
      assert.equal(patch.smtp_pass, KEY);
      assert.equal(patch.smtp_host, "smtp.resend.com");
      assert.equal(patch.mailer_templates_magic_link_content, template);
      assert.equal(patch.mailer_otp_exp, 600);
      assert.equal(project.rate_limit_email_sent, 30);
      for (const output of [looked.output, applied.output]) {
        assert.ok(!output.includes(KEY));
        assert.ok(!output.includes(TOKEN));
        assert.ok(!output.includes("{{ .Token }}"));
      }
      await api.close();
    },
  );

  await check(
    "a token that cannot change settings is reported, not hidden",
    async () => {
      const api = await standIn(() => ({
        status: 403,
        body: { message: `forbidden for ${KEY}` },
      }));
      const env = {
        SUPABASE_API_URL: api.url,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_PROJECT_ID: "ref123",
        RESEND_API_KEY: KEY,
      };
      // A pull request only warns, so an old token does not turn it red.
      const looked = await run("scripts/supabase-auth.mjs", ["check"], env);
      assert.equal(looked.code, 0, looked.output);
      assert.match(looked.output, /::warning::The access token cannot read/);
      const applied = await run("scripts/supabase-auth.mjs", ["apply"], env);
      assert.equal(applied.code, 1, applied.output);
      assert.match(applied.output, /::error::/);
      assert.ok(!applied.output.includes(KEY));
      await api.close();
    },
  );

  await check("without the secrets nothing is asked", async () => {
    const settingsRun = await run("scripts/supabase-auth.mjs", ["apply"], {});
    assert.equal(settingsRun.code, 0);
    assert.match(settingsRun.output, /::warning::SUPABASE_ACCESS_TOKEN/);
    const vercelRun = await run("scripts/vercel.mjs", ["status", "main"], {});
    assert.equal(vercelRun.code, 0);
    assert.match(vercelRun.output, /::warning::VERCEL_TOKEN/);
    const bad = await run("scripts/vercel.mjs", ["deploy", "$(x)"], {});
    assert.equal(bad.code, 2);
  });

  await check(
    "the Vercel script shows a failed build and builds again",
    async () => {
      const api = await standIn(({ method, url }) => {
        const { pathname } = new URL(url, "http://x");
        assert.match(url, /slug=booktown1/);
        if (pathname === "/v10/projects")
          return { body: { projects: [{ name: "book-town-851k" }] } };
        if (pathname === "/v7/deployments")
          return {
            body: {
              deployments: [
                {
                  uid: "dpl_1",
                  created: 0,
                  readyState: "ERROR",
                  url: "a.vercel.app",
                  meta: {},
                },
              ],
            },
          };
        if (pathname === "/v3/deployments/dpl_1/events")
          return { body: [{ type: "stderr", text: "Error: out of memory" }] };
        if (method === "POST" && pathname === "/v13/deployments")
          return {
            body: { id: "dpl_2", url: "b.vercel.app", readyState: "READY" },
          };
        return { status: 404, body: {} };
      });
      const env = {
        VERCEL_API_URL: api.url,
        VERCEL_TOKEN: "vcp_token_for_tests",
        VERCEL_TEAM: "booktown1",
        VERCEL_PROJECT: "book-town-851k",
        GITHUB_REPOSITORY: "mitsuakisudo2-dot/book-town",
      };
      const status = await run(
        "scripts/vercel.mjs",
        ["status", "claude/x"],
        env,
      );
      assert.equal(status.code, 0, status.output);
      assert.match(status.output, /Projects: book-town-851k/);
      assert.match(status.output, /ERROR/);
      assert.match(status.output, /Error: out of memory/);
      assert.match(
        api.seen.find((s) => s.url.startsWith("/v7/"))?.url ?? "",
        /branch=claude%2Fx/,
      );

      const preview = await run(
        "scripts/vercel.mjs",
        ["deploy", "claude/x"],
        env,
      );
      assert.equal(preview.code, 0, preview.output);
      const production = await run(
        "scripts/vercel.mjs",
        ["deploy", "main"],
        env,
      );
      assert.equal(production.code, 0, production.output);
      const [first, second] = api.seen
        .filter((s) => s.method === "POST")
        .map((s) => s.body ?? {});
      assert.deepEqual(first.gitSource, {
        type: "github",
        org: "mitsuakisudo2-dot",
        repo: "book-town",
        ref: "claude/x",
      });
      assert.equal(first.target, undefined);
      assert.equal(second.target, "production");
      for (const output of [status.output, preview.output, production.output])
        assert.ok(!output.includes("vcp_token_for_tests"));
      await api.close();
    },
  );

  await check(
    "after a push to main, production is built only when Vercel missed it",
    async () => {
      const SHA = "cd6118cc064fdea09546208810d9a168f9487570";
      let listed: { meta: object; readyState: string }[] = [];
      const api = await standIn(({ method, url }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname === "/v7/deployments")
          return {
            body: {
              deployments: listed.map((entry, index) => ({
                uid: "dpl_" + index,
                created: 0,
                url: "c.vercel.app",
                ...entry,
              })),
            },
          };
        if (method === "POST" && pathname === "/v13/deployments")
          return {
            body: { id: "dpl_9", url: "d.vercel.app", readyState: "READY" },
          };
        return { status: 404, body: {} };
      });
      const env = {
        VERCEL_API_URL: api.url,
        VERCEL_TOKEN: "vcp_token_for_tests",
        VERCEL_TEAM: "booktown1",
        VERCEL_PROJECT: "book-town-851k",
        GITHUB_REPOSITORY: "mitsuakisudo2-dot/book-town",
        DEPLOY_SHA: SHA,
        ENSURE_WAIT_SECONDS: "0",
        ENSURE_POLL_SECONDS: "0",
      };
      const posts = () => api.seen.filter((s) => s.method === "POST").length;

      listed = [{ meta: { githubCommitSha: SHA }, readyState: "READY" }];
      const built = await run("scripts/vercel.mjs", ["ensure", "main"], env);
      assert.equal(built.code, 0, built.output);
      assert.match(built.output, /Vercel built it/);
      assert.equal(posts(), 0);

      listed = [
        { meta: { githubCommitSha: "0".repeat(40) }, readyState: "READY" },
      ];
      const missed = await run("scripts/vercel.mjs", ["ensure", "main"], env);
      assert.equal(missed.code, 0, missed.output);
      assert.match(missed.output, /did not start cd6118c/);
      assert.equal(posts(), 1);

      listed = [{ meta: { githubCommitSha: SHA }, readyState: "ERROR" }];
      const stopped = await run("scripts/vercel.mjs", ["ensure", "main"], env);
      assert.equal(stopped.code, 0, stopped.output);
      assert.match(stopped.output, /Vercel stopped/);
      assert.equal(posts(), 2);
      const body = api.seen.filter((s) => s.method === "POST")[1].body ?? {};
      assert.equal(body.target, "production");

      const odd = await run("scripts/vercel.mjs", ["ensure", "main"], {
        ...env,
        DEPLOY_SHA: "$(x)",
      });
      assert.equal(odd.code, 1);
      assert.equal(posts(), 2);
      for (const output of [built.output, missed.output, stopped.output])
        assert.ok(!output.includes("vcp_token_for_tests"));
      await api.close();
    },
  );

  console.log(passed + " hosted settings checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
