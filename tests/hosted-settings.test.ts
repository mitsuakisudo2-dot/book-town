import assert from "node:assert/strict";
import { execFile, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import {
  allowList,
  authChanges,
  desiredAuth,
  redact,
  shown,
} from "../scripts/supabase-auth.mjs";
import {
  deploymentLine,
  dnsPlan,
  domainLine,
  siteDomainPlan,
  logLines,
  migrationsBetween,
  recordLine,
  relativeName,
  rollbackTarget,
  tokenLine,
  validBranch,
} from "../scripts/vercel.mjs";
import {
  backupVerdict,
  firstScript,
  issueBody,
  issuePlan,
  pageVerdict,
  usageVerdict,
  errorsVerdict,
  keysVerdict,
  unconfirmedVerdict,
} from "../scripts/watch.mjs";

// The scripts that change the hosted Supabase and Vercel settings, without
// calling either: what they ask for, and what they let into the public log.

const settings = JSON.parse(readFileSync("supabase/hosted-auth.json", "utf8"));
const template = readFileSync("supabase/templates/magic_link.html", "utf8");
const emailChangeTemplate = readFileSync(
  "supabase/templates/email_change.html",
  "utf8",
);
const templates = { template, emailChangeTemplate };
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
  answer: (seen: Seen) => { status?: number; body: unknown; html?: boolean },
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
    const { status = 200, body, html } = answer(entry);
    if (html) {
      response.writeHead(status, { "Content-Type": "text/html" });
      response.end(String(body));
      return;
    }
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
const CAPTCHA = "0x4AAAAcaptcha_secret_for_tests";

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
      // The email comes from the site's own domain, which Resend verified.
      assert.equal(
        settings.email.sender,
        "login@" + new URL(settings.site.url).host,
      );
      // The email promises the code lasts ten minutes.
      assert.equal(settings.code.expiresInSeconds, 600);
      assert.match(template, /10分/);
      assert.match(template, /\{\{ \.Token \}\}/);
    },
  );

  await check(
    "without a Resend key only the site, code and limit settings change",
    () => {
      const wanted = desiredAuth(settings, {
        ...templates,
        resendKey: "",
        captchaSecret: "0x4AAAAsecret",
      });
      assert.deepEqual(wanted, {
        site_url: "https://booktown.page",
        mailer_otp_length: 6,
        mailer_otp_exp: 600,
        rate_limit_otp: 30,
        rate_limit_verify: 30,
        rate_limit_token_refresh: 150,
        mailer_secure_email_change_enabled: true,
        mailer_autoconfirm: false,
        passkey_enabled: true,
        webauthn_rp_id: "booktown.page",
        webauthn_rp_display_name: "BookTown",
        webauthn_rp_origins: "https://booktown.page,https://www.booktown.page",
        // The human check is on (2026-10-18, step 2 in docs/09).
        security_captcha_enabled: true,
        security_captcha_provider: "turnstile",
      });
    },
  );

  await check(
    "passkeys are on, here as there, for booktown.page's own pages",
    () => {
      assert.equal(settings.passkey.enabled, true);
      assert.equal(local("auth.passkey", "enabled"), true);
      // Every origin is the relying party or under it, over https; the
      // local one is localhost, for the real-browser check.
      for (const origin of settings.passkey.origins) {
        const host = new URL(origin).hostname;
        assert.equal(new URL(origin).protocol, "https:");
        assert.ok(
          host === settings.passkey.relyingParty ||
            host.endsWith("." + settings.passkey.relyingParty),
          origin,
        );
      }
      assert.ok(settings.passkey.origins.length <= 5);
      assert.equal(new URL(settings.site.url).hostname, "booktown.page");
      assert.equal(local("auth.webauthn", "rp_id"), "localhost");
      assert.equal(
        local("auth.webauthn", "rp_display_name"),
        settings.passkey.name,
      );
      for (const key of [
        "passkey_enabled",
        "webauthn_rp_id",
        "webauthn_rp_origins",
      ])
        assert.notEqual(shown(key, "x"), "(hidden)");
    },
  );

  await check(
    "changing the address takes a code from both addresses, here as there",
    () => {
      assert.equal(settings.emailChange.confirmBoth, true);
      assert.equal(
        local("auth.email", "double_confirm_changes"),
        settings.emailChange.confirmBoth,
      );
      // While confirmations are off, the auth server takes either code
      // alone, so they stay on in both places.
      assert.equal(local("auth.email", "enable_confirmations"), true);
      assert.equal(
        settings.emailChange.subject,
        local("auth.email.template.email_change", "subject"),
      );
      assert.equal(
        "./supabase/" + settings.emailChange.template,
        local("auth.email.template.email_change", "content_path"),
      );
      assert.match(emailChangeTemplate, /\{\{ \.Token \}\}/);
      // Neither address is written in it: a mistyped new address must not
      // learn the reader's current one.
      assert.doesNotMatch(
        emailChangeTemplate,
        /\.(NewEmail|Email|SendingTo)\b/,
      );
      assert.match(emailChangeTemplate, /10分/);
      // A code, not a link: the screen asks for each address's code.
      assert.doesNotMatch(emailChangeTemplate, /ConfirmationURL/);
      assert.equal(shown("mailer_secure_email_change_enabled", true), "true");
      assert.equal(shown("mailer_autoconfirm", false), "false");
      assert.match(
        shown("mailer_templates_email_change_content", emailChangeTemplate),
        /^\d+ characters, sha256 [0-9a-f]{12}$/,
      );
    },
  );

  await check(
    "the sign-in limits stay at or below Supabase's own defaults",
    () => {
      // Supabase starts a project at 30, 30 and 150 per five minutes. Raising
      // them lets a script try more login codes, so it is a decision, not a
      // tidy-up.
      assert.ok(settings.limits.codeRequestsPer5Minutes <= 30);
      assert.ok(settings.limits.codeChecksPer5Minutes <= 30);
      assert.ok(settings.limits.sessionRefreshesPer5Minutes <= 150);
      // A login code is six digits and lasts ten minutes, so one address can
      // try only a tiny share of them before it runs out.
      const tries = settings.limits.codeChecksPer5Minutes * 2 + 30;
      assert.ok(tries / 10 ** settings.code.length < 0.001);
      // The local Supabase counts the same way and starts at the same limits.
      assert.equal(
        settings.limits.codeRequestsPer5Minutes,
        local("auth.rate_limit", "sign_in_sign_ups"),
      );
      assert.equal(
        settings.limits.codeChecksPer5Minutes,
        local("auth.rate_limit", "token_verifications"),
      );
      assert.equal(
        settings.limits.sessionRefreshesPer5Minutes,
        local("auth.rate_limit", "token_refresh"),
      );
      for (const key of [
        "rate_limit_otp",
        "rate_limit_verify",
        "rate_limit_token_refresh",
      ])
        assert.equal(shown(key, 30), "30");
    },
  );

  await check(
    "login links may return to the site, and to every old address",
    () => {
      assert.deepEqual(settings.site.returnTo, ["https://booktown.page/**"]);
      const old =
        "https://book-town-851k.vercel.app/**,https://book-town-851k-git-claude-stage2-login-booktown1.vercel.app/**";
      assert.equal(
        allowList(old, settings.site.returnTo),
        old + ",https://booktown.page/**",
      );
      // Already there: nothing changes, so nothing is sent.
      assert.equal(
        allowList(old + ",https://booktown.page/**", settings.site.returnTo),
        old + ",https://booktown.page/**",
      );
      assert.equal(allowList(" a , ,b", ["b", "c"]), "a,b,c");
      assert.equal(allowList(null, ["c"]), "c");
    },
  );

  await check("with a Resend key the email goes through Resend", () => {
    const wanted = desiredAuth(settings, {
      ...templates,
      resendKey: KEY,
      captchaSecret: "0x4AAAAsecret",
    });
    assert.equal(wanted.smtp_host, "smtp.resend.com");
    assert.equal(wanted.smtp_port, "465");
    assert.equal(wanted.smtp_user, "resend");
    assert.equal(wanted.rate_limit_email_sent, 30);
    assert.equal(wanted.mailer_templates_magic_link_content, template);
    assert.equal(
      wanted.mailer_templates_email_change_content,
      emailChangeTemplate,
    );
    assert.equal(
      wanted.mailer_subjects_email_change,
      "BookTown のメールアドレスの変更",
    );
    // The key is sent as the password, never kept with the other settings.
    assert.ok(!Object.values(wanted).includes(KEY));
  });

  await check("only what differs is changed", () => {
    const wanted = desiredAuth(settings, {
      ...templates,
      resendKey: KEY,
      captchaSecret: "0x4AAAAsecret",
    });
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

  await check("the human check goes on only with its secret", () => {
    const on = { ...settings, captcha: { ...settings.captcha, on: true } };
    assert.throws(
      () => desiredAuth(on, { ...templates, resendKey: "" }),
      /TURNSTILE_SECRET_KEY/,
    );
    const wanted = desiredAuth(on, {
      ...templates,
      resendKey: "",
      captchaSecret: "0x4AAAAsecret",
    });
    assert.equal(wanted.security_captcha_enabled, true);
    assert.equal(wanted.security_captcha_provider, "turnstile");
    // Like the email password, the secret is sent apart and never logged.
    assert.ok(!Object.values(wanted).includes("0x4AAAAsecret"));
    assert.deepEqual(
      authChanges(
        { ...wanted, security_captcha_secret: "0x4AAAAsecret" },
        wanted,
        "",
        "0x4AAAAsecret",
      ),
      [],
    );
    assert.deepEqual(authChanges(wanted, wanted, "", "0x4AAAAsecret"), [
      "security_captcha_secret",
    ]);
    assert.equal(shown("security_captcha_secret", "0x4AAAAsecret"), "(hidden)");
    assert.equal(
      shown("security_captcha_provider", "turnstile"),
      '"turnstile"',
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

  await check("the key a run used is named, never shown", () => {
    assert.equal(
      tokenLine({
        name: "github",
        expiresAt: null,
        scopes: [{ type: "team" }],
      }),
      "Key in use: github, expires never, scope team",
    );
    assert.equal(
      tokenLine({
        name: "booktown-vercel-production",
        expiresAt: Date.UTC(2027, 0, 19, 0, 0, 59),
        scopes: [{ type: "team", projectId: "prj_x" }],
      }),
      "Key in use: booktown-vercel-production, expires 2027-01-19T00:00Z, scope team:project",
    );
    assert.equal(tokenLine(undefined), "Key in use: (no name), expires never");
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
        uri_allow_list: "https://book-town-851k.vercel.app/**",
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

      // The human check is on, so without its secret nothing goes on.
      const unset = await run("scripts/supabase-auth.mjs", ["check"], env);
      assert.notEqual(unset.code, 0, unset.output);
      assert.match(unset.output, /captcha\.on needs TURNSTILE_SECRET_KEY/);
      api.seen.length = 0;

      const looked = await run("scripts/supabase-auth.mjs", ["check"], {
        ...env,
        TURNSTILE_SECRET_KEY: CAPTCHA,
      });
      assert.equal(looked.code, 0, looked.output);
      assert.match(looked.output, /mailer_otp_exp: 3600 -> 600/);
      assert.match(
        looked.output,
        /site_url: "https:\/\/book-town-851k\.vercel\.app" -> "https:\/\/booktown\.page"/,
      );
      assert.match(looked.output, /RESEND_API_KEY is not set/);
      assert.match(
        looked.output,
        /TURNSTILE_SECRET_KEY: set among the repository secrets/,
      );
      assert.match(looked.output, /security_captcha_enabled: .*-> true/);
      assert.deepEqual(
        api.seen.map((s) => s.method),
        ["GET"],
      );
      // look, main's check before the approval, reads the same way.
      const lookedOnMain = await run("scripts/supabase-auth.mjs", ["look"], {
        ...env,
        TURNSTILE_SECRET_KEY: CAPTCHA,
      });
      assert.equal(lookedOnMain.code, 0, lookedOnMain.output);
      assert.match(lookedOnMain.output, /would change once this is on main/);
      assert.ok(!api.seen.some((s) => s.method === "PATCH"));

      const applied = await run("scripts/supabase-auth.mjs", ["apply"], {
        ...env,
        RESEND_API_KEY: KEY,
        TURNSTILE_SECRET_KEY: CAPTCHA,
      });
      assert.equal(applied.code, 0, applied.output);
      const patch = api.seen.find((s) => s.method === "PATCH")?.body ?? {};
      assert.equal(patch.smtp_pass, KEY);
      assert.equal(patch.smtp_host, "smtp.resend.com");
      assert.equal(patch.mailer_templates_magic_link_content, template);
      assert.equal(
        patch.mailer_templates_email_change_content,
        emailChangeTemplate,
      );
      assert.equal(patch.mailer_secure_email_change_enabled, true);
      assert.equal(patch.mailer_otp_exp, 600);
      assert.equal(patch.site_url, "https://booktown.page");
      assert.equal(
        patch.uri_allow_list,
        "https://book-town-851k.vercel.app/**,https://booktown.page/**",
      );
      assert.equal(project.rate_limit_email_sent, 30);
      assert.equal(patch.security_captcha_enabled, true);
      assert.equal(patch.security_captcha_provider, "turnstile");
      assert.equal(patch.security_captcha_secret, CAPTCHA);
      for (const output of [unset.output, looked.output, applied.output]) {
        assert.ok(!output.includes(CAPTCHA));
        assert.ok(!output.includes(KEY));
        assert.ok(!output.includes(TOKEN));
        assert.ok(!output.includes("{{ .Token }}"));
      }
      await api.close();
    },
  );

  await check(
    "a change Supabase takes a moment to show is read again, not failed",
    async () => {
      const old = { mailer_otp_exp: 3600, site_url: "https://booktown.page" };
      let project: Record<string, unknown> = { ...old };
      // How many reads after a change still show the old settings, like the
      // reload after the human check went on (2026-10-18).
      let staleReads = 0;
      let stale = 0;
      const api = await standIn(({ method, body }) => {
        if (method === "PATCH") {
          project = { ...project, ...body };
          stale = staleReads;
          return { body: project };
        }
        if (stale > 0) {
          stale -= 1;
          return { body: old };
        }
        return { body: project };
      });
      const env = {
        SUPABASE_API_URL: api.url,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_PROJECT_ID: "ref123",
        TURNSTILE_SECRET_KEY: CAPTCHA,
        SETTINGS_READ_AGAIN_MS: "10",
      };

      staleReads = 2;
      const caughtUp = await run("scripts/supabase-auth.mjs", ["apply"], env);
      assert.equal(caughtUp.code, 0, caughtUp.output);
      assert.match(caughtUp.output, /Changed \d+ setting\(s\)/);

      // A setting that never shows is still a failure.
      project = { ...old };
      staleReads = 100;
      const never = await run("scripts/supabase-auth.mjs", ["apply"], env);
      assert.equal(never.code, 1, never.output);
      assert.match(
        never.output,
        /These settings did not take: .*mailer_otp_exp/,
      );
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
        TURNSTILE_SECRET_KEY: CAPTCHA,
      };
      // A pull request only warns, so an old token does not turn it red.
      const looked = await run("scripts/supabase-auth.mjs", ["check"], env);
      assert.equal(looked.code, 0, looked.output);
      assert.match(looked.output, /::warning::The access token cannot read/);
      // On main the look before the approval may not pass without reading.
      const strict = await run("scripts/supabase-auth.mjs", ["look"], env);
      assert.equal(strict.code, 1, strict.output);
      assert.match(strict.output, /::error::The access token cannot read/);
      assert.ok(!strict.output.includes(KEY));
      const applied = await run("scripts/supabase-auth.mjs", ["apply"], env);
      assert.equal(applied.code, 1, applied.output);
      assert.match(applied.output, /::error::/);
      assert.ok(!applied.output.includes(KEY));
      await api.close();
    },
  );

  await check("without the secrets nothing is asked", async () => {
    const settingsRun = await run("scripts/supabase-auth.mjs", ["check"], {});
    assert.equal(settingsRun.code, 0);
    assert.match(settingsRun.output, /::warning::SUPABASE_ACCESS_TOKEN/);
    // look and apply are main's: a missing key stops them.
    for (const mode of ["look", "apply"]) {
      const strict = await run("scripts/supabase-auth.mjs", [mode], {});
      assert.equal(strict.code, 1, strict.output);
      assert.match(strict.output, /::error::SUPABASE_ACCESS_TOKEN/);
    }
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
        // Vercel refuses the team's slug on a key's own details.
        if (pathname !== "/v5/user/tokens/current")
          assert.match(url, /slug=booktown1/);
        else if (!/slug=/.test(url))
          return {
            body: {
              token: {
                name: "booktown-vercel-site",
                expiresAt: Date.UTC(2027, 9, 21, 5, 30),
                scopes: [{ type: "team" }],
              },
            },
          };
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
      assert.match(
        status.output,
        /Key in use: booktown-vercel-site, expires 2027-10-21T05:30Z, scope team/,
      );
      assert.doesNotMatch(status.output, /vcp_token_for_tests/);
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

  await check(
    "Resend's records become Vercel's, and nothing is overwritten",
    () => {
      const domain = "booktown.page";
      assert.equal(
        relativeName("resend._domainkey.booktown.page.", domain),
        "resend._domainkey",
      );
      assert.equal(relativeName("send", domain), "send");
      assert.equal(relativeName("@", domain), "");
      assert.equal(relativeName("booktown.page", domain), "");
      const resend = [
        {
          record: "SPF",
          type: "MX",
          name: "send",
          value: "feedback-smtp.ap-northeast-1.amazonses.com",
          priority: 10,
        },
        {
          record: "SPF",
          type: "TXT",
          name: "send",
          value: '"v=spf1 include:amazonses.com ~all"',
        },
        {
          record: "DKIM",
          type: "TXT",
          name: "resend._domainkey",
          value: "p=MIGf",
        },
        // Receiving would send the domain's own mail to Resend.
        {
          record: "Receiving",
          type: "MX",
          name: "@",
          value: "inbound-smtp.ap-northeast-1.amazonaws.com",
          priority: 10,
        },
      ];
      const vercel = [
        { type: "ALIAS", name: "", value: "cname.vercel-dns-017.com." },
        { type: "CAA", name: "", value: '0 issue "letsencrypt.org"' },
      ];
      const { add, clash } = dnsPlan(resend, vercel, domain);
      assert.deepEqual(clash, []);
      assert.deepEqual(add.map(recordLine), [
        "MX send 10 feedback-smtp.ap-northeast-1.amazonses.com",
        "TXT send v=spf1 include:amazonses.com ~all",
        "TXT resend._domainkey p=MIGf",
        "TXT _dmarc v=DMARC1; p=none;",
      ]);
      // Run again once they are there: nothing more to add.
      const after = dnsPlan(resend, [...vercel, ...add], domain);
      assert.deepEqual(after, { add: [], clash: [] });
      // Someone's own DMARC stays, and another key at the same name clashes.
      const theirs = dnsPlan(
        resend,
        [
          { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=reject;" },
          { type: "TXT", name: "resend._domainkey", value: "p=OLD" },
          { type: "TXT", name: "send", value: "v=spf1 -all" },
          { type: "TXT", name: "send", value: "google-site-verification=x" },
        ],
        domain,
      );
      assert.deepEqual(theirs.clash.map(recordLine), [
        "TXT send v=spf1 include:amazonses.com ~all",
        "TXT resend._domainkey p=MIGf",
      ]);
      assert.deepEqual(theirs.add.map(recordLine), [
        "MX send 10 feedback-smtp.ap-northeast-1.amazonses.com",
      ]);
    },
  );

  await check("the site gets its domain, with www sent on to it", () => {
    const vercelApp = { name: "book-town-851k.vercel.app", verified: true };
    assert.deepEqual(siteDomainPlan([vercelApp], "booktown.page"), {
      add: [
        { name: "booktown.page" },
        {
          name: "www.booktown.page",
          redirect: "booktown.page",
          redirectStatusCode: 308,
        },
      ],
      fix: [],
    });
    const done = siteDomainPlan(
      [
        vercelApp,
        { name: "booktown.page", redirect: null },
        {
          name: "www.booktown.page",
          redirect: "booktown.page",
          redirectStatusCode: 308,
        },
      ],
      "booktown.page",
    );
    assert.deepEqual(done, { add: [], fix: [] });
    // Vercel's own suggestion sends the domain to www; turn it round.
    const turned = siteDomainPlan(
      [
        {
          name: "booktown.page",
          redirect: "www.booktown.page",
          redirectStatusCode: 308,
        },
        { name: "www.booktown.page" },
      ],
      "booktown.page",
    );
    assert.deepEqual(
      turned.fix.map((d) => d.name),
      ["booktown.page", "www.booktown.page"],
    );
  });

  await check("each address says where it goes and whether it works", () => {
    assert.equal(
      domainLine(
        { name: "booktown.page", verified: true },
        { misconfigured: false },
      ),
      "booktown.page verified DNS ok",
    );
    assert.equal(
      domainLine(
        {
          name: "www.booktown.page",
          verified: true,
          redirect: "booktown.page",
          redirectStatusCode: 308,
        },
        { misconfigured: true },
      ),
      "www.booktown.page verified -> booktown.page (308) DNS not pointing here",
    );
    assert.equal(
      domainLine({ name: "book-town-851k.vercel.app", verified: true }, null),
      "book-town-851k.vercel.app verified",
    );
  });

  await check(
    "mail-apply adds the domain to Resend, its records to Vercel, and waits",
    async () => {
      const ADMIN = "re_admin_key_for_tests_1";
      let resendDomains: Record<string, unknown>[] = [];
      let checks = 0;
      const resend = await standIn(({ method, url, body }) => {
        if (method === "GET" && url === "/domains")
          return { body: { object: "list", data: resendDomains } };
        if (method === "POST" && url === "/domains") {
          resendDomains = [
            { id: "d_1", name: body?.name, status: "not_started" },
          ];
          return { body: { ...resendDomains[0], region: body?.region } };
        }
        if (method === "POST" && url === "/domains/d_1/verify")
          return { body: { object: "domain", id: "d_1" } };
        if (method === "GET" && url === "/domains/d_1") {
          checks += 1;
          const status = checks >= 3 ? "verified" : "pending";
          return {
            body: {
              id: "d_1",
              name: "booktown.page",
              status,
              records: [
                {
                  record: "SPF",
                  type: "MX",
                  name: "send",
                  value: "feedback-smtp.ap-northeast-1.amazonses.com",
                  priority: 10,
                  status,
                },
                {
                  record: "SPF",
                  type: "TXT",
                  name: "send",
                  value: "v=spf1 include:amazonses.com ~all",
                  status,
                },
                {
                  record: "DKIM",
                  type: "TXT",
                  name: "resend._domainkey",
                  value: "p=MIGf",
                  status,
                },
              ],
            },
          };
        }
        return { status: 404, body: {} };
      });
      const vercelRecords: Record<string, unknown>[] = [
        { type: "ALIAS", name: "", value: "cname.vercel-dns-017.com." },
      ];
      const vercel = await standIn(({ method, url, body }) => {
        const { pathname } = new URL(url, "http://x");
        assert.match(url, /slug=booktown1/);
        if (
          method === "GET" &&
          pathname === "/v4/domains/booktown.page/records"
        )
          return { body: { records: vercelRecords } };
        if (
          method === "POST" &&
          pathname === "/v2/domains/booktown.page/records"
        ) {
          vercelRecords.push(body ?? {});
          return { body: { uid: "rec_" + vercelRecords.length } };
        }
        if (pathname === "/v9/projects/book-town-851k/domains")
          return {
            body: {
              domains: [
                { name: "booktown.page", verified: true },
                {
                  name: "www.booktown.page",
                  verified: true,
                  redirect: "booktown.page",
                  redirectStatusCode: 308,
                },
                { name: "book-town-851k.vercel.app", verified: true },
              ],
            },
          };
        if (pathname.startsWith("/v6/domains/"))
          return { body: { misconfigured: false } };
        return { status: 404, body: {} };
      });
      const env = {
        VERCEL_API_URL: vercel.url,
        RESEND_API_URL: resend.url,
        VERCEL_TOKEN: "vcp_token_for_tests",
        VERCEL_TEAM: "booktown1",
        VERCEL_PROJECT: "book-town-851k",
        MAIL_DOMAIN: "booktown.page",
        RESEND_API_KEY: KEY,
        RESEND_ADMIN_KEY: ADMIN,
        MAIL_WAIT_SECONDS: "5",
        MAIL_POLL_SECONDS: "0",
      };

      const looked = await run("scripts/vercel.mjs", ["mail", "main"], env);
      assert.equal(looked.code, 0, looked.output);
      assert.match(
        looked.output,
        /not in Resend yet; mail-apply adds it \(ap-northeast-1\)/,
      );
      assert.equal(resendDomains.length, 0);

      const applied = await run(
        "scripts/vercel.mjs",
        ["mail-apply", "main"],
        env,
      );
      assert.equal(applied.code, 0, applied.output);
      const created = resend.seen.find(
        (s) => s.method === "POST" && s.url === "/domains",
      );
      assert.deepEqual(created?.body, {
        name: "booktown.page",
        region: "ap-northeast-1",
      });
      assert.deepEqual(
        vercelRecords.slice(1).map((r) => recordLine(r as never)),
        [
          "MX send 10 feedback-smtp.ap-northeast-1.amazonses.com",
          "TXT send v=spf1 include:amazonses.com ~all",
          "TXT resend._domainkey p=MIGf",
          "TXT _dmarc v=DMARC1; p=none;",
        ],
      );
      assert.ok(resend.seen.some((s) => s.url === "/domains/d_1/verify"));
      assert.match(applied.output, /booktown\.page is verified/);

      // A second run finds everything in place and changes nothing.
      const posts = vercel.seen.filter((s) => s.method === "POST").length;
      const again = await run(
        "scripts/vercel.mjs",
        ["mail-apply", "main"],
        env,
      );
      assert.equal(again.code, 0, again.output);
      assert.match(again.output, /already has every record/);
      assert.equal(
        vercel.seen.filter((s) => s.method === "POST").length,
        posts,
      );

      const domains = await run("scripts/vercel.mjs", ["domains", "main"], env);
      // Only looking: the project's addresses are left alone.
      assert.equal(
        vercel.seen.filter((s) => s.url.startsWith("/v10/projects")).length,
        0,
      );
      assert.equal(domains.code, 0, domains.output);
      assert.match(
        domains.output,
        /www\.booktown\.page verified -> booktown\.page \(308\) DNS ok/,
      );
      assert.match(domains.output, /TXT _dmarc v=DMARC1; p=none;/);

      // The admin key is used, and no key reaches the log.
      const auth = resend.seen.length;
      assert.ok(auth > 0);
      for (const output of [
        looked.output,
        applied.output,
        again.output,
        domains.output,
      ]) {
        assert.ok(!output.includes(ADMIN));
        assert.ok(!output.includes(KEY));
        assert.ok(!output.includes("vcp_token_for_tests"));
      }
      await resend.close();
      await vercel.close();
    },
  );

  await check("domains-apply adds the site's addresses once", async () => {
    let listed: Record<string, unknown>[] = [
      { name: "book-town-851k.vercel.app", verified: true },
    ];
    const vercel = await standIn(({ method, url, body }) => {
      const { pathname } = new URL(url, "http://x");
      if (
        method === "GET" &&
        pathname === "/v9/projects/book-town-851k/domains"
      )
        return { body: { domains: listed } };
      if (
        method === "POST" &&
        pathname === "/v10/projects/book-town-851k/domains"
      ) {
        listed = [...listed, { ...body, verified: true }];
        return { body: { ...body, verified: true } };
      }
      if (pathname.startsWith("/v6/domains/"))
        return { body: { misconfigured: false } };
      if (pathname === "/v4/domains/booktown.page/records")
        return { body: { records: [] } };
      return { status: 404, body: {} };
    });
    const env = {
      VERCEL_API_URL: vercel.url,
      VERCEL_TOKEN: "vcp_token_for_tests",
      VERCEL_TEAM: "booktown1",
      VERCEL_PROJECT: "book-town-851k",
      SITE_DOMAIN: "booktown.page",
      MAIL_DOMAIN: "booktown.page",
    };
    const first = await run(
      "scripts/vercel.mjs",
      ["domains-apply", "main"],
      env,
    );
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /booktown\.page verified DNS ok/);
    assert.match(
      first.output,
      /www\.booktown\.page verified -> booktown\.page \(308\) DNS ok/,
    );
    const second = await run(
      "scripts/vercel.mjs",
      ["domains-apply", "main"],
      env,
    );
    assert.equal(second.code, 0, second.output);
    assert.match(second.output, /The addresses are in place/);
    assert.equal(vercel.seen.filter((s) => s.method === "POST").length, 2);
    const odd = await run("scripts/vercel.mjs", ["domains-apply", "main"], {
      ...env,
      SITE_DOMAIN: "$(x)",
    });
    assert.equal(odd.code, 1);
    await vercel.close();
  });

  await check(
    "a sending-only Resend key is reported, and nothing changes",
    async () => {
      const resend = await standIn(() => ({
        status: 401,
        body: {
          statusCode: 401,
          name: "restricted_api_key",
          message: "This API key is restricted to only send emails",
        },
      }));
      const vercel = await standIn(() => ({ body: { records: [] } }));
      const out = await run("scripts/vercel.mjs", ["mail-apply", "main"], {
        VERCEL_API_URL: vercel.url,
        RESEND_API_URL: resend.url,
        VERCEL_TOKEN: "vcp_token_for_tests",
        VERCEL_TEAM: "booktown1",
        VERCEL_PROJECT: "book-town-851k",
        MAIL_DOMAIN: "booktown.page",
        RESEND_API_KEY: KEY,
      });
      assert.equal(out.code, 1, out.output);
      assert.match(out.output, /::error::This Resend key may only send email/);
      assert.match(out.output, /RESEND_ADMIN_KEY/);
      assert.ok(!out.output.includes(KEY));
      assert.equal(vercel.seen.length, 0);
      await resend.close();
      await vercel.close();
    },
  );

  await check(
    "rollback goes back to the production build before the current one",
    () => {
      const current = { id: "dpl_c", created: 30, readyState: "READY" };
      const list = [
        {
          uid: "dpl_n",
          created: 40,
          readyState: "READY",
          target: "production",
        },
        {
          uid: "dpl_c",
          created: 30,
          readyState: "READY",
          target: "production",
        },
        {
          uid: "dpl_e",
          created: 25,
          readyState: "ERROR",
          target: "production",
        },
        { uid: "dpl_p", created: 20, readyState: "READY", target: null },
        {
          uid: "dpl_b",
          created: 10,
          readyState: "READY",
          target: "production",
        },
        { uid: "dpl_a", created: 5, readyState: "READY", target: "production" },
      ];
      assert.equal(rollbackTarget(list, current)?.uid, "dpl_b");
      assert.equal(rollbackTarget([list[1]], current), null);
      // A commit git cannot see is never taken as "nothing changed".
      assert.equal(migrationsBetween("0".repeat(40), "1".repeat(40)), null);
      assert.equal(migrationsBetween("$(x)", "1".repeat(40)), null);
    },
  );

  await check(
    "rollback refuses when the database may have changed, and promote-latest undoes it",
    async () => {
      const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      let olderSha = head;
      const api = await standIn(({ method, url }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname === "/v13/deployments/booktown.page")
          return {
            body: {
              id: "dpl_c",
              created: 30,
              readyState: "READY",
              target: "production",
              url: "c.vercel.app",
              meta: { githubCommitSha: head },
            },
          };
        if (pathname === "/v7/deployments") {
          assert.match(url, /target=production/);
          return {
            body: {
              deployments: [
                {
                  uid: "dpl_n",
                  created: 40,
                  readyState: "READY",
                  target: "production",
                  url: "n.vercel.app",
                  meta: { githubCommitSha: head },
                },
                {
                  uid: "dpl_c",
                  created: 30,
                  readyState: "READY",
                  target: "production",
                  url: "c.vercel.app",
                  meta: { githubCommitSha: head },
                },
                {
                  uid: "dpl_b",
                  created: 10,
                  readyState: "READY",
                  target: "production",
                  url: "b.vercel.app",
                  meta: { githubCommitSha: olderSha },
                },
              ],
            },
          };
        }
        if (method === "POST") return { body: {} };
        return { status: 404, body: {} };
      });
      const env = {
        VERCEL_API_URL: api.url,
        VERCEL_TOKEN: "vcp_token_for_tests",
        VERCEL_TEAM: "booktown1",
        VERCEL_PROJECT: "book-town-851k",
        SITE_DOMAIN: "booktown.page",
      };
      const posts = () => api.seen.filter((s) => s.method === "POST");

      const same = await run("scripts/vercel.mjs", ["rollback", "main"], env);
      assert.equal(same.code, 0, same.output);
      assert.match(same.output, /Rolled back to: .*\/\/b\.vercel\.app/);
      assert.equal(
        posts()[0].url.split("?")[0],
        "/v1/projects/book-town-851k/rollback/dpl_b",
      );

      olderSha = "0".repeat(40);
      const unknown = await run(
        "scripts/vercel.mjs",
        ["rollback", "main"],
        env,
      );
      assert.equal(unknown.code, 1, unknown.output);
      assert.match(unknown.output, /nothing was rolled back/);
      assert.equal(posts().length, 1);
      const agreed = await run("scripts/vercel.mjs", ["rollback", "main"], {
        ...env,
        ALLOW_MIGRATIONS: "yes",
      });
      assert.equal(agreed.code, 0, agreed.output);
      assert.equal(posts().length, 2);

      const preview = await run(
        "scripts/vercel.mjs",
        ["rollback", "claude/x"],
        env,
      );
      assert.equal(preview.code, 1);
      assert.equal(posts().length, 2);

      const latest = await run(
        "scripts/vercel.mjs",
        ["promote-latest", "main"],
        env,
      );
      assert.equal(latest.code, 0, latest.output);
      assert.equal(
        posts()[2].url.split("?")[0],
        "/v10/projects/book-town-851k/promote/dpl_n",
      );
      for (const output of [same.output, unknown.output, latest.output])
        assert.ok(!output.includes("vcp_token_for_tests"));
      await api.close();
    },
  );

  await check(
    "the key watch warns 30 and 7 days before a key runs out, and lists every key",
    async () => {
      const now = Date.parse("2026-12-20T03:00:00Z");
      const key = (expires: string) => [
        {
          name: "booktown-auth",
          secret: "SUPABASE_AUTH_TOKEN",
          environment: "production-auth",
          expires,
        },
      ];
      // A date is the start of that day in Tokyo: 2027-01-20 begins 30.5
      // days after `now`, 2027-01-21 31.5 days.
      assert.equal(keysVerdict(key("2027-01-21"), now, 30).ok, true);
      assert.equal(keysVerdict(key("2027-01-20"), now, 30).ok, false);
      assert.match(
        keysVerdict(key("2027-01-20"), now, 30).lines.join("\n"),
        /expires on 2027-01-20, in 30 day\(s\)[\s\S]*docs\/09「鍵の期限」/,
      );
      assert.equal(keysVerdict(key("2027-01-20"), now, 7).ok, true);
      assert.equal(keysVerdict(key("2026-12-29"), now, 7).ok, true);
      assert.equal(keysVerdict(key("2026-12-28"), now, 7).ok, false);
      assert.match(
        keysVerdict(key("2026-12-19"), now, 7).lines[0],
        /expires on 2026-12-19, which has come/,
      );
      // A key that has run out fails at both distances, not only says so.
      for (const days of [30, 7]) {
        assert.equal(keysVerdict(key("2026-12-19"), now, days).ok, false);
        assert.equal(keysVerdict(key("2025-01-01"), now, days).ok, false);
      }
      assert.equal(keysVerdict(key("never"), now, 7).ok, true);
      for (const unknown of ["", "TODO", "2027-1-19", "2027-02-30"])
        assert.equal(keysVerdict(key(unknown), now, 30).ok, false, unknown);
      assert.equal(keysVerdict([], now, 30).ok, false);
      // A date nobody confirmed is not "never": it has an issue of its own,
      // and does not hold the 30- and 7-day issues open.
      const guessed = [...key("2027-01-21"), { ...key("unknown")[0] }];
      assert.equal(keysVerdict(guessed, now, 30).ok, true);
      assert.match(
        keysVerdict(guessed, now, 30).lines.join("\n"),
        /not confirmed/,
      );
      assert.equal(unconfirmedVerdict(guessed).ok, false);
      assert.match(unconfirmedVerdict(guessed).lines[0], /not confirmed/);
      assert.equal(unconfirmedVerdict(key("never")).ok, true);

      // Every token or key a workflow reads by name is in the list, with a
      // date (or "never"), so a new key cannot run out unwatched.
      const watch = JSON.parse(readFileSync("scripts/watch.json", "utf8"));
      const listed = new Set(
        watch.keys.map((entry: { secret: string }) => entry.secret),
      );
      const workflows = execSync("cat .github/workflows/*.yml", {
        encoding: "utf8",
      });
      const tokens = new Set(
        [...workflows.matchAll(/secrets\.([A-Z_]*TOKEN)\b/g)].map(
          (found) => found[1],
        ),
      );
      assert.ok(tokens.size >= 4, [...tokens].join(", "));
      for (const token of tokens) assert.ok(listed.has(token), token);
      for (const entry of watch.keys)
        assert.match(
          entry.expires,
          /^(\d{4}-\d{2}-\d{2}|never|unknown)$/,
          `${entry.name} needs the date it expires`,
        );
      assert.match(
        readFileSync(".github/workflows/watch-run.yml", "utf8"),
        /run: node scripts\/watch\.mjs keys/,
      );
      // A pull request only warns; main is red while a key needs care.
      const tried = await run("scripts/watch.mjs", ["keys"], {});
      assert.equal(tried.code, 0, tried.output);
      if (
        watch.keys.some(
          (entry: { expires: string }) => entry.expires === "unknown",
        )
      ) {
        assert.match(tried.output, /::warning::A key needs looking after/);
        const watched = await run("scripts/watch.mjs", ["keys"], {
          REPORT_ISSUES: "on",
        });
        assert.equal(watched.code, 1, watched.output);
      }
    },
  );

  await check(
    "the backup watch fails only when a plan with backups has none recent",
    () => {
      const now = Date.parse("2026-10-18T22:00:00Z");
      const recent = {
        backups: [
          { status: "COMPLETED", inserted_at: "2026-10-17T21:00:00Z" },
          { status: "COMPLETED", inserted_at: "2026-10-16T21:00:00Z" },
          { status: "FAILED", inserted_at: "2026-10-18T21:00:00Z" },
        ],
      };
      const pro = { plan: "pro", maxHours: 30 };
      assert.equal(backupVerdict(recent, now, pro).ok, true);
      assert.match(
        backupVerdict(recent, now, pro).lines[0],
        /2026-10-17T21:00:00Z \(25\.0 hours ago\), 2 kept/,
      );
      assert.equal(backupVerdict(recent, now + 6 * 3_600_000, pro).ok, false);
      assert.equal(backupVerdict({ backups: [] }, now, pro).ok, false);
      assert.equal(
        backupVerdict({ pitr_enabled: true, backups: [] }, now, pro).ok,
        true,
      );
      const free = { plan: "free", maxHours: 30 };
      assert.equal(backupVerdict({ backups: [] }, now, free).ok, true);
      assert.match(
        backupVerdict({ backups: [] }, now, free).lines[0],
        /scripts\/watch\.json is free/,
      );
      assert.match(
        backupVerdict(recent, now, free).lines.join("\n"),
        /::warning::/,
      );
    },
  );

  await check(
    "the screen error watch counts, and never prints the words",
    () => {
      const watch = JSON.parse(readFileSync("scripts/watch.json", "utf8"));
      assert.equal(watch.screenErrorsPerDay, 1);
      const limits = { perDay: 1, rowsWarn: 2800, perHour: 200 };
      const quiet = { kinds: 0, times: 0, rows: 0, busiest_hour: 0 };
      assert.deepEqual(errorsVerdict(quiet, limits), {
        ok: true,
        lines: ["Screen errors: none in the last day."],
      });
      const some = errorsVerdict(
        { kinds: 2, times: 7, rows: 2, busiest_hour: 2 },
        limits,
      );
      assert.equal(some.ok, false);
      assert.equal(
        some.lines[0],
        "Screen errors: 2 kind(s), 7 time(s) in the last day.",
      );
      assert.equal(
        errorsVerdict(
          { kinds: 2, times: 7, rows: 2, busiest_hour: 2 },
          { ...limits, perDay: 5 },
        ).ok,
        true,
      );
      assert.equal(errorsVerdict(undefined, limits).ok, false);
      assert.equal(errorsVerdict({ kinds: 0, times: 0 }, limits).ok, false);
      // A full table drops new errors, so a quiet day there is not quiet.
      const full = errorsVerdict({ ...quiet, rows: 2800 }, limits);
      assert.equal(full.ok, false);
      assert.equal(full.lines[0], "Screen errors: none in the last day.");
      assert.match(full.lines[1], /nearly full/);
      assert.equal(errorsVerdict({ ...quiet, rows: 2799 }, limits).ok, true);
      const flooded = errorsVerdict(
        { kinds: 200, times: 200, rows: 200, busiest_hour: 200 },
        { ...limits, perDay: 1000 },
      );
      assert.equal(flooded.ok, false);
      assert.match(flooded.lines[1], /hourly limit/);
      // Numbers only: no row's words in what is printed.
      for (const line of [...full.lines, ...flooded.lines])
        assert.doesNotMatch(line, /message|place|stack/i);
    },
  );

  await check(
    "the usage watch speaks in sizes and warns near the plan's limit",
    () => {
      const free = { databaseMB: 500, storageMB: 1024 };
      const small = usageVerdict(
        { database_bytes: 16 * 1024 * 1024, storage_bytes: 0 },
        free,
        80,
      );
      assert.equal(small.ok, true);
      assert.deepEqual(small.lines, [
        "Database: 16.0 MB of 500 MB (3.2%).",
        "Files: 0.0 MB of 1024 MB (0.0%).",
      ]);
      const full = usageVerdict(
        { database_bytes: 420 * 1024 * 1024, storage_bytes: "0" },
        free,
        80,
      );
      assert.equal(full.ok, false);
      assert.equal(usageVerdict(undefined, free, 80).ok, false);
    },
  );

  await check(
    "a page is the site's page, and an issue is opened once and closed once",
    () => {
      assert.equal(
        pageVerdict("/", 200, '<html><main class="x"></main></html>'),
        null,
      );
      assert.match(pageVerdict("/", 503, "") ?? "", /answered 503/);
      assert.match(
        pageVerdict("/", 200, "<html>Parked domain</html>") ?? "",
        /without the site's page/,
      );
      assert.equal(
        firstScript(
          '<script src="/_next/static/chunks/a-1.js" async=""></script>',
        ),
        "/_next/static/chunks/a-1.js",
      );
      assert.equal(firstScript("<html></html>"), null);
      const body = issueBody("site", ["/ answered 503."], {
        owner: "mitsuakisudo2-dot",
        runUrl: "https://github.com/r/actions/runs/1",
      });
      assert.match(body, /^@mitsuakisudo2-dot 本番のページが開けません。/);
      assert.match(body, /<!-- watch:site -->$/);
      const open = [{ number: 7, body }];
      assert.deepEqual(issuePlan([], "site", false), { open: true });
      assert.deepEqual(issuePlan(open, "site", false), { already: 7 });
      assert.deepEqual(issuePlan(open, "site", true), { close: 7 });
      assert.deepEqual(issuePlan(open, "backups", true), {});
      assert.deepEqual(issuePlan(open, "backups", false), { open: true });
    },
  );

  await check(
    "the site watch opens an issue for a broken page and closes it once fixed",
    async () => {
      let broken = true;
      let issues: { number: number; body: string }[] = [];
      const site = await standIn(({ url }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname === "/_next/static/chunks/main.js")
          return { html: true, body: "1" };
        if (broken && pathname === "/walk/")
          return { status: 502, html: true, body: "Bad gateway" };
        return {
          html: true,
          body: '<main></main><script src="/_next/static/chunks/main.js"></script>',
        };
      });
      const api = await standIn(({ method, url, body }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname === "/projects/ref_test/health")
          return {
            body: [
              { name: "db", healthy: true },
              { name: "auth", healthy: true },
              { name: "rest", healthy: true },
            ],
          };
        if (
          pathname === "/repos/mitsuakisudo2-dot/book-town/issues" &&
          method === "GET"
        ) {
          assert.match(url, /state=open/);
          return { body: issues };
        }
        if (
          pathname === "/repos/mitsuakisudo2-dot/book-town/issues" &&
          method === "POST"
        ) {
          issues = [{ number: 9, body: String(body?.body) }];
          return { body: { number: 9 } };
        }
        if (
          pathname === "/repos/mitsuakisudo2-dot/book-town/issues/9" &&
          method === "PATCH"
        ) {
          issues = [];
          return { body: {} };
        }
        if (method === "POST") return { body: {} };
        return { status: 404, body: {} };
      });
      const env = {
        WATCH_SITE: site.url,
        WATCH_RETRY_SECONDS: "0",
        SUPABASE_API_URL: api.url,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_PROJECT_ID: "ref_test",
        GITHUB_API_URL: api.url,
        GITHUB_TOKEN: "ghs_token_for_tests",
        GITHUB_REPOSITORY: "mitsuakisudo2-dot/book-town",
        GITHUB_REPOSITORY_OWNER: "mitsuakisudo2-dot",
        REPORT_ISSUES: "on",
      };
      const down = await run("scripts/watch.mjs", ["site"], env);
      assert.equal(down.code, 1, down.output);
      assert.match(down.output, /\/walk\/ answered 502/);
      assert.match(down.output, /Opened issue #9/);
      const opened = api.seen.find(
        (s) => s.method === "POST" && s.url.endsWith("/issues"),
      );
      assert.equal(opened?.body?.title, "[見張り] 本番のページが開けません");
      const again = await run("scripts/watch.mjs", ["site"], env);
      assert.match(again.output, /Issue #9 already says so/);
      assert.equal(
        api.seen.filter((s) => s.method === "POST" && s.url.endsWith("/issues"))
          .length,
        1,
      );
      broken = false;
      const up = await run("scripts/watch.mjs", ["site"], env);
      assert.equal(up.code, 0, up.output);
      assert.match(up.output, /Supabase auth is healthy/);
      assert.match(up.output, /Closed issue #9/);
      const quiet = await run("scripts/watch.mjs", ["site"], {
        ...env,
        REPORT_ISSUES: "off",
      });
      assert.equal(quiet.code, 0);
      for (const output of [down.output, again.output, up.output]) {
        assert.ok(!output.includes(TOKEN));
        assert.ok(!output.includes("ghs_token_for_tests"));
      }
      await site.close();
      await api.close();
    },
  );

  await check(
    "the backup and usage watches read only, and say so without a token",
    async () => {
      const api = await standIn(({ method, url, body }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname === "/projects/ref_test/database/backups")
          return { body: { pitr_enabled: false, backups: [] } };
        if (
          method === "POST" &&
          pathname === "/projects/ref_test/database/query/read-only"
        ) {
          assert.match(String(body?.query), /^select /);
          return { body: [{ database_bytes: 16777216, storage_bytes: 0 }] };
        }
        return { status: 404, body: {} };
      });
      const env = {
        SUPABASE_API_URL: api.url,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_PROJECT_ID: "ref_test",
      };
      const backups = await run("scripts/watch.mjs", ["backups"], env);
      assert.equal(backups.code, 0, backups.output);
      assert.match(backups.output, /No daily backups/);
      const usage = await run("scripts/watch.mjs", ["usage"], env);
      assert.equal(usage.code, 0, usage.output);
      assert.match(usage.output, /Database: 16\.0 MB of 500 MB/);
      const none = await run("scripts/watch.mjs", ["backups"], {});
      assert.equal(none.code, 0);
      assert.match(none.output, /::warning::SUPABASE_ACCESS_TOKEN/);
      // On main a missing token fails, so a lost key is noticed.
      for (const kind of ["backups", "usage", "errors"]) {
        const lost = await run("scripts/watch.mjs", [kind], {
          REPORT_ISSUES: "on",
        });
        assert.equal(lost.code, 1, lost.output);
        assert.match(lost.output, /SUPABASE_WATCH_TOKEN .* is not set/);
      }
      const refusing = await standIn(() => ({
        status: 403,
        body: { message: "Missing required permission(s): database_read" },
      }));
      const refusedEnv = { ...env, SUPABASE_API_URL: refusing.url };
      const tried = await run("scripts/watch.mjs", ["usage"], refusedEnv);
      assert.equal(tried.code, 0, tried.output);
      assert.match(
        tried.output,
        /::warning::.*read access to the database's size/,
      );
      // On main a refused token is red under its own name, even for the
      // backups of a free plan: what it was to read was not read.
      for (const kind of ["backups", "usage", "errors"]) {
        const watched = await run("scripts/watch.mjs", [kind], {
          ...refusedEnv,
          REPORT_ISSUES: "on",
        });
        assert.equal(watched.code, 1, watched.output);
        assert.match(watched.output, new RegExp(`refused-${kind}: FAILED`));
        assert.doesNotMatch(
          watched.output,
          new RegExp(`^${kind}: (ok|FAILED)`, "m"),
        );
      }
      await refusing.close();
      const odd = await run(
        "scripts/watch.mjs",
        ["report", "nothing", "ok"],
        {},
      );
      assert.equal(odd.code, 2);
      await api.close();
    },
  );

  await check(
    "a refused watch token turns the watch red with an issue for each step, and only that step's answer closes it",
    async () => {
      // The routes Supabase turns the token away from.
      let refused = new Set<string>();
      let issues: { number: number; title: string; body: string }[] = [];
      let next = 20;
      const site = await standIn(({ url }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname === "/_next/static/chunks/main.js")
          return { html: true, body: "1" };
        return {
          html: true,
          body: '<main></main><script src="/_next/static/chunks/main.js"></script>',
        };
      });
      const api = await standIn(({ method, url, body }) => {
        const { pathname } = new URL(url, "http://x");
        if (pathname.startsWith("/projects/ref_test/")) {
          const route = pathname.slice("/projects/ref_test".length);
          if (refused.has(route))
            return { status: 401, body: { message: "Unauthorized" } };
          if (route === "/health")
            return { body: [{ name: "db", healthy: true }] };
          if (route === "/database/backups")
            return { body: { pitr_enabled: false, backups: [] } };
          return { body: [{ database_bytes: 16777216, storage_bytes: 0 }] };
        }
        const issuesPath = "/repos/mitsuakisudo2-dot/book-town/issues";
        if (pathname === issuesPath && method === "GET")
          return { body: issues };
        if (pathname === issuesPath && method === "POST") {
          const number = next++;
          issues.push({
            number,
            title: String(body?.title),
            body: String(body?.body),
          });
          return { body: { number } };
        }
        if (pathname.startsWith(`${issuesPath}/`) && method === "PATCH") {
          const number = Number(pathname.split("/").pop());
          issues = issues.filter((issue) => issue.number !== number);
          return { body: {} };
        }
        if (method === "POST") return { body: {} };
        return { status: 404, body: {} };
      });
      const env = {
        WATCH_SITE: site.url,
        WATCH_RETRY_SECONDS: "0",
        SUPABASE_API_URL: api.url,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_PROJECT_ID: "ref_test",
        GITHUB_API_URL: api.url,
        GITHUB_TOKEN: "ghs_token_for_tests",
        GITHUB_REPOSITORY: "mitsuakisudo2-dot/book-town",
        GITHUB_REPOSITORY_OWNER: "mitsuakisudo2-dot",
        REPORT_ISSUES: "on",
      };
      const titles = () => issues.map((issue) => issue.title).sort();
      const outputs: string[] = [];
      const watch = async (step: string) => {
        const result = await run("scripts/watch.mjs", [step], env);
        outputs.push(result.output);
        return result;
      };

      // A token turned away everywhere: each step says so under its name.
      refused = new Set(["/health", "/database/query/read-only"]);
      const site1 = await watch("site");
      assert.equal(site1.code, 1, site1.output);
      assert.deepEqual(titles(), [
        "[見張り] 見張りの鍵が Supabase に断られています（具合）",
      ]);
      assert.match(issues[0].body, /SUPABASE_WATCH_TOKEN/);
      assert.match(issues[0].body, /the project's health/);
      const usage1 = await watch("usage");
      assert.equal(usage1.code, 1, usage1.output);
      assert.match(usage1.output, /refused-usage: FAILED/);
      assert.equal(issues.length, 2);
      const again = await watch("usage");
      assert.match(again.output, /already says so/);
      assert.equal(issues.length, 2);
      // The health answering again closes the health's issue only.
      refused = new Set(["/database/query/read-only"]);
      const site2 = await watch("site");
      assert.equal(site2.code, 0, site2.output);
      assert.deepEqual(titles(), [
        "[見張り] 見張りの鍵が Supabase に断られています（使用量）",
      ]);
      refused = new Set();
      const usage2 = await watch("usage");
      assert.equal(usage2.code, 0, usage2.output);
      assert.deepEqual(issues, []);

      // Only the backups refused (a token without Backups read): the health
      // every 15 minutes still answers, and must not close the morning's
      // issue, or it would open and close every day.
      refused = new Set(["/database/backups"]);
      const backups1 = await watch("backups");
      assert.equal(backups1.code, 1, backups1.output);
      assert.match(backups1.output, /refused-backups: FAILED/);
      assert.doesNotMatch(backups1.output, /^backups: (ok|FAILED)/m);
      const between = await watch("site");
      assert.equal(between.code, 0, between.output);
      assert.deepEqual(titles(), [
        "[見張り] 見張りの鍵が Supabase に断られています（控えの一覧）",
      ]);
      refused = new Set();
      const backups2 = await watch("backups");
      assert.equal(backups2.code, 0, backups2.output);
      assert.deepEqual(issues, []);

      // Outside main a refusal only warns.
      refused = new Set(["/health"]);
      const tried = await run("scripts/watch.mjs", ["site"], {
        ...env,
        REPORT_ISSUES: "off",
      });
      assert.equal(tried.code, 0, tried.output);
      assert.match(tried.output, /::warning::Supabase answered 401/);
      assert.deepEqual(issues, []);
      for (const output of outputs) assert.ok(!output.includes(TOKEN));
      await site.close();
      await api.close();
    },
  );

  // A job's if:, on its line or folded onto the lines under it.
  const jobIf = (job: string) => {
    const lines = job.split("\n");
    const at = lines.findIndex((line) => /^    if:/.test(line));
    if (at < 0) return "";
    const first = lines[at].replace(/^    if:\s*/, "");
    if (first !== ">-" && first !== ">") return first;
    const rest: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (!/^      /.test(line)) break;
      rest.push(line.trim());
    }
    return rest.join(" ");
  };
  // Whether an if: is false for every pull request: each of its top-level
  // || choices needs, among its && parts, an event that is not a pull
  // request, or an input set to a value (a pull request has no inputs).
  const skipsPulls = (condition: string): boolean => {
    const split = (text: string, by: string) => {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        else if (depth === 0 && text.startsWith(by, i)) {
          parts.push(text.slice(start, i));
          start = i + by.length;
        }
      }
      parts.push(text.slice(start));
      return parts.map((part) => part.trim());
    };
    // Drops brackets around the whole text, not around its first part only.
    const bare = (text: string): string => {
      if (!text.startsWith("(")) return text;
      let depth = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        if (depth === 0)
          return i === text.length - 1 ? bare(text.slice(1, -1).trim()) : text;
      }
      return text;
    };
    return (
      condition !== "" &&
      split(bare(condition), "||").every((choice) =>
        split(bare(choice), "&&").some((part) =>
          /^github\.event_name (== '(push|workflow_dispatch|schedule)'|!= 'pull_request')$|^inputs\.[\w-]+ == '[^']+'$/.test(
            bare(part),
          ),
        ),
      )
    );
  };

  await check(
    "a pull request's run gets no key: every secret is held back from it",
    () => {
      // A pull request runs its branch's own code, so a secret given to it
      // could be sent anywhere. Each secret is left out for pull requests on
      // its line, or sits in a job a pull request never runs.
      assert.ok(skipsPulls("github.event_name != 'pull_request'"));
      assert.ok(
        skipsPulls("github.event_name == 'push' || inputs.mode == 'apply'"),
      );
      assert.ok(
        skipsPulls(
          "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && (inputs.action == 'status' || inputs.action == 'domains'))",
        ),
      );
      assert.ok(!skipsPulls(""));
      assert.ok(
        !skipsPulls("github.event_name == 'push' || inputs.mode != 'apply'"),
      );
      assert.ok(
        !skipsPulls("(github.event_name == 'push') || (inputs.action != 'x')"),
      );
      assert.ok(!skipsPulls("always() || github.event_name == 'push'"));
      for (const name of readdirSync(".github/workflows")) {
        const text = readFileSync(`.github/workflows/${name}`, "utf8");
        const on = text.slice(0, text.indexOf("\njobs:"));
        if (!/^  pull_request(_target)?:/m.test(on)) continue;
        const jobs = text
          .slice(text.indexOf("\njobs:"))
          .split(/\n(?=  [\w-]+:\n)/);
        for (const job of jobs.slice(1)) {
          const head = job.split("\n")[0].trim();
          const notForPulls = skipsPulls(jobIf(job));
          for (const line of job.split("\n"))
            if (/secrets\./.test(line) && !notForPulls)
              assert.match(
                line,
                /github\.event_name != 'pull_request' && secrets\.|inputs\.environment != '' && secrets\./,
                `${name} ${head} ${line.trim()}`,
              );
        }
      }
    },
  );

  await check(
    "only the watch on main may write issues, and the steps keep what it grants",
    () => {
      const read = (name: string) =>
        readFileSync(`.github/workflows/${name}`, "utf8");
      // A job's block: its line and the lines indented under it.
      const job = (text: string, name: string) => {
        const lines = text.split("\n");
        const start = lines.indexOf(`  ${name}:`);
        assert.ok(start >= 0, `no job ${name}`);
        const end = lines.findIndex(
          (line, i) => i > start && /^ {0,2}\S/.test(line),
        );
        return lines.slice(start, end < 0 ? undefined : end).join("\n");
      };
      // A reusable workflow's own permissions would cut the caller's down.
      assert.doesNotMatch(read("watch-run.yml"), /^\s*permissions:/m);
      const watch = read("watch.yml");
      const main = job(watch, "watch");
      assert.match(main, /if: github\.event_name != 'pull_request'/);
      assert.match(
        main,
        /permissions:\n {6}contents: read\n {6}issues: write\n/,
      );
      assert.match(main, /environment: watch/);
      const tried = job(watch, "try");
      assert.match(tried, /if: github\.event_name == 'pull_request'/);
      assert.match(tried, /permissions:\n {6}contents: read\n {4}uses:/);
      assert.match(tried, /environment: ""/);
      assert.doesNotMatch(tried, /secrets:/);
      // The workflow's own default for anything else is read only.
      assert.match(watch, /^permissions:\n {2}contents: read\n/m);
    },
  );

  await check(
    "the Vercel steps pass each key only where it is needed, and production waits for approval",
    () => {
      const text = readFileSync(".github/workflows/vercel.yml", "utf8");
      const job = (name: string) => {
        const lines = text.split("\n");
        const start = lines.indexOf(`  ${name}:`);
        assert.ok(start >= 0, `no job ${name}`);
        const end = lines.findIndex(
          (line, i) => i > start && /^ {0,2}\S/.test(line),
        );
        return lines.slice(start, end < 0 ? undefined : end).join("\n");
      };
      const jobs = [
        ...text.split(/^jobs:$/m)[1].matchAll(/^ {2}([a-z-]+):$/gm),
      ].map((m) => m[1]);
      assert.deepEqual(jobs, ["try", "site", "production"]);
      // A pull request runs the branch's own script, so it gets no key.
      const tried = job("try");
      assert.match(tried, /if: github\.event_name == 'pull_request'/);
      assert.doesNotMatch(tried, /secrets\.|environment:/);
      // Every key comes from an environment that only main may use.
      const site = job("site");
      assert.match(site, /environment: vercel\n/);
      assert.deepEqual(
        [...site.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]),
        ["VERCEL_SITE_TOKEN"],
      );
      const production = job("production");
      assert.match(production, /environment: production-vercel\n/);
      assert.deepEqual(
        [...production.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]),
        ["VERCEL_PRODUCTION_TOKEN", "RESEND_ADMIN_KEY"],
      );
      assert.match(
        production,
        /RESEND_ADMIN_KEY: \$\{\{ startsWith\(inputs\.action, 'mail'\) && secrets\.RESEND_ADMIN_KEY \|\| '' \}\}/,
      );
      assert.doesNotMatch(text, /secrets\.(VERCEL_TOKEN|RESEND_API_KEY)\b/);
      // What changes production by hand runs only in the approved job, and
      // deploy only when it is main (けにーさん 10-21).
      const ifOf = (block: string) =>
        block.split(/\n {4}runs-on:/)[0].replace(/\s+/g, " ");
      for (const action of [
        "rollback",
        "promote-latest",
        "domains-apply",
        "mail",
        "mail-apply",
      ]) {
        assert.ok(ifOf(production).includes(`'${action}'`), action);
        assert.ok(!ifOf(site).includes(`'${action}'`), action);
      }
      assert.ok(
        ifOf(site).includes(
          "(inputs.action == 'deploy' && inputs.branch != 'main')",
        ),
      );
      assert.ok(
        ifOf(production).includes(
          "(inputs.action == 'deploy' && inputs.branch == 'main')",
        ),
      );
      assert.ok(ifOf(site).includes("github.event_name == 'push'"));
      assert.match(text, /^permissions:\n {2}contents: read\n/m);
    },
  );

  console.log(passed + " hosted settings checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
