// 承認の守り（AUD-211）の確かめ。.claude/hooks/guard.mjs が、本番の承認・承認の設定・
// ルールセット・main の守り・シークレットに触る呼び出しを止め、ふだんの作業は止めないこと。
// 決まりは docs/開発と運用/権限と鍵.md「Claude の手元の止め」。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { judgeBash, judgeTool } from "../.claude/hooks/guard.mjs";

const R = "repos/mitsuakisudo2-dot/book-town";

const stopped: string[] = [
  // 本番の承認
  `gh api -X POST ${R}/actions/runs/1/pending_deployments -f state=approved -F environment_ids[]=1`,
  `gh api ${R}/actions/runs/1/pending_deployments`,
  `curl -s -H "Authorization: Bearer $T" https://api.github.com/${R}/actions/runs/1/pending_deployments -d '{"state":"approved"}'`,
  `gh api graphql -f query='mutation { approveDeployments(input:{workflowRunId:"x", environmentIds:["y"]}) { clientMutationId } }'`,
  // 環境と、その守り
  `gh api -X PUT ${R}/environments/production-db -f wait_timer=0`,
  `gh api --method DELETE ${R}/environments/production-db`,
  `gh api ${R}/environments/production-db/deployment_protection_rules`,
  `curl -X PATCH https://api.github.com/${R}/environments/production-db/deployment-branch-policies/1`,
  `node -e "fetch('https://api.github.com/${R}/environments/production-auth',{method:'PUT'})"`,
  // ルールセットと main の守り
  `gh api -X PUT ${R}/rulesets/1 --input rules.json`,
  `gh api -X DELETE ${R}/branches/main/protection`,
  `gh api graphql -f query='mutation { updateBranchProtectionRule(input:{}) { clientMutationId } }'`,
  `gh api graphql -f query='mutation { deleteRepositoryRuleset(input:{}) { clientMutationId } }'`,
  // シークレットと変数（読むのも）
  `gh secret list`,
  `gh secret set PRODUCTION_DB_PASSWORD`,
  `gh api ${R}/environments/production-db/secrets`,
  `gh api ${R}/actions/secrets`,
  `gh variable list`,
  // リポジトリの設定と協力者
  `gh repo edit --visibility private`,
  `gh api -X PATCH ${R} -f delete_branch_on_merge=false`,
  `gh api -X PUT ${R}/collaborators/someone -f permission=admin`,
  `gh api -X PUT ${R}/actions/permissions -F enabled=true`,
  // 提案書の承認と、決まりを飛ばす取り込み
  `gh pr review 12 --approve`,
  `gh api -X POST ${R}/pulls/12/reviews -f event=APPROVE`,
  `gh pr merge 12 --admin --merge`,
  `gh auth refresh -s admin:org`,
  // main への直の push
  `git push origin HEAD:main`,
  `git push origin main`,
  `git push -f origin +main`,
  `cd /x && git push origin refs/heads/main`,
  `git -C /x push --mirror`,
  // 見直しで見つけた抜け（11-20）
  `gh -R mitsuakisudo2-dot/book-town secret list`,
  `gh --repo mitsuakisudo2-dot/book-town variable list`,
  `gh -R o/r repo edit --visibility public`,
  `gh --repo=o/r auth refresh -s admin:org`,
  `gh auth token`,
  `gh auth status --show-token`,
  `gh api graphql -f query='mutation { addPullRequestReview(input:{pullRequestId:"x", event:APPROVE}) { clientMutationId } }'`,
  `gh api graphql -f query='mutation { submitPullRequestReview(input:{pullRequestReviewId:"x", event: APPROVE}) { clientMutationId } }'`,
  `gh api -X PUT ${R}/contents/README.md -f branch=main -f message=x -f content=eA==`,
  `gh api -X PATCH ${R}/git/refs/heads/main -F force=true -f sha=abc`,
  `gh api -X DELETE ${R}/git/refs/heads/main`,
  `gh api graphql -f query='mutation { createCommitOnBranch(input:{branch:{branchName:"main"}}) { commit { oid } } }'`,
  `gh api orgs/o/actions/organization-secrets`,
  `gh api ${R}/dependabot/secrets`,
  `curl -sXPUT https://api.github.com/${R}/environments/production-db`,
  `(git push origin main)`,
  `git push origin main&`,
  `git push origin "main"`,
  `gh pr review 12 "--approve"`,
];

const allowed: string[] = [
  `git push -u origin claude/project-thread-9bxai1`,
  `git fetch origin main && git merge --no-edit FETCH_HEAD`,
  `git log --oneline origin/main`,
  `pnpm test:settings`,
  `gh api -X GET search/code -f q='pending in:file repo:x/y'`,
  `gh api ${R}/environments`,
  `gh api ${R}/rulesets`,
  `gh api ${R} --jq .default_branch`,
  `gh api -X POST ${R}/pulls -f title=t -f head=claude/x -f base=main`,
  `gh api -X POST ${R}/pulls/12/reviews -f event=COMMENT -f body=ok`,
  `grep -n "secrets: inherit" .github/workflows/*.yml`,
  `cat src/styles/variables.css`,
  `node .claude/hooks/guard.mjs < x.json`,
  `pnpm build && node scripts/copy-zxing.mjs`,
  `gh pr merge 12 --squash`,
  // 説明の文の中の言葉では止めない（11-20 の見直し）
  `gh pr create --title t --body 'mention gh secret here'`,
  `gh pr review 12 --comment -b 'looks good, -a bit'`,
  `gh api -X POST ${R}/pulls/3/reviews -f event=COMMENT -f body='please approve later'`,
  `git commit -m 'stop push to main' && git push origin claude/x`,
  `git commit -F - <<'EOF'\nnever git push origin main\nEOF\ngit push -u origin claude/x`,
  `gh -R o/r pr list`,
  `gh auth status`,
];

// 引数のない push は、main にいるときだけ止める。
assert.ok(judgeBash("git push", "main"), "bare push on main");
assert.ok(judgeBash("git push origin HEAD", "master"), "push HEAD on master");
assert.equal(judgeBash("git push", "claude/x"), null, "bare push on a working branch");
assert.equal(judgeBash("git push -u origin claude/x", "main"), null, "a named branch is that branch");

for (const command of stopped) {
  assert.ok(judgeBash(command), `stops: ${command}`);
}
for (const command of allowed) {
  assert.equal(judgeBash(command), null, `lets through: ${command}`);
}

// GitHub の道具（MCP）
const tools: [string, Record<string, unknown>, boolean][] = [
  ["mcp__github__pull_request_review_write", { method: "create", event: "APPROVE", pullNumber: 1 }, true],
  ["mcp__github__pull_request_review_write", { method: "submit_pending", event: "approve" }, true],
  ["mcp__github__pull_request_review_write", { method: "create", event: "COMMENT", body: "ok" }, false],
  ["mcp__github__create_or_update_file", { branch: "main", path: "a" }, true],
  ["mcp__github__push_files", { branch: "refs/heads/master" }, true],
  ["mcp__github__delete_file", { branch: "main" }, true],
  ["mcp__github__push_files", { branch: "claude/x" }, false],
  ["mcp__github__update_environment_secret", {}, true],
  ["mcp__github__create_repository_ruleset", {}, true],
  ["mcp__github__update_branch_protection", {}, true],
  ["mcp__github__add_collaborator", {}, true],
  ["mcp__github__run_secret_scanning", {}, false],
  ["mcp__github__merge_pull_request", { pullNumber: 1 }, false],
  ["mcp__github__create_pull_request", { base: "main", head: "claude/x" }, false],
  ["mcp__plugin_github_github__pull_request_review_write", { event: "APPROVE" }, true],
  ["mcp__hearthbot__post_message", { text: "pending_deployments" }, false],
  ["Read", { file_path: "/x/secrets" }, false],
  ["mcp__github__list_repository_collaborators", {}, false],
  ["mcp__github__push_files", { branch: " main " }, true],
  ["Monitor", { command: "gh secret list" }, true],
  ["Monitor", { command: "tail -f log" }, false],
];
for (const [name, input, stops] of tools) {
  assert.equal(Boolean(judgeTool(name, input)), stops, `${name} ${JSON.stringify(input)}`);
}
assert.ok(judgeTool("Bash", { command: "gh secret list" }), "Bash goes through judgeBash");

// 道具の前に本当に動くこと: 止めると終了コード 2 と理由、通すと 0、読めないと 2。
const run = (input: string) =>
  spawnSync(process.execPath, [".claude/hooks/guard.mjs"], { input, encoding: "utf8" });
const stop = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh secret list" } }));
assert.equal(stop.status, 2, "a stopped call exits 2, which Claude Code treats as blocked");
assert.match(stop.stderr, /承認の守りで止めました/);
const pass = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }));
assert.equal(pass.status, 0, "an ordinary call passes");
assert.equal(run("not json").status, 2, "an unreadable call is stopped, not let through");
assert.equal(run("null").status, 2, "a call that is not an object is stopped");

// settings.json が道具の前にこの止めを呼ぶこと。
const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
const pre = (settings.hooks?.PreToolUse ?? []) as { matcher: string; hooks: { command: string }[] }[];
const entry = pre.find((e) => e.hooks.some((h) => h.command.includes(".claude/hooks/guard.mjs")));
assert.ok(entry, "PreToolUse runs .claude/hooks/guard.mjs");
const matcher = new RegExp(`^(?:${entry.matcher})$`);
for (const name of ["Bash", "Monitor", "mcp__github__pull_request_review_write", "mcp__github__merge_pull_request"]) {
  assert.ok(matcher.test(name), `the guard runs before ${name}`);
}

console.log(`claude guard: ${stopped.length} stopped, ${allowed.length} let through, ${tools.length} tool calls`);
