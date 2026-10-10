<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product design reference (読書SNS・仮称「余白」)

Before implementing product features or changing UX, read `docs/README.md` and its linked design notes.
- `docs/01_ビジョンと設計原則.md`: shared values and firm design principles.
- `docs/02_三者会議_2026-10-10.md`: user/ChatGPT/Claude design discussion and rationale.
- `docs/03_Codex実装仕様_v0.1.md`: implementation prototype and acceptance criteria.
- `docs/04_未決定事項と次回議題.md`: proposals and unresolved choices.
- `docs/05_SNS基盤_仕様と設計判断.md`: SNS (free posts, reviews, spoilers) spec, mock scope, design decisions and open review questions.
- `docs/reviews/`: per-PR change summaries, verification results and review points.

These docs are **not an instruction to implement everything**. Distinguish agreed principles from experiments and undecided items, and only implement what the user requests. Preserve existing behavior and tests; verify platform docs in `node_modules/next/dist/docs/` before editing Next.js code.
