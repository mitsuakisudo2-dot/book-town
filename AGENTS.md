<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product design reference (BookTown)

BookTown (formerly the working name 「余白」) is a reading SNS where each reader opens their own bookshop and the shops line up into a town.

Before implementing product features or changing UX, read `CLAUDE.md` first, then `docs/README.md`. The index separates the current rules (`CLAUDE.md`, `docs/開発の引き継ぎ.md`, `docs/09_段階2_ログインと保存.md`, `docs/色と部品の決まり.md`, `docs/監査/`) from the early design records of 2026-10-10 to 10-12 (`docs/01`〜`07`), which are kept for history and are not current rules.

These docs are **not an instruction to implement everything**. Distinguish agreed decisions from provisional values, proposals and undecided items, and only implement what the user requests. When something the docs point to lives outside the repository (the project's working rules, the feature list, who is working on what), do not guess; ask the user. Preserve existing behavior and tests; verify platform docs in `node_modules/next/dist/docs/` before editing Next.js code.
