// Someone not signed in sees no town until town_view answers, and the app
// asks it only once the page's code has come and run: about 4.7 seconds on a
// slow phone, then a round trip more (AUD-134). TOWN_AHEAD asks it from the
// page's head instead, beside the code, and the town takes that answer when
// it loads (townViewOf). A signed-in reader's town needs the reader's own
// rows too, read with the code; their Home shows its kept 便り meanwhile
// (home-snapshot.ts).

declare global {
  interface Window {
    /** town_view asked from the head: when, and its answer (none on trouble). */
    __townAhead?: { at: number; answer: Promise<unknown> };
  }
}

/** An answer older than this is not taken: the town is asked again. */
export const AHEAD_FRESH_MS = 60_000;

/**
 * The head's script: asks town_view as the app would for someone not signed
 * in, unless a session is kept on this browser (supabase-js keeps it as
 * sb-…-auth-token), a sign-in is coming back in the address, or the page
 * reads no town (ログイン, 退会).
 */
export function townAheadScript(
  url: string,
  key: string,
  args: Record<string, unknown>,
): string {
  const asked = JSON.stringify({
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return `(function(){try{if(/^\\/(login|leave)(\\/|$)/.test(location.pathname)||/[#&?](access_token|code)=/.test(location.href))return;for(var i=0;i<localStorage.length;i++)if(/^sb-.+-auth-token$/.test(localStorage.key(i)||""))return;window.__townAhead={at:performance.now(),answer:fetch(${JSON.stringify(url + "/rest/v1/rpc/town_view")},${asked}).then(function(r){return r.ok?r.json():void 0}).catch(function(){})}}catch(e){}})()`;
}

/**
 * The answer the head asked for, once: none when it asked nothing, it came
 * with trouble, or it is too old.
 */
export async function takeTownAhead(): Promise<unknown> {
  try {
    const ahead = window.__townAhead;
    if (!ahead) return undefined;
    window.__townAhead = undefined;
    const age = performance.now() - ahead.at;
    if (age < 0 || age > AHEAD_FRESH_MS) return undefined;
    return await ahead.answer;
  } catch {
    return undefined;
  }
}
