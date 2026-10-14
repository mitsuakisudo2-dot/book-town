import assert from "node:assert/strict";
import {
  bookLookup,
  googleLookupUrl,
  iosLookupUrl,
  lookupQuery,
} from "../src/lib/book-lookup";
import { iosDevice, iosSafari } from "../src/lib/user-agent";

// この本について調べる (book-lookup.ts): the words searched for, Google's
// address, Safari's own search on the iPhone and iPad, and which device and
// browser is which (user-agent.ts).

const UA = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  iPadSafari:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  iPhoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
  iPhoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.0.0 Mobile/15E148 Safari/605.1.15",
  iPhoneLine:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.12.0",
  iPhoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 18_6; ja_JP)",
  iPhoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBLC/ja_JP]",
  // An app's own view names no browser.
  iPhoneInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iPadChrome:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  // iPadOS Safari, and every Mac's Safari, say this.
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  // Chrome on Android asking for the computer's page.
  androidDesktop:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
};

const solaris = { title: "ソラリス", author: "スタニスワフ・レム" };
const PREFIX = "x-web-search://?";

{
  // The title and the author, a full-width space between them.
  assert.equal(lookupQuery(solaris), "ソラリス　スタニスワフ・レム");
  // Google's address is the one the link always had.
  assert.equal(
    googleLookupUrl(solaris),
    "https://google.com/search?q=%E3%82%BD%E3%83%A9%E3%83%AA%E3%82%B9%E3%80%80%E3%82%B9%E3%82%BF%E3%83%8B%E3%82%B9%E3%83%AF%E3%83%95%E3%83%BB%E3%83%AC%E3%83%A0",
  );
  assert.equal(
    new URL(googleLookupUrl(solaris)).searchParams.get("q"),
    "ソラリス　スタニスワフ・レム",
  );
  // Safari's search is given the same words.
  assert.equal(
    iosLookupUrl(solaris),
    PREFIX +
      "%E3%82%BD%E3%83%A9%E3%83%AA%E3%82%B9%E3%80%80%E3%82%B9%E3%82%BF%E3%83%8B%E3%82%B9%E3%83%AF%E3%83%95%E3%83%BB%E3%83%AC%E3%83%A0",
  );
}

{
  // Characters that mean something in an address stay part of the words.
  const odd = { title: "A & B? #1 は 50%", author: "C+D / E=F" };
  const words = "A & B? #1 は 50%　C+D / E=F";
  assert.equal(lookupQuery(odd), words);
  assert.equal(
    new URL(googleLookupUrl(odd)).searchParams.get("q"),
    words,
    "one q, nothing cut off at & or #",
  );
  assert.equal(new URL(googleLookupUrl(odd)).hash, "");
  const ios = iosLookupUrl(odd);
  assert.ok(ios.startsWith(PREFIX));
  const query = ios.slice(PREFIX.length);
  // Nothing after the "?" could end the words or start another part.
  assert.match(query, /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-F]{2})+$/);
  assert.match(query, /^A%20%26%20B%3F%20%231%20/);
  assert.equal(decodeURIComponent(query), words);
  assert.equal(new URL(ios).hash, "");
  assert.equal(decodeURIComponent(new URL(ios).search.slice(1)), words);
}

{
  // The link says where it goes on each device.
  const iPhone = bookLookup(solaris, true);
  assert.equal(iPhone.href, iosLookupUrl(solaris));
  assert.equal(
    iPhone.label,
    "この本について調べる（いつもの検索で、新しいタブで開きます）",
  );
  // The spoken name holds the words on the link, so a spoken
  // この本について調べる finds it.
  assert.ok(iPhone.label.startsWith("この本について調べる"));
  const elsewhere = bookLookup(solaris, false);
  assert.equal(elsewhere.href, googleLookupUrl(solaris));
  assert.equal(
    elsewhere.label,
    "この本についてGoogleで調べる（新しいタブで開きます）",
  );
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

{
  // Only Safari itself answers x-web-search://. Another browser on an iPhone
  // would hand it to Safari or refuse it, and an app's own view (LINE,
  // Instagram) may drop it: they keep Google.
  const cases: [string, string, number, boolean][] = [
    ["iPhone Safari", UA.iPhoneSafari, 5, true],
    ["iPad Safari asking for the iPad page", UA.iPadSafari, 5, true],
    ["iPod touch Safari", UA.iPod, 5, true],
    ["iPadOS Safari as a Mac", UA.macSafari, 5, true],
    ["iPhone Chrome", UA.iPhoneChrome, 5, false],
    ["iPhone Firefox", UA.iPhoneFirefox, 5, false],
    ["iPhone Edge", UA.iPhoneEdge, 5, false],
    ["iPhone LINE", UA.iPhoneLine, 5, false],
    ["iPhone Instagram", UA.iPhoneInstagram, 5, false],
    ["iPhone Facebook", UA.iPhoneFacebook, 5, false],
    ["iPhone app's own view", UA.iPhoneInApp, 5, false],
    ["iPad Chrome", UA.iPadChrome, 5, false],
    ["Mac Safari without touch", UA.macSafari, 0, false],
    ["Mac Chrome", UA.macChrome, 0, false],
    ["Android", UA.androidChrome, 5, false],
    ["Android asking for the computer's page", UA.androidDesktop, 5, false],
    ["Windows", UA.windowsEdge, 0, false],
    ["Windows with a touch screen", UA.windowsEdge, 10, false],
    ["nothing known", "", 0, false],
  ];
  for (const [name, ua, touch, safari] of cases)
    assert.equal(iosSafari(ua, touch), safari, name);
}

console.log("book-lookup ok");
