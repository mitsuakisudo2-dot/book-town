# Booktown の作業を引き継ぐ方へ

Booktown（旧仮称「余白」）は「本を通じて、人と出会うSNS」です。一人ひとりが自分の本屋を開き、その本屋が並んで街になります。

- **最新のコードは `main` です。** 新しい作業は `main` から新しいブランチを切って始めてください。
- 2026-10-12、ブランチ `claude/book-town-sns-features-3ij9a9` を `main` にまとめました。書店めぐり Phase 1・2（旧PR #6・#7）、使い勝手の改善（旧PR #3）、POPの切り替え（旧PR #5）はすべてここに含まれています。`feat/woodshop-phase2-20261012` などの古いブランチから続けないでください。
- 保存先は2つあります。ログインしていなければデモの街をブラウザ内（localStorage、`src/lib/repository.ts`）に、ログインしていればその人の街を Supabase に保存します（`src/lib/town-session.ts` が切り替え、`src/lib/supabase/town-backend.ts` が保存）。店内の飾り付けと本屋めぐりの記録は、まだブラウザ内だけです。
- データベースは Supabase です。設計と公開範囲は [docs/09_段階2_ログインと保存.md](docs/09_段階2_ログインと保存.md) にあります。`supabase/migrations/` は `main` に入ると自動で本番に適用されるので、適用済みのファイルは書き換えず、新しいファイルで足してください。新しい表には必ず RLS と権限を書き、`pnpm test:db` の確認を足してください。
- 次の開発は、ログインと保存の土台、本の検索、本屋の公開ページ、読書記録と交流、最初の店主の招待、の順で進める計画です。どこまで実装するかはユーザーの依頼で決めます。
- 本番の Supabase のログイン設定（メールの送信元、文面、上限）と Vercel の操作は、GitHub Actions から行います（`supabase/hosted-auth.json`、`.github/workflows/supabase-auth.yml`、`.github/workflows/vercel.yml`）。鍵は GitHub のリポジトリシークレットにだけあり、Claude の作業環境からは Supabase と Vercel に直接つながりません。詳しくは docs/09 の「本番の設定」にあります。
- 書店めぐりの設計、保存データ、検証方法は [docs/CLAUDE_HANDOFF.md](docs/CLAUDE_HANDOFF.md) にあります。ただし、そこに書かれたブランチとPRの状態は古くなっています。
- リポジトリの `AGENTS.md` と `docs/README.md` の設計資料を尊重し、Next.jsの関連ガイドをローカルの `node_modules/next/dist/docs/` で確認してからコードを変更してください。
- 本棚が主役です。本・棚・POPを独立して操作できる構造を保ち、一般的なカード型の読書アプリに置き換えないでください。
- 新しい店内Sceneと旧本棚は別保存です。移行や同期の変更では、旧データ、非公開設定、配置ごとのPOPと反応を失わないようにしてください。
- PRを自動でマージしないでください。マージはユーザーの了承を得てから行います。

この資料には、サイトの認証情報やユーザーのブラウザ保存データは含めていません。
