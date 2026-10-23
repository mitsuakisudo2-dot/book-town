// Looks after the Vercel project from GitHub Actions, where the Vercel token is
// kept. .github/workflows/vercel.yml runs it.
//
//   node scripts/vercel.mjs status <branch>   the branch's recent deployments,
//                                             and the end of the build log when
//                                             the latest one failed
//   node scripts/vercel.mjs deploy <branch>   builds the branch again and waits;
//                                             main goes to production
//   node scripts/vercel.mjs ensure <branch>   after a push: waits for Vercel to
//                                             start building DEPLOY_SHA, and
//                                             builds it here when it does not
//   node scripts/vercel.mjs domains main      the project's addresses, whether
//                                             each one works, and the DNS of
//                                             MAIL_DOMAIN
//   node scripts/vercel.mjs domains-apply main
//                                             adds SITE_DOMAIN to the project,
//                                             with www sent on to it
//   node scripts/vercel.mjs mail main         what sending the login email
//                                             from MAIL_DOMAIN still needs
//   node scripts/vercel.mjs mail-apply main   adds MAIL_DOMAIN to Resend, puts
//                                             Resend's DNS records (and DMARC)
//                                             into Vercel's DNS, and waits for
//                                             Resend to verify them
//   node scripts/vercel.mjs rollback main     points SITE_DOMAIN back at the
//                                             production build before the
//                                             current one; refuses when the
//                                             migrations differ between the
//                                             two, unless ALLOW_MIGRATIONS=yes
//   node scripts/vercel.mjs promote-latest main
//                                             points production at the newest
//                                             ready build again, which undoes a
//                                             rollback (until then, Vercel
//                                             builds main without publishing)
//
// Vercel sometimes stops a preview seconds after a push, before building; a
// new build of the same branch is the fix. The logs are public, like the
// repository: build output is printed, the token never is.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Tests point this at a stand-in.
const API = process.env.VERCEL_API_URL ?? "https://api.vercel.com";
const LOG_LINES = 60;
const WAIT_MINUTES = 20;
const ACTIONS = new Set([
  "status",
  "deploy",
  "ensure",
  "domains",
  "domains-apply",
  "mail",
  "mail-apply",
  "rollback",
  "promote-latest",
]);
const RESEND_API = process.env.RESEND_API_URL ?? "https://api.resend.com";
// Tokyo, nearest to the readers.
const MAIL_REGION = "ap-northeast-1";
// Reports only; it asks no mail server to refuse anything.
const DMARC = "v=DMARC1; p=none;";
// Resend's records for sending. A receiving MX would send the domain's
// incoming mail to Resend, so it is left out.
const SENDING_RECORDS = new Set(["SPF", "DKIM"]);

/** Branch names as git allows them, without anything a URL would misread. */
export function validBranch(name) {
  return (
    typeof name === "string" &&
    /^[A-Za-z0-9._/-]{1,200}$/.test(name) &&
    !name.startsWith("-") &&
    !name.includes("..")
  );
}

/** One deployment on one line. */
/**
 * Which Vercel key a run used, by its name in Vercel's list of tokens, and
 * when it runs out: the value itself is never printed. Matching the name here
 * against the list is how the key in a GitHub secret is told apart from the
 * others, and the date is Vercel's own, not one typed into watch.json.
 */
export function tokenLine(token) {
  const expires = token?.expiresAt
    ? new Date(token.expiresAt).toISOString().replace(/:\d\d\.\d+Z$/, "Z")
    : "never";
  const scopes = (token?.scopes ?? [])
    .map((scope) => (scope.projectId ? `${scope.type}:project` : scope.type))
    .filter(Boolean);
  return `Key in use: ${token?.name ?? "(no name)"}, expires ${expires}${scopes.length ? `, scope ${scopes.join(" ")}` : ""}`;
}

export function deploymentLine(deployment) {
  // Listed deployments carry `created`; a single one carries `createdAt`.
  const time = deployment.created ?? deployment.createdAt;
  const when = time
    ? new Date(time).toISOString().replace(/\.\d+Z$/, "Z")
    : "(no time)";
  const state = deployment.readyState ?? deployment.state ?? "UNKNOWN";
  const sha = deployment.meta?.githubCommitSha?.slice(0, 7) ?? "-------";
  const error = deployment.errorCode
    ? ` ${deployment.errorCode}: ${deployment.errorMessage ?? ""}`
    : "";
  return `${when} ${state.padEnd(9)} ${sha} ${deployment.target ?? "preview"} https://${deployment.url}${error}`;
}

const LOG_TYPES = new Set(["command", "stdout", "stderr", "fatal", "exit"]);

/** The build log's text, oldest first, from events read newest first. */
export function logLines(events) {
  return (events ?? [])
    .filter((event) => event && LOG_TYPES.has(event.type))
    .map((event) => event.text ?? event.payload?.text ?? "")
    .filter((text) => text.trim())
    .reverse();
}

/** A DNS name as Vercel takes it: relative to the domain, "" for the domain. */
export function relativeName(name, domain) {
  const full = String(name ?? "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (full === "" || full === "@" || full === domain) return "";
  return full.endsWith("." + domain) ? full.slice(0, -domain.length - 1) : full;
}

const recordValue = (value) =>
  String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/s, "$1");

/** One DNS record on one line. */
export function recordLine(record) {
  const priority = record.mxPriority != null ? ` ${record.mxPriority}` : "";
  return `${record.type} ${record.name || "@"}${priority} ${record.value}`;
}

/**
 * What the domain's DNS needs for Resend: the sending records it lacks, and
 * DMARC when the domain has none. A record already there with another value
 * is a clash, never overwritten.
 */
export function dnsPlan(resendRecords, existing, domain) {
  const wanted = (resendRecords ?? [])
    .filter((record) => SENDING_RECORDS.has(record.record))
    .map((record) => ({
      type: record.type,
      name: relativeName(record.name, domain),
      value: recordValue(record.value),
      ...(record.type === "MX"
        ? { mxPriority: Number(record.priority ?? 10) }
        : {}),
    }));
  const have = (existing ?? []).map((record) => ({
    type: record.type,
    name: relativeName(record.name, domain),
    value: recordValue(record.value),
  }));
  if (!have.some((r) => r.type === "TXT" && r.name === "_dmarc"))
    wanted.push({ type: "TXT", name: "_dmarc", value: DMARC });
  const add = [];
  const clash = [];
  for (const record of wanted) {
    const same = have.filter(
      (r) => r.type === record.type && r.name === record.name,
    );
    if (same.some((r) => r.value === record.value)) continue;
    // A name can hold several MX records, and a TXT name several strings,
    // except the ones that must be alone: SPF, DKIM and DMARC.
    const spf = (value) => /^v=spf1\b/i.test(value);
    const alone =
      record.type !== "MX" &&
      same.some(
        (r) =>
          (spf(r.value) && spf(record.value)) ||
          record.name.endsWith("_domainkey") ||
          record.name === "_dmarc",
      );
    (alone ? clash : add).push(record);
  }
  return { add, clash };
}

/**
 * The project addresses the site needs: the domain itself, and www sent on to
 * it for good (308). Returns the ones to add and the ones to correct.
 */
export function siteDomainPlan(existing, site) {
  const wanted = [
    { name: site },
    { name: "www." + site, redirect: site, redirectStatusCode: 308 },
  ];
  const add = [];
  const fix = [];
  for (const domain of wanted) {
    const found = (existing ?? []).find((d) => d.name === domain.name);
    if (!found) add.push(domain);
    else if (
      (found.redirect ?? null) !== (domain.redirect ?? null) ||
      (domain.redirect &&
        found.redirectStatusCode !== domain.redirectStatusCode)
    )
      fix.push(domain);
  }
  return { add, fix };
}

/** A project address on one line: where it goes and whether it works. */
export function domainLine(domain, config) {
  const parts = [domain.name, domain.verified ? "verified" : "not verified"];
  if (domain.redirect)
    parts.push(`-> ${domain.redirect} (${domain.redirectStatusCode ?? 307})`);
  if (domain.gitBranch) parts.push(`branch ${domain.gitBranch}`);
  if (config)
    parts.push(config.misconfigured ? "DNS not pointing here" : "DNS ok");
  return parts.join(" ");
}

/**
 * The production build to go back to: the newest ready one made before the
 * build production shows now. Vercel's free plan allows only that one.
 */
export function rollbackTarget(deployments, current) {
  const createdOf = (d) => d.created ?? d.createdAt ?? 0;
  const now = createdOf(current);
  return (
    (deployments ?? [])
      .filter(
        (d) =>
          (d.uid ?? d.id) !== current.id &&
          d.readyState === "READY" &&
          d.target === "production" &&
          createdOf(d) < now,
      )
      .sort((a, b) => createdOf(b) - createdOf(a))[0] ?? null
  );
}

/**
 * The migrations that differ between two commits, or null when git cannot
 * tell (a commit missing from the checkout). A site built before a migration
 * may not work with the database after it.
 */
export function migrationsBetween(from, to) {
  if (!/^[0-9a-f]{40}$/.test(from ?? "") || !/^[0-9a-f]{40}$/.test(to ?? ""))
    return null;
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", from, to, "--", "supabase/migrations"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
}

const finished = (state) => ["READY", "ERROR", "CANCELED"].includes(state);

async function main(action, branch) {
  if (!ACTIONS.has(action) || !validBranch(branch)) {
    console.error(
      "Usage: node scripts/vercel.mjs status|deploy|ensure|domains|domains-apply|mail|mail-apply|rollback|promote-latest <branch>",
    );
    process.exit(2);
  }
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.log("::warning::VERCEL_TOKEN is not set, so Vercel was not asked.");
    return;
  }
  const team = process.env.VERCEL_TEAM;
  const project = process.env.VERCEL_PROJECT;
  const [org, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

  const call = async (method, route, query = {}, body) => {
    const url = new URL(route, API);
    // A key's own details belong to its user, not the team: Vercel answers
    // 400 when they are asked for with the team's slug.
    const own = route.startsWith("/v5/user/");
    for (const [key, value] of Object.entries(
      own ? query : { ...query, slug: team },
    ))
      url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body && JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `Vercel answered ${response.status} to ${method} ${route}: ` +
          text.split(token).join("***"),
      );
    return text ? JSON.parse(text) : null;
  };

  const printLog = async (id) => {
    const events = await call("GET", `/v3/deployments/${id}/events`, {
      builds: 1,
      direction: "backward",
      limit: 400,
    });
    const lines = logLines(events).slice(-LOG_LINES);
    console.log(`Last ${lines.length} lines of the build log:`);
    for (const line of lines) console.log("  " + line);
  };

  const mailDomain = process.env.MAIL_DOMAIN ?? "";
  const dnsRecords = async () => {
    const { records } = await call(
      "GET",
      `/v4/domains/${encodeURIComponent(mailDomain)}/records`,
      { limit: 100 },
    );
    return records ?? [];
  };

  if (action === "domains" || action === "domains-apply") {
    const route = `/v9/projects/${encodeURIComponent(project)}/domains`;
    let { domains } = await call("GET", route);
    if (action === "domains-apply") {
      const site = process.env.SITE_DOMAIN ?? "";
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site))
        throw new Error("SITE_DOMAIN is not a domain.");
      const { add, fix } = siteDomainPlan(domains, site);
      for (const domain of add) {
        console.log(`Adding ${domain.name}`);
        await call(
          "POST",
          `/v10/projects/${encodeURIComponent(project)}/domains`,
          {},
          domain,
        );
      }
      for (const domain of fix) {
        console.log(`Correcting ${domain.name}`);
        await call(
          "PATCH",
          `${route}/${encodeURIComponent(domain.name)}`,
          {},
          {
            redirect: domain.redirect ?? null,
            redirectStatusCode: domain.redirectStatusCode ?? null,
          },
        );
      }
      if (!add.length && !fix.length)
        console.log("The addresses are in place.");
      ({ domains } = await call("GET", route));
    }
    console.log(`Addresses of ${project}:`);
    for (const domain of domains ?? []) {
      const config = domain.name.endsWith(".vercel.app")
        ? null
        : await call(
            "GET",
            `/v6/domains/${encodeURIComponent(domain.name)}/config`,
          );
      console.log("  " + domainLine(domain, config));
    }
    if (mailDomain) {
      console.log(`DNS records of ${mailDomain}:`);
      let records;
      try {
        records = await dnsRecords();
      } catch (error) {
        // A key kept to the project may not read the team's DNS (docs/09
        // 「Vercel の鍵」), so the addresses above are all it can show.
        if (!/^Vercel answered 403 /.test(error.message)) throw error;
        console.log(
          "  This key may not read the team's DNS records (it is kept to the project); adding DNS records needs a key for the team.",
        );
        return;
      }
      for (const record of records) console.log("  " + recordLine(record));
    }
    return;
  }

  if (action === "mail" || action === "mail-apply") {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(mailDomain))
      throw new Error("MAIL_DOMAIN is not a domain.");
    // Adding a domain needs a Full access key; the sending key in
    // RESEND_API_KEY may only send.
    const resendKey =
      process.env.RESEND_ADMIN_KEY || process.env.RESEND_API_KEY || "";
    if (!resendKey) {
      console.log("::warning::No Resend key is set, so Resend was not asked.");
      return;
    }
    const resend = async (method, route, body) => {
      const response = await fetch(new URL(route, RESEND_API), {
        method,
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: body && JSON.stringify(body),
      });
      const text = await response.text();
      if (response.status === 401 && /restricted/i.test(text)) {
        console.log(
          "::error::This Resend key may only send email. Adding a domain needs a Full access key, kept as the RESEND_ADMIN_KEY secret.",
        );
        throw new Error("Resend refused the key.");
      }
      if (!response.ok)
        throw new Error(
          `Resend answered ${response.status} to ${method} ${route}: ` +
            text.split(resendKey).join("***"),
        );
      return text ? JSON.parse(text) : null;
    };
    const apply = action === "mail-apply";

    const { data } = await resend("GET", "/domains");
    let found = (data ?? []).find((domain) => domain.name === mailDomain);
    if (!found) {
      if (!apply) {
        console.log(
          `${mailDomain} is not in Resend yet; mail-apply adds it (${MAIL_REGION}).`,
        );
        return;
      }
      found = await resend("POST", "/domains", {
        name: mailDomain,
        region: MAIL_REGION,
      });
      console.log(`Added ${mailDomain} to Resend (${MAIL_REGION}).`);
    }
    const path = `/domains/${encodeURIComponent(found.id)}`;
    let domain = await resend("GET", path);
    console.log(`Resend: ${mailDomain} is ${domain.status}`);

    const { add, clash } = dnsPlan(
      domain.records,
      await dnsRecords(),
      mailDomain,
    );
    for (const record of clash)
      console.log(
        `::error::${mailDomain} already has another ${record.type} at ${record.name || "@"}; wanted ${recordLine(record)}`,
      );
    if (clash.length)
      throw new Error("The DNS records clash; nothing changed.");
    if (!add.length) console.log("The DNS already has every record.");
    for (const record of add)
      console.log(`  ${apply ? "adding" : "would add"} ${recordLine(record)}`);
    if (!apply) return;

    for (const record of add)
      await call(
        "POST",
        `/v2/domains/${encodeURIComponent(mailDomain)}/records`,
        {},
        { ...record, ttl: 60 },
      );
    if (domain.status !== "verified") await resend("POST", `${path}/verify`);
    const wait = Number(process.env.MAIL_WAIT_SECONDS ?? 360) * 1000;
    const poll = Number(process.env.MAIL_POLL_SECONDS ?? 20) * 1000;
    const until = Date.now() + wait;
    while (domain.status !== "verified" && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, poll));
      domain = await resend("GET", path);
    }
    for (const record of domain.records ?? [])
      console.log(
        `  ${record.record} ${record.type} ${record.name}: ${record.status}`,
      );
    console.log(`Resend: ${mailDomain} is ${domain.status}`);
    if (domain.status !== "verified")
      console.log(
        "::warning::Not verified yet. DNS can take a while; run mail-apply again later.",
      );
    return;
  }

  const site = process.env.SITE_DOMAIN ?? "";
  const shown = async () =>
    call("GET", `/v13/deployments/${encodeURIComponent(site)}`);
  const production = async () => {
    const { deployments } = await call("GET", "/v7/deployments", {
      projectId: project,
      target: "production",
      limit: 20,
    });
    return deployments ?? [];
  };
  // After a rollback Vercel keeps building main but stops publishing it.
  async function warnIfRolledBack(own) {
    if (!site) return;
    try {
      const current = await shown();
      if (current.id !== own.uid && current.id !== own.id)
        console.log(
          `::warning::${site} still shows ${deploymentLine(current)}. If production was rolled back, promote-latest publishes main again.`,
        );
    } catch (error) {
      console.log(`Could not tell what ${site} shows: ${error.message}`);
    }
  }

  if (action === "rollback" || action === "promote-latest") {
    if (branch !== "main") throw new Error("Only main goes to production.");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site))
      throw new Error("SITE_DOMAIN is not a domain.");
    const current = await shown();
    console.log(`${site} shows ${deploymentLine(current)}`);
    const list = await production();
    if (action === "promote-latest") {
      const latest = list.find((d) => d.readyState === "READY");
      if (!latest) throw new Error("No ready production build.");
      if (latest.uid === current.id) {
        console.log("It is already the newest ready build.");
        return;
      }
      await call(
        "POST",
        `/v10/projects/${encodeURIComponent(project)}/promote/${encodeURIComponent(latest.uid)}`,
      );
      console.log("Published again: " + deploymentLine(latest));
      return;
    }
    const target = rollbackTarget(list, current);
    if (!target) throw new Error("No earlier ready production build.");
    const changed = migrationsBetween(
      target.meta?.githubCommitSha,
      current.meta?.githubCommitSha,
    );
    if (changed === null || changed.length) {
      if (changed === null)
        console.log(
          "::warning::Could not compare the migrations of the two builds.",
        );
      for (const file of changed ?? [])
        console.log(`  migration since then: ${file}`);
      if (process.env.ALLOW_MIGRATIONS !== "yes")
        throw new Error(
          "The database may have changed since that build, so nothing was rolled back. Run it again with allow_migrations once the owner agrees.",
        );
    }
    await call(
      "POST",
      `/v1/projects/${encodeURIComponent(project)}/rollback/${encodeURIComponent(target.uid)}`,
      {
        description: `Rolled back from ${current.meta?.githubCommitSha?.slice(0, 7) ?? current.id}`,
      },
    );
    console.log("Rolled back to: " + deploymentLine(target));
    console.log(
      "Vercel now builds main without publishing it; promote-latest publishes the newest build again.",
    );
    return;
  }

  if (action === "status") {
    try {
      const { token: used } = await call("GET", "/v5/user/tokens/current");
      console.log(tokenLine(used));
    } catch (error) {
      // Vercel names only a key of the whole team or account: one kept to
      // a project is answered with 404.
      console.log(
        /^Vercel answered 404 /.test(error.message)
          ? "Key in use: one Vercel does not name (a key kept to the project)"
          : `Could not tell which key this is: ${error.message}`,
      );
    }
    const { projects } = await call("GET", "/v10/projects", { limit: 20 });
    console.log("Projects: " + projects.map((p) => p.name).join(", "));
    const { deployments } = await call("GET", "/v7/deployments", {
      projectId: project,
      branch,
      limit: 5,
    });
    console.log(`Latest deployments of ${branch}:`);
    for (const deployment of deployments)
      console.log("  " + deploymentLine(deployment));
    const latest = deployments[0];
    if (latest && ["ERROR", "CANCELED"].includes(latest.readyState))
      await printLog(latest.uid);
    return;
  }

  if (action === "ensure") {
    // Vercel's own GitHub connection sometimes misses a push to main, and
    // production stays on the previous commit. Give it a moment first.
    const sha = process.env.DEPLOY_SHA ?? "";
    if (!/^[0-9a-f]{40}$/.test(sha))
      throw new Error("DEPLOY_SHA is not a commit.");
    const wait = Number(process.env.ENSURE_WAIT_SECONDS ?? 150) * 1000;
    const poll = Number(process.env.ENSURE_POLL_SECONDS ?? 15) * 1000;
    const until = Date.now() + wait;
    // Once Vercel has started it, wait for the end of the build: a run that
    // ends while it is still building would say nothing of how it ended, and
    // the check after publishing (watch.yml) would look at the build before.
    const built =
      Date.now() +
      Number(process.env.ENSURE_BUILD_SECONDS ?? WAIT_MINUTES * 60) * 1000;
    for (;;) {
      const { deployments } = await call("GET", "/v7/deployments", {
        projectId: project,
        branch,
        limit: 10,
      });
      const own = deployments.find(
        (deployment) => deployment.meta?.githubCommitSha === sha,
      );
      if (own?.readyState === "READY") {
        console.log("Vercel built it: " + deploymentLine(own));
        await warnIfRolledBack(own);
        return;
      }
      if (own && finished(own.readyState)) {
        console.log("Vercel stopped; building it here: " + deploymentLine(own));
        break;
      }
      if (own && Date.now() >= built)
        throw new Error(
          "Vercel was still building it when the wait ran out: " +
            deploymentLine(own),
        );
      if (Date.now() >= until && !own) {
        console.log(
          `Vercel did not start ${sha.slice(0, 7)}; building it here.`,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
  }

  const created = await call(
    "POST",
    "/v13/deployments",
    { forceNew: 1 },
    {
      name: project,
      project,
      ...(branch === "main" ? { target: "production" } : {}),
      gitSource: { type: "github", org, repo, ref: branch },
    },
  );
  console.log(`Building ${branch}: https://${created.url}`);
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  let deployment = created;
  while (!finished(deployment.readyState) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    deployment = await call("GET", `/v13/deployments/${created.id}`);
  }
  console.log(deploymentLine(deployment));
  if (deployment.readyState === "READY") return;
  await printLog(created.id);
  throw new Error(
    finished(deployment.readyState)
      ? "The build did not finish."
      : `Still building after ${WAIT_MINUTES} minutes.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2], process.argv[3]).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
