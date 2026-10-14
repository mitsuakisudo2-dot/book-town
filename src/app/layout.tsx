import type { Metadata } from "next";
import { supabaseConfigured, supabaseUrl } from "../lib/supabase/config";
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
const SHOW_FONTS = `(function(){var l=document.getElementById("web-fonts");function on(){l.media="all"}if(l.sheet)on();else l.addEventListener("load",on)})()`;
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
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
        <noscript>
          <link href={FONTS_CSS} rel="stylesheet" />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
