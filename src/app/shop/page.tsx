import { Suspense } from "react";
import { RecordById } from "../../components/RecordById";

export const metadata = { title: "書店" };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">書店を開いています…</p>}>
      <RecordById view="shop" />
    </Suspense>
  );
}
