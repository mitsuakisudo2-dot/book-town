"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { accountActions, useAccountState } from "../lib/account-session";

// The ask comes in its own file, read only for a reader who has not agreed
// to the terms now published: nearly everyone agreed as they started.
const TermsAsk = dynamic(
  () => import("./TermsAsk").then((file) => file.TermsAsk),
  { loading: () => null },
);

/**
 * Asks a signed-in reader who has not agreed to the terms now published
 * (one who started before there were any, or whose consent was not kept
 * as they started) once, over the town (管理表44, けにーさん 10-26
 * 「次に開いたとき小窓で聞く」). Closed without agreeing, it asks again the
 * next time the town opens.
 */
export function TermsGate() {
  const account = useAccountState();
  const userId = account.status === "signed-in" ? account.user.id : null;
  const [asked, setAsked] = useState<{
    userId: string;
    version: string;
  } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void accountActions.termsToAgree().then((version) => {
      if (live && version) setAsked({ userId, version });
    });
    return () => {
      live = false;
    };
  }, [userId]);
  if (!asked || asked.userId !== userId) return null;
  return <TermsAsk version={asked.version} onDone={() => setAsked(null)} />;
}
