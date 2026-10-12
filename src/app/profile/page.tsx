import { Suspense } from "react";
import { RecordById } from "../../components/RecordById";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">プロフィールを開いています…</p>}>
      <RecordById view="profile" />
    </Suspense>
  );
}
