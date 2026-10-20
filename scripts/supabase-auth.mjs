// Brings the hosted Supabase project's sign-in settings in line with
// supabase/hosted-auth.json: the site's address and the addresses a login link
// may return to, how long the login code lasts, how many sign-ins, code
// checks and session refreshes one address may make in five minutes and, once
// a Resend key is stored, who sends the login email, how many it may send an hour, and the
// email itself (supabase/templates/magic_link.html, the same file the local
// Supabase uses). Changing the address asks for a code from the current
// address and one from the new one (supabase/templates/email_change.html).
// A reader may also sign in with a passkey made on booktown.page.
// .github/workflows/supabase-auth.yml runs it.
//
//   node scripts/supabase-auth.mjs check   prints what would change
//   node scripts/supabase-auth.mjs apply   changes it, then reads it back
//
// The repository is public, and so are its Actions logs: only the settings in
// SHOWN are ever printed, and never the SMTP password.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests point this at a stand-in.
const API = process.env.SUPABASE_API_URL ?? "https://api.supabase.com/v1";
// How long to wait before reading the settings again after a change.
const readAgainMs = Number(process.env.SETTINGS_READ_AGAIN_MS ?? 3000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Settings whose values may appear in the public log. */
const SHOWN = new Set([
  "mailer_otp_length",
  "mailer_otp_exp",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_admin_email",
  "smtp_sender_name",
  "smtp_max_frequency",
  "rate_limit_email_sent",
  "rate_limit_otp",
  "rate_limit_verify",
  "rate_limit_token_refresh",
  "external_anonymous_users_enabled",
  "security_captcha_enabled",
  "security_captcha_provider",
  "mailer_subjects_magic_link",
  "mailer_templates_magic_link_content",
  "mailer_secure_email_change_enabled",
  "mailer_autoconfirm",
  "mailer_subjects_email_change",
  "mailer_templates_email_change_content",
  "passkey_enabled",
  "webauthn_rp_id",
  "webauthn_rp_display_name",
  "webauthn_rp_origins",
  "site_url",
  "uri_allow_list",
  "disable_signup",
  "external_email_enabled",
]);

/** Shown for reference; this script leaves them as they are. */
const UNMANAGED = [
  "disable_signup",
  "external_email_enabled",
  "smtp_max_frequency",
  "external_anonymous_users_enabled",
];

/**
 * The addresses a login link may return to: every one already allowed, then
 * the ones the settings ask for. Nothing is taken away, so a branch address
 * added in the dashboard keeps working.
 */
export function allowList(current, wanted) {
  const list = String(current ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  for (const url of wanted ?? []) if (!list.includes(url)) list.push(url);
  return list.join(",");
}

/**
 * The auth settings this repository asks for. Without a Resend key the
 * built-in email stays, and Supabase allows neither a new email nor a higher
 * limit with it.
 *
 * @returns {Record<string, string | number>}
 */
export function desiredAuth(
  settings,
  { template, emailChangeTemplate, resendKey, captchaSecret = "" },
) {
  // Turned on only with its secret, or every login would be refused.
  if (settings.captcha.on && !captchaSecret)
    throw new Error(
      "captcha.on needs TURNSTILE_SECRET_KEY, Cloudflare Turnstile's secret key, among the repository secrets.",
    );
  const wanted = {
    site_url: settings.site.url,
    mailer_otp_length: settings.code.length,
    mailer_otp_exp: settings.code.expiresInSeconds,
    rate_limit_otp: settings.limits.codeRequestsPer5Minutes,
    rate_limit_verify: settings.limits.codeChecksPer5Minutes,
    rate_limit_token_refresh: settings.limits.sessionRefreshesPer5Minutes,
    // Both addresses confirm a change. The server skips the second one while
    // email confirmations are off (mailer_autoconfirm), so that stays off;
    // sign-ups are closed, and invited readers are created confirmed.
    mailer_secure_email_change_enabled: settings.emailChange.confirmBoth,
    mailer_autoconfirm: !settings.emailChange.confirmBoth,
    // A passkey belongs to its relying party for good: changing it later
    // leaves every passkey made so far unusable.
    passkey_enabled: settings.passkey.enabled,
    webauthn_rp_id: settings.passkey.relyingParty,
    webauthn_rp_display_name: settings.passkey.name,
    webauthn_rp_origins: settings.passkey.origins.join(","),
    // 人間の確認 (src/lib/turnstile.ts): the login email and the passkey
    // login then need Turnstile's answer. On only once the site sends it.
    security_captcha_enabled: settings.captcha.on,
    ...(settings.captcha.on
      ? { security_captcha_provider: settings.captcha.provider }
      : {}),
  };
  if (!resendKey) return wanted;
  return {
    ...wanted,
    smtp_host: settings.email.smtpHost,
    smtp_port: String(settings.email.smtpPort),
    smtp_user: settings.email.smtpUser,
    smtp_admin_email: settings.email.sender,
    smtp_sender_name: settings.email.senderName,
    rate_limit_email_sent: settings.email.perHour,
    mailer_subjects_magic_link: settings.magicLink.subject,
    mailer_templates_magic_link_content: template,
    mailer_subjects_email_change: settings.emailChange.subject,
    mailer_templates_email_change_content: emailChangeTemplate,
  };
}

// The API returns some numbers as strings and the other way round.
const same = (a, b) =>
  a === b || (a != null && b != null && String(a) === String(b));

/** The settings that differ between the project and what is wanted. */
export function authChanges(current, wanted, resendKey, captchaSecret = "") {
  const changed = Object.keys(wanted).filter(
    (key) => !same(current[key], wanted[key]),
  );
  // The password may come back hidden. Send it unless it is known to match,
  // so that a replaced key reaches the project too.
  if (resendKey && current.smtp_pass !== resendKey) changed.push("smtp_pass");
  if (captchaSecret && current.security_captcha_secret !== captchaSecret)
    changed.push("security_captcha_secret");
  return changed;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** A setting's value as the public log may show it. */
export function shown(key, value) {
  if (!SHOWN.has(key)) return "(hidden)";
  if (value == null || value === "") return "(not set)";
  if (
    key === "mailer_templates_magic_link_content" ||
    key === "mailer_templates_email_change_content"
  )
    return `${value.length} characters, sha256 ${sha256(value).slice(0, 12)}`;
  return JSON.stringify(value);
}

/** Takes anything that looks like a key out of text the API sent back. */
export function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("***");
  return out.replace(/\b(re|sbp|vcp)_[A-Za-z0-9_-]{8,}/g, "***");
}

class ApiError extends Error {
  constructor(status, text) {
    super(`Supabase answered ${status}: ${text}`);
    this.status = status;
  }
}

async function main(mode) {
  if (mode !== "check" && mode !== "apply") {
    console.error("Usage: node scripts/supabase-auth.mjs check|apply");
    process.exit(2);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const project = process.env.SUPABASE_PROJECT_ID;
  const resendKey = process.env.RESEND_API_KEY || "";
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!token || !project) {
    console.log(
      "::warning::SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_ID is not set, so the settings were not checked.",
    );
    return;
  }
  if (!resendKey)
    console.log(
      "::warning::RESEND_API_KEY is not set: the built-in email stays, with its limit of 2 emails an hour and its own text.",
    );

  const settings = JSON.parse(
    await readFile(path.join(root, "supabase/hosted-auth.json"), "utf8"),
  );
  const template = await readFile(
    path.join(root, "supabase", settings.magicLink.template),
    "utf8",
  );
  const emailChangeTemplate = await readFile(
    path.join(root, "supabase", settings.emailChange.template),
    "utf8",
  );
  // Sent only while the check is on; off, Supabase keeps whatever it had.
  const captchaSecret = settings.captcha.on ? turnstileSecret : "";
  const wanted = desiredAuth(settings, {
    template,
    emailChangeTemplate,
    resendKey,
    captchaSecret,
  });

  const request = async (method, body) => {
    const response = await fetch(`${API}/projects/${project}/config/auth`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body && JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok)
      throw new ApiError(
        response.status,
        redact(text, [token, resendKey, turnstileSecret]),
      );
    return JSON.parse(text);
  };

  let current;
  try {
    current = await request("GET");
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      const message =
        "The access token cannot read the auth settings. Looking needs Auth Config read on this project (the environment production-read).";
      // A pull request only looks, so a token that is not replaced yet
      // should not turn it red.
      if (mode === "check") {
        console.log("::warning::" + message);
        return;
      }
      console.log("::error::" + message);
    }
    throw error;
  }

  wanted.uri_allow_list = allowList(
    current.uri_allow_list,
    settings.site.returnTo,
  );
  const changed = authChanges(current, wanted, resendKey, captchaSecret);
  console.log("Sign-in settings on the hosted project:");
  for (const key of Object.keys(wanted))
    console.log(
      changed.includes(key)
        ? `  ${key}: ${shown(key, current[key])} -> ${shown(key, wanted[key])}`
        : `  ${key}: ${shown(key, current[key])} (as wanted)`,
    );
  if (changed.includes("smtp_pass"))
    console.log("  smtp_pass: set from RESEND_API_KEY (not shown)");
  if (changed.includes("security_captcha_secret"))
    console.log(
      "  security_captcha_secret: set from TURNSTILE_SECRET_KEY (not shown)",
    );
  // Whether the secret is among the repository secrets, never its value, so
  // the check can be turned on knowing it is there.
  console.log(
    `TURNSTILE_SECRET_KEY: ${turnstileSecret ? "set" : "not set"} among the repository secrets`,
  );
  console.log("Left as they are:");
  for (const key of UNMANAGED)
    console.log(`  ${key}: ${shown(key, current[key])}`);

  if (!changed.length) {
    console.log("Nothing to change.");
    return;
  }
  if (mode === "check") {
    console.log(
      `${changed.length} setting(s) would change once this is on main.`,
    );
    return;
  }

  const patch = Object.fromEntries(
    changed.map((key) => [
      key,
      key === "smtp_pass"
        ? resendKey
        : key === "security_captcha_secret"
          ? captchaSecret
          : wanted[key],
    ]),
  );
  try {
    await request("PATCH", patch);
  } catch (error) {
    if (error.status === 401 || error.status === 403)
      console.log(
        "::error::The access token cannot change the auth settings. It needs Auth Config Read-write on this project (the environment production-auth), and Project Settings if Supabase names it.",
      );
    throw error;
  }
  // Supabase takes a few seconds to reload some settings (the human check
  // did, 2026-10-18), so a read right after the change can still show the old
  // values: read again a few times before calling it a failure.
  let missed = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt)
      await new Promise((resolve) => setTimeout(resolve, readAgainMs));
    missed = authChanges(await request("GET"), wanted, "");
    if (!missed.length) break;
  }
  if (missed.length)
    throw new Error("These settings did not take: " + missed.join(", "));
  console.log(`Changed ${changed.length} setting(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
