import { Suspense } from "react";
import { PosterNewByAddress } from "../../../components/PosterByAddress";

export const metadata = { title: "ポスターを作る" };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">ポスターの作業台を出しています…</p>}>
      <PosterNewByAddress />
    </Suspense>
  );
}
