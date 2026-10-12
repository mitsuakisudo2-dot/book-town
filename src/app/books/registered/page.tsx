import { Suspense } from "react";
import { RegisteredBookView } from "../../../components/RegisteredBookView";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">本を開いています…</p>}>
      <RegisteredBookView />
    </Suspense>
  );
}
