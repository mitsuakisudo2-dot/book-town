import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Signs in with an emailed code and creates the first profile, in a real browser
// against a stand-in for Supabase. Serve the app with
// NEXT_PUBLIC_SUPABASE_URL=https://test-project.supabase.co and any
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY before running this.
const base = process.env.BOOK_TOWN_URL ?? "http://127.0.0.1:5173";
const supabase =
  process.env.BOOK_TOWN_SUPABASE_URL ?? "https://test-project.supabase.co";
const output = path.resolve(
  process.env.BOOK_TOWN_QA_OUTPUT ?? "../../work/login-qa",
);
await mkdir(output, { recursive: true });

const INVITED = "aki@example.jp";
const user = {
  id: "8f6a2c1e-5b7d-4e1a-9c3f-2d4b6a8e0c11",
  aud: "authenticated",
  role: "authenticated",
  email: INVITED,
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-10-12T00:00:00Z",
};
const base64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const session = () => {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: [
      base64url({ alg: "HS256", typ: "JWT" }),
      base64url({ sub: user.id, role: "authenticated", exp: expires_at }),
      "signature",
    ].join("."),
    token_type: "bearer",
    expires_in: 3600,
    expires_at,
    refresh_token: "refresh-token",
    user,
  };
};

let profile = null;
const inserted = [];

// Uses Playwright's own Chromium unless BOOK_TOWN_CHROME names another browser.
const browser = await chromium.launch({
  executablePath: process.env.BOOK_TOWN_CHROME || undefined,
  headless: true,
});
const passed = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
await context.route(supabase + "/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (status, body) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const body = request.postData() ? JSON.parse(request.postData()) : {};
  if (url.pathname === "/auth/v1/otp")
    return body.email === INVITED
      ? json(200, {})
      : json(422, {
          code: 422,
          error_code: "otp_disabled",
          msg: "Signups not allowed for otp",
        });
  if (url.pathname === "/auth/v1/verify")
    return body.token === "123456" && body.email === INVITED
      ? json(200, session())
      : json(403, {
          code: 403,
          error_code: "otp_expired",
          msg: "Token has expired or is invalid",
        });
  if (url.pathname === "/auth/v1/logout")
    return route.fulfill({ status: 204, body: "" });
  if (url.pathname === "/auth/v1/user") return json(200, user);
  if (url.pathname === "/rest/v1/profiles") {
    if (request.method() === "GET") return json(200, profile ? [profile] : []);
    if (request.method() === "POST") {
      inserted.push(body);
      if (body.handle === "taken")
        return json(409, {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        });
      profile = {
        bio: "",
        color: "#768281",
        links: [],
        compose_icon: "pen",
        created_at: "2026-10-12T00:00:00Z",
        updated_at: "2026-10-12T00:00:00Z",
        ...body,
      };
      return json(201, profile);
    }
  }
  return json(404, { message: "not mocked: " + url.pathname });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, run) {
  await run();
  passed.push(name);
  console.log("PASS " + name);
}
const shot = (name) =>
  page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });

try {
  await check("a signed-out visitor finds the sign-in link on a phone", async () => {
    await page.goto(base + "/");
    const link = page.getByRole("link", { name: "ログイン" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(
      page.getByRole("heading", { name: "本の街に入る" }),
    ).toBeVisible();
    await shot("1-email");
  });

  await check("an email without an invitation is told so", async () => {
    await page.getByLabel("メールアドレス").fill("someone@example.jp");
    await page.getByRole("button", { name: "コードを送る" }).click();
    await expect(page.locator("#account-error")).toContainText(
      "まだ招待されていません",
    );
  });

  await check("an invited email gets a code, and a wrong code is refused", async () => {
    await page.getByLabel("メールアドレス").fill(" Aki@Example.jp ");
    await page.getByRole("button", { name: "コードを送る" }).click();
    await expect(
      page.getByRole("heading", { name: "コードを入れてください" }),
    ).toBeVisible();
    await expect(page.getByText(INVITED)).toBeVisible();
    const login = page.getByRole("button", { name: "ログインする" });
    await page.getByLabel("6桁のコード").fill("99999");
    await expect(login).toBeDisabled();
    await page.getByLabel("6桁のコード").fill("999 999");
    await login.click();
    await expect(page.locator("#account-error")).toContainText("期限が切れています");
    await shot("2-code");
  });

  await check("the right code leads to the first profile", async () => {
    await page.getByLabel("6桁のコード").fill("123456");
    await page.getByRole("button", { name: "ログインする" }).click();
    await expect(
      page.getByRole("heading", { name: "ようこそ、本の街へ" }),
    ).toBeVisible();
    await shot("3-welcome");
  });

  await check("the ID, the name and the age are checked before saving", async () => {
    await page.getByLabel("ユーザー名").fill("アキ");
    await page.getByLabel("ユーザーID").fill("booktown");
    await page.getByLabel("13歳以上です").check();
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(page.locator("#account-error")).toContainText("このIDは使えません");
    await page.getByLabel("ユーザーID").fill("taken");
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(page.locator("#account-error")).toContainText(
      "ほかの読書家が使っています",
    );
    await page.getByLabel("ユーザーID").fill("aki_books");
    await page.getByLabel("13歳以上です").uncheck();
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(page.locator("#account-error")).toContainText("13歳以上");
    expect(inserted.map((row) => row.handle)).toEqual(["taken"]);
  });

  await check("the profile is created as the signed-in person", async () => {
    await page.getByLabel("13歳以上です").check();
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(
      page.getByRole("heading", { name: "ログインしています" }),
    ).toBeVisible();
    await expect(page.getByText("アキ（@aki_books）さん")).toBeVisible();
    expect(inserted.at(-1)).toEqual({
      id: user.id,
      handle: "aki_books",
      name: "アキ",
    });
    await shot("4-signed-in");
  });

  await check("the town shows the new name and no sign-in link", async () => {
    await page.getByRole("link", { name: "本の街へ" }).click();
    await expect(page.locator(".town-topbar")).toBeVisible();
    await expect(page.getByRole("link", { name: "ログイン" })).toHaveCount(0);
    const me = await page.evaluate(
      () => JSON.parse(localStorage.getItem("book-town-v1")).data.me,
    );
    expect([me.name, me.handle]).toEqual(["アキ", "aki_books"]);
  });

  await check("the session survives a reload, and signing out ends it", async () => {
    await page.goto(base + "/login/");
    await expect(
      page.getByRole("heading", { name: "ログインしています" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(
      page.getByRole("heading", { name: "本の街に入る" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "本の街に入る" }),
    ).toBeVisible();
  });

  if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  console.log(passed.length + " login journey checks passed");
} finally {
  await browser.close();
}
