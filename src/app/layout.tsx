import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Book Town | 本を読みたくなるSNS",
  description:
    "読書の終わりを、交流の始まりに。あなたの愛した一冊が、誰かの愛する一冊になる。読書家の小さな書店が集まる、本の街。",
  icons: { icon: "/favicon.svg" },
};
// App Router root layout keeps these font links on every route.
/* eslint-disable @next/next/no-page-custom-font */
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
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Serif+JP:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
