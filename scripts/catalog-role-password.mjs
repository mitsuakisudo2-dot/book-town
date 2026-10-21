// Prints the statement that lets the role catalog_import log in, with the
// password of the environment catalog (CATALOG_DB_PASSWORD), for
// .github/workflows/catalog-role-password.yml to send to the database
// (docs/09「本番の設定」). The password itself never reaches the database:
// what is sent is its SCRAM-SHA-256 verifier, made here with a new salt, as
// psql's \password makes it, so no statement log can hold the password.
//
// Run once, after the owner approves. Rollback:
//   alter role catalog_import nologin password null;

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const ITERATIONS = 4096;

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();

/** The keys a SCRAM-SHA-256 verifier holds (RFC 5802, RFC 7677). */
export function scramKeys(password, salt, iterations = ITERATIONS) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = hmac(salted, "Client Key");
  return {
    clientKey,
    storedKey: createHash("sha256").update(clientKey).digest(),
    serverKey: hmac(salted, "Server Key"),
  };
}

/** What Postgres keeps for a password, in its own form. */
export function verifier(password, salt = randomBytes(16)) {
  const { storedKey, serverKey } = scramKeys(password, salt);
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** Why a password will not do, or nothing. */
export function weak(password) {
  if (!password) return "CATALOG_DB_PASSWORD is not set.";
  if (!/^[A-Za-z0-9]{32,}$/.test(password))
    return "CATALOG_DB_PASSWORD must be at least 32 letters and digits, nothing else.";
  return "";
}

export const statement = (password) =>
  `alter role catalog_import with login password '${verifier(password)}';`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const password = process.env.CATALOG_DB_PASSWORD ?? "";
  const problem = weak(password);
  if (problem) {
    console.error(`::error::${problem}`);
    process.exit(1);
  }
  process.stdout.write(`${statement(password)}\n`);
}
