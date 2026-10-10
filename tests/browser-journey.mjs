/**
 * Run while the preview server is listening:
 * node tests/browser-journey.mjs
 * Each viewport uses a fresh browser context; no personal browser data is touched.
 */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.QA_OUTPUT || '../../work/qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];

async function runJourney(label, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = { viewport: label, checks: [], errors };
  const check = message => { result.checks.push(message); console.log(`[${label}] ${message}`); };
  const main = page.locator('.main-content');
  const nav = page.getByRole('navigation', { name: label === 'mobile' ? 'スマートフォンナビゲーション' : 'メインナビゲーション' });
  const go = async name => { await nav.getByRole('button', { name, exact: name !== '投稿する' }).click(); };
  const shot = async name => {
    await page.screenshot({ path: resolve(output, `${label}-${name}.png`), fullPage: name !== 'home' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };
  try {
    await page.goto(baseURL);
    await expect(main.getByRole('heading', { name: 'ホーム', exact: true })).toBeVisible();
    await shot('home');
    if (label === 'mobile') {
      const discovery = main.locator('.mobile-reader-discovery');
      await expect(discovery.getByRole('heading', { name: '本棚の向こうにいる人', exact: true })).toBeVisible();
      await expect(discovery).toContainText('好きの近さも、違うまなざしも。');
      const reader = discovery.locator('.mobile-reader-card').nth(1);
      await expect(reader).toContainText('まだ知らない国の物語へ');
      await reader.getByRole('button', { name: 'フォローする', exact: true }).click();
      await expect(reader.getByRole('button', { name: 'フォロー中', exact: true })).toBeVisible();
      await reader.locator('.reader-link').click();
      await expect(main.getByRole('heading', { name: '灯', exact: true })).toBeVisible();
      await main.getByRole('button', { name: 'フォロー中', exact: true }).click();
      await go('ホーム');
      check('Mobile home reader recommendations expose diverse reasons, working follow and profile navigation');
    }
    await main.locator('.post-card').first().locator('.post-book').click();
    await expect(main.getByRole('heading', { name: '西の魔女が死んだ', exact: true })).toBeVisible();
    await main.locator('.book-readers').getByRole('button', { name: /^栞/ }).click();
    await expect(main.getByRole('heading', { name: '栞', exact: true })).toBeVisible();
    await expect(main.locator('.p-nine-slot')).toHaveCount(9);
    await expect(main.getByRole('heading', { name: '雨の日にひらく本', exact: true })).toBeVisible();
    await shot('profile');
    await main.getByRole('button', { name: 'フォロー中', exact: true }).click();
    await expect(main.getByRole('button', { name: 'フォローする', exact: true })).toBeVisible();
    await main.getByRole('button', { name: 'フォローする', exact: true }).click();
    await main.locator('.p-nine-grid').getByRole('button', { name: '西の魔女が死んだの詳細', exact: true }).click();
    const firstPost = main.locator('.post-card').first();
    await firstPost.getByRole('button', { name: 'いいね', exact: true }).click();
    await expect(firstPost.getByRole('button', { name: 'いいね', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await firstPost.getByRole('button', { name: '読みたくなった', exact: false }).click();
    await firstPost.getByRole('button', { name: 'コメント', exact: true }).click();
    await firstPost.getByLabel('返信を書く').fill(`私も朝のお茶の場面を思い出しました。${label}`);
    await firstPost.getByRole('button', { name: '返信する', exact: false }).click();
    await expect(firstPost.getByText(`私も朝のお茶の場面を思い出しました。${label}`, { exact: true })).toBeVisible();
    await main.locator('.status-buttons').getByRole('button', { name: '読書中', exact: true }).click();
    await page.reload();
    await expect(main.locator('.status-buttons').getByRole('button', { name: '読書中', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(firstPost.getByRole('button', { name: 'いいね', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await firstPost.getByRole('button', { name: 'コメント', exact: true }).click();
    await expect(firstPost.getByText(`私も朝のお茶の場面を思い出しました。${label}`, { exact: true })).toBeVisible();
    check('Home → book → reader → nine/bookshelf → book → reaction and reply; persisted after reload');

    await go('マイライブラリ');
    await expect(main.getByRole('heading', { name: 'わたしの本棚', exact: true })).toBeVisible();
    await shot('library');
    await main.getByRole('img', { name: /本棚のジャンル構成/ }).scrollIntoViewIfNeeded();
    await expect(main.getByRole('img', { name: /本棚のジャンル構成/ })).toBeVisible();
    await main.getByRole('button', { name: '本を登録', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '新しい本を登録', exact: true }).click();
    const customTitle = `読書の余白 ${label}`;
    await dialog.getByLabel('タイトル', { exact: true }).fill(customTitle);
    await dialog.getByLabel('著者', { exact: true }).fill('試作 花子');
    await dialog.getByLabel('ジャンル', { exact: true }).fill('文芸評論');
    await dialog.getByLabel('ISBN（任意）', { exact: true }).fill('978-4-123456-78-9');
    await dialog.getByLabel('本とのいまの関係').selectOption('unread');
    await dialog.getByLabel('所有している', { exact: true }).check();
    await dialog.getByRole('button', { name: '本棚に追加する', exact: true }).click();
    await expect(main.getByRole('button', { name: customTitle, exact: true })).toBeVisible();
    await main.locator('.p-filter-row').getByRole('button', { name: '積読', exact: true }).click();
    await main.getByLabel('ジャンルで絞り込む').selectOption('文芸評論');
    await expect(main.locator('.p-library-book')).toHaveCount(1);
    await expect(main.getByRole('button', { name: customTitle, exact: true })).toBeVisible();
    await main.getByLabel('ライブラリをタイトル・著者・ISBNで検索').fill('978-4-123456-78-9');
    await expect(main.locator('.p-library-book')).toHaveCount(1);
    await page.reload();
    await expect(main.getByRole('button', { name: customTitle, exact: true })).toBeVisible();
    check('Custom book with title/author/ISBN; automatic genre grouping, ownership/status filters, donut and persistence');

    await go('プロフィール');
    await main.getByRole('button', { name: '編集', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '人生の9冊を、あなたらしく' });
    await dialog.getByRole('button', { name: '西の魔女が死んだを前に', exact: true }).click();
    await expect(dialog.locator('.p-nine-editor-row').first()).toContainText('西の魔女が死んだ');
    await dialog.locator('.p-nine-editor-row').first().getByPlaceholder('この本へのひとこと（任意）').fill('日々の小さな選択を思い出す一冊。');
    await dialog.getByLabel('人生の9冊に追加する本を検索').fill(customTitle);
    await dialog.locator('.p-picker-book').click();
    await dialog.getByRole('button', { name: 'この本たちを並べる', exact: true }).click();
    await expect(main.locator('.p-nine-slot').first()).toContainText('西の魔女が死んだ');
    await expect(main.locator('.p-nine-slot').first()).toContainText('日々の小さな選択を思い出す一冊。');
    await expect(main.locator('.p-nine-grid')).toContainText(customTitle);
    await page.reload();
    await expect(main.locator('.p-nine-slot').first()).toContainText('日々の小さな選択を思い出す一冊。');
    await main.getByRole('button', { name: '本棚をつくる', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'あなたの本棚をつくる' });
    await dialog.getByLabel('本棚の名前').fill(`秘密の本棚 ${label}`);
    await dialog.getByRole('button', { name: /^自分だけ/ }).click();
    await dialog.getByLabel('本棚に並べる本を検索').fill(customTitle);
    await dialog.locator('.p-picker-book').click();
    await dialog.getByRole('button', { name: '保存する', exact: true }).click();
    await expect(main.locator('.p-shelf-section').filter({ hasText: `秘密の本棚 ${label}` })).toContainText('自分だけ');
    await page.reload();
    await expect(main.getByRole('heading', { name: `秘密の本棚 ${label}`, exact: true })).toBeVisible();
    check('Life nine reordered, additional book and optional note saved; custom private shelf persists for owner');

    // A private demo shelf is a visitor fixture: it must be absent from a different reader profile.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('yohaku-reading-sns'));
      saved.state.users[0].shelves.push({ id: 'qa-private-shelf', name: '訪問者に見せない棚', isPublic: false, bookIds: ['b1'] });
      localStorage.setItem('yohaku-reading-sns', JSON.stringify(saved));
    });
    await page.reload();
    await go('ホーム');
    await main.locator('.post-card').first().getByRole('button', { name: '栞のプロフィール', exact: true }).click();
    await expect(main.getByRole('heading', { name: '雨の日にひらく本', exact: true })).toBeVisible();
    await expect(main.getByText('訪問者に見せない棚', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'フォロー中', exact: true })).toBeVisible();
    check('Visitor profile exposes public shelves and excludes private shelves; follow state persisted');

    await go('探す');
    const search = main.getByLabel('本・著者・ISBN・読書家の検索');
    await search.fill('銀河鉄道の夜');
    await main.locator('.explore-book').getByRole('button', { name: '銀河鉄道の夜', exact: true }).click();
    const spoiler = main.locator('.post-card');
    const protectedText = '最後の場面を読み返しました。カムパネルラの不在を知ったとき';
    await expect(spoiler.getByText(protectedText, { exact: false })).toHaveCount(0);
    await spoiler.getByRole('button', { name: 'コメント', exact: true }).click();
    await expect(spoiler.locator('.comment')).toHaveCount(0);
    await expect(spoiler.getByLabel('返信を書く')).toHaveCount(0);
    await expect(spoiler.locator('.avatar-link')).toHaveCount(0);
    await expect(spoiler.locator('.post-author button')).toHaveCount(0);
    await spoiler.getByRole('button', { name: '感想を読む', exact: true }).click();
    await expect(spoiler.getByText(protectedText, { exact: false })).toBeVisible();
    await expect(spoiler.locator('.comment')).toHaveCount(1);
    await spoiler.getByRole('button', { name: 'ネタバレを閉じる', exact: true }).click();
    await expect(spoiler.getByText(protectedText, { exact: false })).toHaveCount(0);
    await expect(spoiler.locator('.comment')).toHaveCount(0);
    check('Spoiler post and replies require explicit reveal; hide closes both; anonymous post has no profile links');

    await main.getByRole('button', { name: '感想・呼びかけを書く', exact: false }).click();
    dialog = page.getByRole('dialog', { name: 'いまの気持ちを、綴る。' });
    await dialog.getByLabel('投稿内容').fill(`面白かった！！ 話を聞く人に会いたい。${label}`);
    await dialog.getByLabel('匿名モード', { exact: true }).check();
    await dialog.getByRole('button', { name: '投稿する', exact: false }).click();
    const ownAnonymous = main.locator('.post-card').first();
    await expect(ownAnonymous.locator('.post-text')).toHaveText(`面白かった！！ 話を聞く人に会いたい。${label}`);
    const alias = await ownAnonymous.locator('.post-author b').textContent();
    expect(alias).toMatch(/^匿名の読者・/);
    await expect(ownAnonymous.locator('.post-author button')).toHaveCount(0);
    await ownAnonymous.getByRole('button', { name: 'コメント', exact: true }).click();
    await expect(ownAnonymous.getByLabel('匿名で返信', { exact: true })).toBeChecked();
    await ownAnonymous.getByLabel('返信を書く').fill(`私もこの場面を話したい。${label}`);
    await ownAnonymous.getByRole('button', { name: '返信する', exact: false }).click();
    await ownAnonymous.getByLabel('返信を書く').fill(`二つ目の匿名返信。${label}`);
    await ownAnonymous.getByRole('button', { name: '返信する', exact: false }).click();
    await expect(ownAnonymous.locator('.comment b')).toHaveText([alias, alias]);
    await expect(ownAnonymous.locator('.comment .avatar-link')).toHaveCount(0);
    await page.reload();
    await expect(ownAnonymous.locator('.post-author b')).toHaveText(alias);
    await ownAnonymous.getByRole('button', { name: 'コメント', exact: true }).click();
    await expect(ownAnonymous.locator('.comment b')).toHaveText([alias, alias]);
    await go('プロフィール');
    await main.getByRole('tab', { name: '感想・ことば', exact: true }).click();
    await expect(main.getByText(`面白かった！！ 話を聞く人に会いたい。${label}`, { exact: true })).toHaveCount(0);
    check('Anonymous post and multiple replies preserve thread alias after reload; omitted from profile history');

    await go('投稿する');
    dialog = page.getByRole('dialog', { name: 'いまの気持ちを、綴る。' });
    await dialog.getByLabel('投稿内容').fill(`本を添えなくても自由に話せる。${label}`);
    await dialog.getByRole('button', { name: '投稿する', exact: false }).click();
    await expect(main.locator('.post-card').first().locator('.post-text')).toHaveText(`本を添えなくても自由に話せる。${label}`);
    await expect(main.locator('.post-card').first().locator('.post-book')).toHaveCount(0);
    await go('プロフィール');
    await main.getByRole('tab', { name: '感想・ことば', exact: true }).click();
    await expect(main.getByText(`本を添えなくても自由に話せる。${label}`, { exact: true })).toBeVisible();
    await go('探す');
    await search.fill('凪');
    await main.getByRole('tab', { name: '読書家', exact: true }).click();
    await expect(main.locator('.reader-card')).toHaveCount(1);
    await expect(main.locator('.reader-card')).toContainText('凪');
    check('Free public post requires no book or rating; public history and reader search work');
    expect(errors).toEqual([]);
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.failure = error.stack || String(error);
    await page.screenshot({ path: resolve(output, `${label}-failure.png`), fullPage: true }).catch(() => {});
    result.location = page.url();
    result.dom = await main.innerText().catch(() => '');
  } finally {
    results.push(result);
    await context.close();
  }
}

try {
  await runJourney('mobile', { width: 390, height: 844 });
  await runJourney('desktop', { width: 1440, height: 1000 });
} finally {
  await browser.close();
  await writeFile(resolve(output, 'browser-journey-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
if (results.some(result => !result.passed)) process.exitCode = 1;
