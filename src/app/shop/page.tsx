import { Suspense } from "react";
import { RecordById } from "../../components/RecordById";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">本屋を開いています…</p>}>
      <RecordById view="shop" />
    </Suspense>
  );
}
