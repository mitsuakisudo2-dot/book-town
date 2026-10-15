import type { Metadata } from "next";
import { supabaseConfigured, supabaseUrl } from "../lib/supabase/config";
import { HOME_TAB_BOOT } from "../lib/home-tab";
import { PROTO_PALETTE_BOOT } from "../lib/proto-palette";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Book Town | 本を読みたくなるSNS",
    template: "%s | Book Town",
  },
  description:
    "読書の終わりを、交流の始まりに。あなたの愛した一冊が、誰かの愛する一冊になる。読書家の小さな書店が集まる、本の街。",
  icons: { icon: "/favicon.svg" },
};
// Google's CSS for the web fonts. Noto Sans JP and Noto Serif JP are variable
// fonts: one weight range names the same font files as listing 400 to 700
// one by one, in a quarter of the CSS. The other two are not variable.
const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400..700&family=Noto+Serif+JP:wght@400..700&family=Kaisei+HarunoUmi:wght@500;700&family=Zen+Old+Mincho:wght@600&display=swap";
// The page paints without waiting for that CSS from another origin: it loads
// as a print sheet, which holds up no paint, and this turns it on for the
// screen once it has arrived, or at once if it already has. Until then the
// text shows in the fallback font, as it does with swap until each file comes.
//
// A reader whose browser loaded this CSS within the last day most likely
// still has it cached (Google sends max-age of a day and a week of
// stale-while-revalidate), so it is turned on at once instead: the first
// layout then asks for the cached font files and the town is drawn in its own
// fonts almost from the first frame, as before. Waiting for load there kept a
// slow phone on the fallback font for about a second on every visit. Chromium
// holds no paint for a sheet turned on while it loads (browser-journey checks
// it with Google stalled); a browser that does would wait as it always did
// before, mostly for its cached copy (inferred for Safari, not run).
const FONTS_LOADED = "book-town-fonts-at";
const SHOW_FONTS = `(function(){var l=document.getElementById("web-fonts"),k="${FONTS_LOADED}",a=[];function on(){l.media="all"}function loaded(){on();try{localStorage.setItem(k,Date.now()+" "+l.href)}catch(x){}}try{a=(localStorage.getItem(k)||"").split(" ")}catch(x){}var d=Date.now()-Number(a[0]);if(a[1]===l.href&&d>=0&&d<864e5)on();if(l.sheet)loaded();else l.addEventListener("load",loaded)})()`;
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // HOME_TAB_BOOT marks <html> with the Home tab that opens before React
    // hydrates.
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* A hosted town reads its first shops and posts from Supabase. */}
        {supabaseConfigured && (
          <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />
        )}
        <link
          id="web-fonts"
          href={FONTS_CSS}
          rel="stylesheet"
          media="print"
          // SHOW_FONTS changes media before React hydrates.
          suppressHydrationWarning
        />
        <script dangerouslySetInnerHTML={{ __html: SHOW_FONTS }} />
        {/* Before the first paint: which Home tab opens, so the other tab's
            blocks stay hidden while the town loads (home-tab.ts). */}
        <script dangerouslySetInnerHTML={{ __html: HOME_TAB_BOOT }} />
        {/* 試作: 残した色と昼／夜を、最初の描画の前に当てる。 */}
        <script dangerouslySetInnerHTML={{ __html: PROTO_PALETTE_BOOT }} />
        <noscript>
          <link href={FONTS_CSS} rel="stylesheet" />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
