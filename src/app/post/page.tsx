import { Suspense } from "react";
import { RecordById } from "../../components/RecordById";

export const metadata = { title: "便り" };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">便りを開いています…</p>}>
      <RecordById view="post" />
    </Suspense>
  );
}
