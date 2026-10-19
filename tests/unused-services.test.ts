import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as unused from "../src/lib/supabase/unused-services";

// The build puts unused-services.ts in place of supabase-js's Realtime,
// Storage and Functions (next.config.ts). A newer supabase-js that takes
// another name from them, or asks its Realtime client something more, would
// break the client on every page: this stops it here first.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const root = path.resolve(__dirname, "..");
const supabase = readFileSync(
  path.join(root, "node_modules/@supabase/supabase-js/dist/index.mjs"),
  "utf8",
);
const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
const SERVICES = ["realtime-js", "storage-js", "functions-js"];

check("the build puts the file in place of each of the three", () => {
  for (const name of SERVICES)
    assert.match(config, new RegExp(`"@supabase/${name}"`));
});

check("it names everything supabase-js takes from them", () => {
  const taken = [
    ...supabase.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*"@supabase\/(realtime|storage|functions)-js"/g,
    ),
  ].flatMap((match) => match[1].split(",").map((name) => name.trim()));
  assert.ok(
    taken.includes("RealtimeClient"),
    "supabase-js's imports were found",
  );
  for (const name of taken)
    assert.ok(name in unused, `${name} is in unused-services.ts`);
  // Nothing else of theirs comes in another way.
  const others = supabase.match(
    /from\s*"@supabase\/(realtime|storage|functions)-js"/g,
  );
  const reExports = supabase.match(/export \* from "@supabase\/realtime-js"/g);
  assert.equal(others?.length ?? 0, 3 + (reExports?.length ?? 0));
});

check("its Realtime client answers all supabase-js asks of it", () => {
  const asked = new Set(
    [...supabase.matchAll(/this\.realtime\.(\w+)/g)].map((match) => match[1]),
  );
  const realtime = new unused.RealtimeClient() as unknown as Record<
    string,
    unknown
  >;
  for (const name of asked)
    assert.equal(typeof realtime[name], "function", `realtime.${name}`);
  assert.equal(
    [...supabase.matchAll(/this\.storage\.\w+/g)].length,
    0,
    "supabase-js asks its Storage client nothing itself",
  );
});

console.log(`${passed} checks passed`);
