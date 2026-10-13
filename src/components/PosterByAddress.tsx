"use client";

import { useSearchParams } from "next/navigation";
import TownApp from "./TownApp";

// Every poster shares one exported page, so the poster (and, when making
// one, its book) is read from the address. A new address is a new page.

export function PosterById() {
  const id = useSearchParams().get("id") ?? "";
  return <TownApp view="poster" selectedId={id} key={id} />;
}

export function PosterNewByAddress() {
  const params = useSearchParams();
  const posterId = params.get("id") ?? undefined;
  const bookId = params.get("book") ?? undefined;
  return (
    <TownApp
      view="poster-new"
      selectedId={posterId}
      bookId={bookId}
      key={(posterId ?? "") + ":" + (bookId ?? "")}
    />
  );
}
