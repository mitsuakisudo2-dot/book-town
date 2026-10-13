import assert from "node:assert/strict";
import {
  COARSE_POINTER,
  coarsePointer,
  focusesFieldOnOpen,
} from "../src/lib/coarse-pointer";

/** A browser whose media queries match only `matching`. */
const screen = (...matching: string[]) => {
  const asked: string[] = [];
  return {
    asked,
    matchMedia: (query: string) => {
      asked.push(query);
      return { matches: matching.includes(query) };
    },
  };
};

{
  // A phone or a tablet: the finger is the main pointer.
  const phone = screen(COARSE_POINTER);
  assert.equal(coarsePointer(phone), true);
  // The main pointer is asked about, not any pointer the device has.
  assert.deepEqual(phone.asked, ["(pointer: coarse)"]);
  // A laptop whose screen also takes touch still points with its trackpad.
  assert.equal(coarsePointer(screen("(any-pointer: coarse)")), false);
  assert.equal(coarsePointer(screen("(pointer: fine)")), false);
  // Where nothing can be asked (the server, a test), no keyboard is assumed.
  assert.equal(coarsePointer({}), false);
  assert.equal(coarsePointer(), false);
}

{
  // A sheet for writing opens without the keyboard on a touch screen, and
  // with the field ready to type into elsewhere.
  assert.equal(focusesFieldOnOpen(true, screen(COARSE_POINTER)), false);
  assert.equal(focusesFieldOnOpen(true, screen("(pointer: fine)")), true);
  assert.equal(focusesFieldOnOpen(true, {}), true);
  // Other sheets keep their first field focused, on any screen.
  assert.equal(focusesFieldOnOpen(false, screen(COARSE_POINTER)), true);
  assert.equal(focusesFieldOnOpen(false, screen("(pointer: fine)")), true);
}

console.log("coarse-pointer ok");
