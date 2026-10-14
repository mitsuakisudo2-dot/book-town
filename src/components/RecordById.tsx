"use client";

import { useSearchParams } from "next/navigation";
import TownApp from "./TownApp";

/** A shop, a reader or a 便り, named by ?id= on a shared page. */
export function RecordById({ view }: { view: "shop" | "profile" | "post" }) {
  const id = useSearchParams().get("id") ?? "";
  return <TownApp view={view} selectedId={id} key={id} />;
}
