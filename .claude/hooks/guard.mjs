#!/usr/bin/env node
// 承認の守り（AUD-211）。Claude がけにーさんの GitHub アカウントで動く間、
// 本番の承認・承認の設定・ルールセット・main の守り・シークレットに触る呼び出しを、
// 道具を使う前に止める（PreToolUse）。止めたら終了コード 2 で、理由を Claude に返す。
// 決まりの正本は docs/開発と運用/権限と鍵.md「Claude の手元の止め」。作り直しの土台でも同じ物を使う。
//
// 見るのは呼び出しの文字だけ。ファイルに書いたスクリプトを動かす、文字を組み立てて隠す、
// といった回り道は止められない。GitHub の側の止め（身元を分ける）が来るまでの柵。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// 読むだけでも呼ばない物: 承認の送り先、シークレットと変数の中身と一覧。
const ALWAYS = [
  [/pending_deployments/, "本番の承認（Review deployments）は けにーさんだけが押します"],
  [/deployment_protection_rules|deployment-branch-policies|deployment_branch_policies/, "環境の守りの設定は変えません"],
  [/\bgh\s+secret\b/, "シークレットは一覧も値も読まず、変えません"],
  [/\bgh\s+variable\b/, "Actions の変数は読まず、変えません"],
  [/\b(approve|reject)deployments\b/, "本番の承認は けにーさんだけが押します"],
  [/\b(create|update|delete)(branchprotectionrule|repositoryruleset|environment)\b/, "ルールセット・main の守り・環境は変えません"],
  [/\b(updaterepository|deleterepository|archiverepository|transferrepository)\b/, "リポジトリの設定は変えません"],
  [/\bgh\s+repo\s+(edit|delete|rename|archive|unarchive)\b/, "リポジトリの設定は変えません"],
  [/\bgh\s+pr\s+review\b[^\n;&|]*(--approve|-a\b)/, "提案書の承認（Approve）は押しません"],
  [/\bgh\s+pr\s+merge\b[^\n;&|]*--admin\b/, "決まりを飛ばす取り込み（--admin）はしません"],
  [/\bgh\s+auth\s+(refresh|login)\b/, "GitHub の権限を足しません"],
];

// GitHub を呼ぶときは、読むだけでも止める先。
const ALWAYS_GITHUB = [
  [/\/secrets\b/, "シークレットは一覧も値も読まず、変えません"],
  [/\/variables\b/, "Actions の変数は読まず、変えません"],
];

// 読むのはよいが、書く呼び出しは止める先。
const WRITE_GUARDED = [
  [/\/environments\b/, "環境（承認つきの本番の環境）は変えません"],
  [/\/rulesets\b|\/rules\/branches\b/, "ルールセットは変えません"],
  [/\/branches\/[^\s/]+\/protection\b/, "main の守りは変えません"],
  [/\/collaborators\b|\/invitations\b/, "協力者と権限は変えません"],
  [/\/actions\/permissions\b|\/actions\/oidc\b/, "Actions の権限は変えません"],
  [/\/hooks\b|\/keys\b|\/autolinks\b/, "リポジトリの設定は変えません"],
  [/\brepos\/[^/\s"']+\/[^/\s"'?]+(?=["'\s?]|$)/, "リポジトリの設定は変えません"],
];

// 書く印: gh api の -X POST や -f、curl の -d、ほかの言語で GitHub を呼ぶ物。
const WRITE_SIGN =
  /(-X|--method|--request)\s*=?\s*["']?(post|put|patch|delete)\b|\s(-f|-F|--field|--raw-field|--input|-d|--data[\w-]*|--form|-T|--upload-file)(\s|=)|\b(python3?|node|deno|bun|ruby|perl|wget|httpie?|octokit)\b|\bfetch\s*\(/i;

const APPROVE_REVIEW = /\/pulls\/\d+\/reviews\b[^\n]*\bapprove\b/;

// git push で main（か master）を書き換える形。
function pushesMain(command) {
  for (const part of command.split(/&&|\|\||;|\n|\|/)) {
    const words = part.trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ""));
    if (!words.some((w) => /(^|\/)git$/.test(w))) continue;
    const at = words.indexOf("push");
    if (at < 0) continue;
    const rest = words.slice(at + 1);
    if (rest.some((w) => w === "--mirror" || w === "--all")) return true;
    if (rest.some((w) => /^\+?([^:\s]*:)?(refs\/heads\/)?(main|master)$/.test(w))) return true;
  }
  return false;
}

export function judgeBash(command) {
  const text = String(command ?? "");
  const lower = text.toLowerCase();
  for (const [pattern, why] of ALWAYS) if (pattern.test(lower)) return why;
  if (APPROVE_REVIEW.test(lower)) return "提案書の承認（Approve）は押しません";
  const touchesGitHub = /\bgh\s+api\b|api\.github\.com|\brepos\//.test(lower);
  if (touchesGitHub) {
    for (const [pattern, why] of ALWAYS_GITHUB) if (pattern.test(lower)) return why;
    for (const [pattern, why] of WRITE_GUARDED) {
      if (pattern.test(lower) && WRITE_SIGN.test(text)) return why;
    }
    if (/graphql/.test(lower) && /\bmutation\b/.test(lower) && /(protection|ruleset|environment|deployment|collaborator)/.test(lower)) {
      return "GitHub の守りの設定を変える呼び出しはしません";
    }
  }
  if (pushesMain(text)) return "main へは直に push せず、提案書を通します";
  return null;
}

export function judgeTool(name, input) {
  if (name === "Bash") return judgeBash(input?.command);
  if (!/^mcp__.*github/i.test(name)) return null;
  const tool = name.split("__").slice(2).join("__").toLowerCase();
  const all = JSON.stringify(input ?? {});
  if (/review/.test(tool) && /"event"\s*:\s*"approve"/i.test(all)) return "提案書の承認（Approve）は押しません";
  if (/secret_scanning/.test(tool)) return null;
  if (/secret|variable|environment|ruleset|protection|collaborator|deployment|webhook/.test(tool)) {
    return "承認・環境・ルールセット・シークレット・協力者には、道具から触りません";
  }
  if (/(create_or_update_file|push_files|delete_file)/.test(tool) && /^(refs\/heads\/)?(main|master)$/i.test(String(input?.branch ?? ""))) {
    return "main へは直に書かず、提案書を通します";
  }
  return null;
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // 読めないときは通さない（守りが黙って外れないように）。
    process.stderr.write("承認の守り: 呼び出しを読めなかったので止めました（.claude/hooks/guard.mjs）\n");
    process.exit(2);
  }
  const why = judgeTool(event.tool_name ?? "", event.tool_input ?? {});
  if (why) {
    process.stderr.write(
      `承認の守りで止めました: ${why}。けにーさんの GitHub アカウントで動いているため、` +
        "この種類の操作はけにーさんが画面で行います（docs/開発と運用/権限と鍵.md「Claude の手元の止め」、AUD-211）。" +
        "回り道で同じことをせず、要るなら手順をけにーさんに渡してください。\n",
    );
    process.exit(2);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
