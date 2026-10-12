// Looks after the Vercel project from GitHub Actions, where the Vercel token is
// kept. .github/workflows/vercel.yml runs it.
//
//   node scripts/vercel.mjs status <branch>   the branch's recent deployments,
//                                             and the end of the build log when
//                                             the latest one failed
//   node scripts/vercel.mjs deploy <branch>   builds the branch again and waits;
//                                             main goes to production
//
// Vercel sometimes stops a preview seconds after a push, before building; a
// new build of the same branch is the fix. The logs are public, like the
// repository: build output is printed, the token never is.

import { pathToFileURL } from "node:url";

// Tests point this at a stand-in.
const API = process.env.VERCEL_API_URL ?? "https://api.vercel.com";
const LOG_LINES = 60;
const WAIT_MINUTES = 20;

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

const finished = (state) => ["READY", "ERROR", "CANCELED"].includes(state);

async function main(action, branch) {
  if ((action !== "status" && action !== "deploy") || !validBranch(branch)) {
    console.error("Usage: node scripts/vercel.mjs status|deploy <branch>");
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
