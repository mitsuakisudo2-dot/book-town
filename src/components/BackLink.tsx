"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { canGoBackInTown, subscribeTrail } from "../lib/in-town";
import { Icon } from "./ui";

/**
 * Back to where the reader came from within the town. A page opened
 * directly (a shared link) leads to the town itself instead.
 */
export function BackLink({
  className,
  icon = true,
  children,
}: {
  className?: string;
  icon?: boolean;
  /** Shown after the words, e.g. where the reader is in a row of shops. */
  children?: ReactNode;
}) {
  const router = useRouter();
  // The exported page has nothing behind it, so it says 本の街へ until the
  // tab's own trail says otherwise.
  const back = useSyncExternalStore(
    subscribeTrail,
    canGoBackInTown,
    () => false,
  );
  const content = (
    <>
      {icon && <Icon name="back" size={16} />}
      {back ? "戻る" : "本の街へ"}
      {children}
    </>
  );
  return back ? (
    <button type="button" className={className} onClick={() => router.back()}>
      {content}
    </button>
  ) : (
    <Link href="/" className={className}>
      {content}
    </Link>
  );
}
