import assert from "node:assert/strict";
import {
  bookLookup,
  googleLookupUrl,
  lookupQuery,
} from "../src/lib/book-lookup";
import { iosDevice } from "../src/lib/user-agent";

// この本について調べる (book-lookup.ts): the words searched for and Google's
// address, and which device is an iPhone or iPad (user-agent.ts).

const UA = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  iPadSafari:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  // iPadOS Safari, and every Mac's Safari, say this.
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
};

const solaris = { title: "ソラリス", author: "スタニスワフ・レム" };

{
  // The title alone, without the author.
  assert.equal(lookupQuery(solaris), "ソラリス");
  assert.equal(
    googleLookupUrl(solaris),
    "https://google.com/search?q=%E3%82%BD%E3%83%A9%E3%83%AA%E3%82%B9",
  );
  assert.equal(
    new URL(googleLookupUrl(solaris)).searchParams.get("q"),
    "ソラリス",
  );
}

{
  // Characters that mean something in an address stay part of the words.
  const odd = { title: "A & B? #1 は 50%　C+D / E=F", author: "" };
  const words = "A & B? #1 は 50%　C+D / E=F";
  assert.equal(lookupQuery(odd), words);
  assert.equal(
    new URL(googleLookupUrl(odd)).searchParams.get("q"),
    words,
    "one q, nothing cut off at & or #",
  );
  assert.equal(new URL(googleLookupUrl(odd)).hash, "");
}

{
  // The link goes to Google on every device, Safari on an iPhone too.
  const link = bookLookup(solaris);
  assert.equal(link.href, googleLookupUrl(solaris));
  assert.equal(link.label, "この本についてGoogleで調べる（新しいタブで開きます）");
}

{
  const cases: [string, string, number, boolean][] = [
    ["iPhone Safari", UA.iPhoneSafari, 5, true],
    ["iPhone Chrome", UA.iPhoneChrome, 5, true],
    ["iPad asking for the iPad page", UA.iPadSafari, 5, true],
    ["iPod touch", UA.iPod, 5, true],
    // iPadOS asks for the computer's page; only the touch screen tells.
    ["iPadOS as a Mac", UA.macSafari, 5, true],
    ["Mac without touch", UA.macSafari, 0, false],
    ["Mac Chrome", UA.macChrome, 0, false],
    // A single touch point is not an iPad's screen.
    ["Mac reporting one touch point", UA.macSafari, 1, false],
    ["Android", UA.androidChrome, 5, false],
    ["Windows", UA.windowsEdge, 0, false],
    ["Windows with a touch screen", UA.windowsEdge, 10, false],
    ["nothing known", "", 0, false],
  ];
  for (const [name, ua, touch, ios] of cases)
    assert.equal(iosDevice(ua, touch), ios, name);
}

console.log("book-lookup ok");
