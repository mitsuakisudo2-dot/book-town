import assert from "node:assert/strict";
import { books } from "../src/lib/data";
import { sameWork, workOf } from "../src/lib/works";

const [first, second] = books;

// A book without a work is its own work.
assert.equal(workOf(first), first.id);
assert.ok(sameWork(first, { id: first.id }));
assert.ok(!sameWork(first, second));

// Two editions of one work meet at the work, not at the edition.
const work = "work:same-text";
const hardcover = { ...first, workId: work };
const paperback = { ...second, workId: work };
assert.equal(workOf(hardcover), work);
assert.ok(sameWork(hardcover, paperback));
assert.ok(!sameWork(hardcover, first));

console.log("works ok");
