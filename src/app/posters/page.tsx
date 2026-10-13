import { Suspense } from "react";
import { PosterById } from "../../components/PosterByAddress";

export const metadata = { title: "ポスター" };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">ポスターを開いています…</p>}>
      <PosterById />
    </Suspense>
  );
}
