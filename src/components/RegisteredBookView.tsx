"use client";

import { useSearchParams } from "next/navigation";
import TownApp from "./TownApp";

export function RegisteredBookView() {
  const params = useSearchParams();
  return <TownApp view="book" selectedId={params.get("id") ?? ""} />;
}
