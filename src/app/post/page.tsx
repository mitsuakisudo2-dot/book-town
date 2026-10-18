import { Suspense } from "react";
import { RecordById } from "../../components/RecordById";
import { NAMES } from "../../lib/words";

export const metadata = { title: NAMES.letter };

export default function Page() {
  return (
    <Suspense fallback={<p role="status">{NAMES.letter}を開いています…</p>}>
      <RecordById view="post" />
    </Suspense>
  );
}
