import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  scramKeys,
  statement,
  verifier,
  weak,
} from "../scripts/catalog-role-password.mjs";

// The statement that lets catalog_import log in (scripts/catalog-role-password.mjs,
// docs/09「本番の設定」): a SCRAM-SHA-256 verifier, never the password.

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("the keys are those of RFC 7677's example", () => {
  const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
  const { clientKey, storedKey, serverKey } = scramKeys("pencil", salt);
  const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
  const message = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
  const signature = createHmac("sha256", storedKey).update(message).digest();
  const proof = Buffer.from(clientKey.map((byte, i) => byte ^ signature[i]));
  assert.equal(
    proof.toString("base64"),
    "dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
  );
  assert.equal(
    createHmac("sha256", serverKey).update(message).digest("base64"),
    "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
  );
});

check(
  "the statement holds a verifier with a new salt, not the password",
  () => {
    const password = "a".repeat(20) + "B".repeat(20);
    const one = statement(password);
    assert.match(
      one,
      /^alter role catalog_import with login password 'SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+';$/,
    );
    assert.ok(!one.includes(password));
    assert.notEqual(verifier(password), verifier(password));
  },
);

check("a short or odd password is refused", () => {
  assert.match(weak(""), /not set/);
  assert.match(weak("a".repeat(31)), /at least 32/);
  assert.match(weak(`${"a".repeat(32)}'`), /letters and digits/);
  assert.equal(weak("a1".repeat(16)), "");
});

console.log(`${passed} catalog role password checks passed`);
