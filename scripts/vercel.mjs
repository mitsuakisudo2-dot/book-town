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
//   node scripts/vercel.mjs mail main         what sending the login email
//                                             from MAIL_DOMAIN still needs
//   node scripts/vercel.mjs mail-apply main   adds MAIL_DOMAIN to Resend, puts
//                                             Resend's DNS records (and DMARC)
//                                             into Vercel's DNS, and waits for
//                                             Resend to verify them
//
// Vercel sometimes stops a preview seconds after a push, before building; a
// new build of the same branch is the fix. The logs are public, like the
// repository: build output is printed, the token never is.

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
  "mail",
  "mail-apply",
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

const finished = (state) => ["READY", "ERROR", "CANCELED"].includes(state);

async function main(action, branch) {
  if (!ACTIONS.has(action) || !validBranch(branch)) {
    console.error(
      "Usage: node scripts/vercel.mjs status|deploy|ensure|domains|mail|mail-apply <branch>",
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
    for (const [key, value] of Object.entries({ ...query, slug: team }))
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

  if (action === "domains") {
    const { domains } = await call(
      "GET",
      `/v9/projects/${encodeURIComponent(project)}/domains`,
    );
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
      for (const record of await dnsRecords())
        console.log("  " + recordLine(record));
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

  if (action === "status") {
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
        return;
      }
      if (own && finished(own.readyState)) {
        console.log("Vercel stopped; building it here: " + deploymentLine(own));
        break;
      }
      if (Date.now() >= until) {
        if (own) {
          console.log("Vercel is still building it: " + deploymentLine(own));
          return;
        }
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
