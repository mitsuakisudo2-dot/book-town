import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <span className="eyebrow">ANOTHER STREET</span>
      <h1>この道の先には、まだ書店がありません。</h1>
      <p>街の広場から、もう一度歩いてみましょう。</p>
      <Link className="button" href="/">
        本の街へ
      </Link>
    </main>
  );
}
