"use client";

import { useSearchParams } from "next/navigation";
import TownApp from "./TownApp";

/** A shop or a reader from the database, named by ?id= on a shared page. */
export function RecordById({ view }: { view: "shop" | "profile" }) {
  const id = useSearchParams().get("id") ?? "";
  return <TownApp view={view} selectedId={id} key={id} />;
}
