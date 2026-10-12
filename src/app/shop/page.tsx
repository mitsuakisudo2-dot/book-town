import { Suspense } from "react";
import { RecordById } from "../../components/RecordById";

export const metadata = { title: "本屋" };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">本屋を開いています…</p>}>
      <RecordById view="shop" />
    </Suspense>
  );
}
