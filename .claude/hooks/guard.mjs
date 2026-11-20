#!/usr/bin/env node
// 承認の守り（AUD-211）。Claude がけにーさんの GitHub アカウントで動く間、
// 本番の承認・承認の設定・ルールセット・main の守り・シークレットに触る呼び出しを、
// 道具を使う前に止める（PreToolUse）。止めたら終了コード 2 で、理由を Claude に返す。
// 決まりの正本は docs/開発と運用/権限と鍵.md「Claude の手元の止め」。作り直しの土台でも同じ物を使う。
//
// 見るのは呼び出しの文字だけ。ファイルに書いたスクリプトを動かす、文字を組み立てて隠す、
// といった回り道は止められない。GitHub の側の止め（身元を分ける）が来るまでの柵。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// gh のコマンドの形（-R/--repo を前に置いても同じに見る）。言葉の中ではなく、命令として見る。
const GH_COMMANDS = [
  [/\bgh\s+(secret|variable)\b/, "シークレットと変数は、一覧も値も読まず、変えません"],
  [/\bgh\s+repo\s+(edit|delete|rename|archive|unarchive)\b/, "リポジトリの設定は変えません"],
  [/\bgh\s+pr\s+review\b[^\n;&|]*\s(--approve|-a)(\s|$)/, "提案書の承認（Approve）は押しません"],
  [/\bgh\s+pr\s+merge\b[^\n;&|]*\s--admin\b/, "決まりを飛ばす取り込み（--admin）はしません"],
  [/\bgh\s+auth\s+(refresh|login|token)\b|\bgh\s+auth\s+status\b[^\n;&|]*--show-token/, "GitHub の権限を足したり、鍵を出したりしません"],
];

// 文字のどこにあっても止める物: 承認の送り先と、守りの設定を変える GraphQL の名前。
const ANYWHERE = [
  [/pending_deployments/, "本番の承認（Review deployments）は けにーさんだけが押します"],
  [/deployment_protection_rules|deployment[-_]branch[-_]policies/, "環境の守りの設定は変えません"],
  [/\b(approve|reject)deployments\b/, "本番の承認は けにーさんだけが押します"],
  [/\b(create|update|delete)(branchprotectionrule|repositoryruleset|environment)\b/, "ルールセット・main の守り・環境は変えません"],
  [/\b(updaterepository|deleterepository|archiverepository|transferrepository)\b/, "リポジトリの設定は変えません"],
];

// GitHub を呼ぶときは、読むだけでも止める先。
const GITHUB_ALWAYS = [
  [/secrets\b/, "シークレットは一覧も値も読まず、変えません"],
  [/\/variables\b|-variables\b/, "Actions の変数は読まず、変えません"],
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
  [/\/git\/refs\/heads\/(main|master)\b/, "main へは直に書かず、提案書を通します"],
  [/\/contents\/[^\n]*\bbranch\s*[=:]\s*["']?(main|master)\b/, "main へは直に書かず、提案書を通します"],
];

// 書く印: gh api の -X POST や -f、curl の -d、ほかの言語で GitHub を呼ぶ物。
const WRITE_SIGN =
  /(-[a-z]*x|--method|--request)\s*=?\s*["']?(post|put|patch|delete)\b|\s(-f|--field|--raw-field|--input|-d|--data[\w-]*|--form|-t|--upload-file)(\s|=)|\b(python3?|node|deno|bun|ruby|perl|wget|httpie?|octokit)\b|\bfetch\s*\(/i;

// 空白を含む引用とヒアドキュメントの本文を外した文字（説明の文の言葉で止めないため）。
// "main" のような一語の引用は、引用を外して残す。
function bare(text) {
  return text
    .replace(/<<-?\s*["']?(\w+)["']?[^\n]*\n[\s\S]*?\n\s*\1\s*(\n|$)/g, " ")
    .replace(/'([^']*)'/g, (_, inner) => (/\s/.test(inner) ? "''" : inner))
    .replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) => (/\s/.test(inner) ? '""' : inner));
}

// git push で main（か master）を書き換える形。main にいるときの引数のない push も。
function pushesMain(command, branch) {
  for (const part of command.split(/&&|\|\||;|\n|\||&|\(|\)|`|\$\(/)) {
    const words = part.trim().split(/\s+/);
    let at = words.findIndex((w) => /(^|\/)git$/.test(w));
    if (at < 0) continue;
    at += 1;
    while (words[at] && /^-/.test(words[at])) at += /^-(C|c)$|^--git-dir$|^--work-tree$/.test(words[at]) ? 2 : 1;
    if (words[at] !== "push") continue;
    const rest = words.slice(at + 1);
    if (rest.some((w) => w === "--mirror" || w === "--all")) return true;
    if (rest.some((w) => /^\+?([^:\s]*:)?(refs\/heads\/)?(main|master)$/.test(w))) return true;
    const refs = rest.filter((w) => !w.startsWith("-"));
    const onlyRemote = refs.length <= 1 || (refs.length === 2 && /^(head|@)$/i.test(refs[1]));
    if (onlyRemote && /^(main|master)$/.test(branch ?? "")) return true;
  }
  return false;
}

export function judgeBash(command, branch) {
  const text = String(command ?? "");
  const lower = text.toLowerCase();
  const plain = bare(lower).replace(/\bgh((\s+(-r|--repo)(\s+|=)\S+)+)(?=\s)/g, "gh");
  for (const [pattern, why] of GH_COMMANDS) if (pattern.test(plain)) return why;
  for (const [pattern, why] of ANYWHERE) if (pattern.test(lower)) return why;
  if (/\/pulls\/\d+\/reviews\b/.test(lower) && /\bevent\s*[=:]\s*\\?["']?approve\b/.test(lower)) {
    return "提案書の承認（Approve）は押しません";
  }
  const touchesGitHub = /\bgh\s+api\b|api\.github\.com|\brepos\/|\borgs\//.test(lower);
  if (touchesGitHub) {
    for (const [pattern, why] of GITHUB_ALWAYS) if (pattern.test(lower)) return why;
    for (const [pattern, why] of WRITE_GUARDED) {
      if (pattern.test(lower) && WRITE_SIGN.test(text)) return why;
    }
  }
  if (/graphql/.test(lower) && /\bmutation\b/.test(lower)) {
    if (/(protection|ruleset|environment|deployment|collaborator)/.test(lower)) {
      return "GitHub の守りの設定を変える呼び出しはしません";
    }
    if (/\bevent\s*:\s*\\?["']?approve\b/.test(lower)) return "提案書の承認（Approve）は押しません";
    if (/(updateref|deleteref|createcommitonbranch)/.test(lower) && /\b(main|master)\b/.test(lower)) {
      return "main へは直に書かず、提案書を通します";
    }
  }
  if (pushesMain(bare(text), branch)) return "main へは直に push せず、提案書を通します";
  return null;
}

export function judgeTool(name, input, branch) {
  if (!/^mcp__.*github/i.test(name)) {
    // Bash と、Monitor のようにシェルの命令を動かす道具。
    return typeof input?.command === "string" ? judgeBash(input.command, branch) : null;
  }
  const tool = name.split("__").slice(2).join("__").toLowerCase();
  const all = JSON.stringify(input ?? {});
  if (/review/.test(tool) && /"event"\s*:\s*"approve"/i.test(all)) return "提案書の承認（Approve）は押しません";
  if (/secret_scanning/.test(tool)) return null;
  if (/secret|variable/.test(tool)) return "シークレットと変数には、道具から触りません";
  if (/environment|ruleset|protection|collaborator|deployment|webhook/.test(tool) && !/^(list|get)_/.test(tool)) {
    return "承認・環境・ルールセット・協力者は、道具から変えません";
  }
  if (/(create_or_update_file|push_files|delete_file|update_ref)/.test(tool) && /^\s*(refs\/heads\/)?(main|master)\s*$/i.test(String(input?.branch ?? ""))) {
    return "main へは直に書かず、提案書を通します";
  }
  return null;
}

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: cwd || undefined,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return "";
  }
}

const STOPPED =
  "けにーさんの GitHub アカウントで動いているため、この種類の操作はけにーさんが画面で行います" +
  "（docs/開発と運用/権限と鍵.md「Claude の手元の止め」、AUD-211）。回り道で同じことをせず、要るなら手順をけにーさんに渡してください。\n";

function main() {
  try {
    const event = JSON.parse(readFileSync(0, "utf8"));
    if (!event || typeof event !== "object") throw new Error("not an object");
    const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
    const command = typeof input.command === "string" ? input.command : "";
    const branch = /\bpush\b/.test(command) ? currentBranch(event.cwd) : "";
    const why = judgeTool(String(event.tool_name ?? ""), input, branch);
    if (why) {
      process.stderr.write(`承認の守りで止めました: ${why}。${STOPPED}`);
      process.exit(2);
    }
  } catch {
    // 読めないときと、止めの中で失敗したときは通さない（守りが黙って外れないように）。
    process.stderr.write(`承認の守り: 呼び出しを確かめられなかったので止めました。${STOPPED}`);
    process.exit(2);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
