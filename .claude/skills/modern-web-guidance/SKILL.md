---
name: modern-web-guidance
description: Google Chrome チームのウェブの作り方の手引き（v1.0.0 の写し）。画面の HTML・CSS・ブラウザで動く JS（小窓、シート、ふきだし、動き、ドラッグ、フォーム、読みやすさ、表示の速さ、安全）を作る・直すときに、ネットにつながず手元で引く。DB・CI・サーバーの仕事では使わない。
---

# Modern Web Guidance（手元の写し）

Google Chrome チームの手引き集 [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) の手引きを、決まった版で写した物です。出どころと版は `SOURCE.md` にあります。

この `SKILL.md` は BookTown が書いた物で、元の `SKILL.md` は入れていません。元の物は「使うたびに `npx modern-web-guidance@latest` をネットから落として動かす」作りで、中身が知らないうちに変わるためです（けにーさん 2026-11-11 了承）。

## BookTown の決まりが先

- この手引きは、ブラウザの仕組みの一般の注意として読みます。`CLAUDE.md`、`docs/開発と運用/作るときの規格.md`、`docs/色と部品の決まり.md`、`docs/理念.md` と食い違えば、BookTown の側が勝ちます。
- 色・字・角・動きの長さ・言葉は、手引きの例の値を写さず、`src/app/tokens.css` と `src/app/parts.css`、`src/lib/words.ts`、`src/lib/motion.ts` の物を使います。
- 手引きが勧める物でも、余計な演出や、頼まれていない機能は足しません。新しい依存（polyfill など）は、開発の手順の「依存を足すとき」のとおり、けにーさんに提案してから足します。
- 手引きの例は素の HTML・CSS・JS です。Next.js のコードに直すときは `AGENTS.md` のとおり `node_modules/next/dist/docs/` を先に読みます。

## 引き方

1. `INDEX.md` で、作る物に近い手引きを探します（ID と見出しの一覧）。言葉で探すときは、このフォルダの `guides/` を `Grep` で探します。
2. 見つけた手引き（`guides/<分野>/<ID>.md`）を `Read` で最後まで読みます。分野の総論（`css`、`html`、`forms`、`accessibility`、`performance`、`security` など）も、関わるなら読みます。
3. 手引きの中に `npx -y modern-web-guidance@latest retrieve "<ID>"` と書いてある所は、「`guides/` の `<ID>.md` を読め」という意味です。**`npx` は動かしません**（`search`・`retrieve`・`legacy-scan` のどれも）。
4. 作ったあと、手引きのとおりになっているか（とくに代わりの道 = 古いブラウザへの備え）を見直します。

## ブラウザの対応の考え方

- 手引きは「Baseline Widely available」（主なブラウザで2年半以上動いている物）を、備えなしで使ってよいとしています。それより新しい物は、手引きの備え（fallback）に従います。
- BookTown はスマホのブラウザ、とくに iPhone の Safari で使われます。新しい仕組みを使うときは、手引きの対応表で Safari の対応を確かめ、動かない端末でも読書家が困らない（書きかけを失わない、押せない所ができない）ようにします。
- 「動くはず」で終えず、手元の通しの確認と 320px・390px の画像で確かめます（開発の手順）。

## 入れていない物

元の手引き集にある Chrome 拡張機能の手引き（`chrome-extensions`）と、ネットから引く道具は入れていません。新しい版にするときは、`guides/` を丸ごと入れ替え、`INDEX.md` を作り直し、`SOURCE.md` の版を直します。写した手引きは書き換えません。
