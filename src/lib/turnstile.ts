// 人間の確認: Cloudflare Turnstile on the login screen (management table 46,
// docs/09「毎日の控えと見張り」). Once the hosted Supabase asks for it
// (supabase/hosted-auth.json `captcha`), the login email and the passkey
// login each need a fresh answer from Turnstile, so a script cannot spend the
// hour's login emails or try passkeys from many addresses. Most readers see
// nothing: the check runs as the screen opens and asks a reader to tap only
// when Cloudflare cannot tell.
//
// The site key is public (it is in every page that shows the check); the
// secret key is a repository secret that only the auth settings workflow
// hands to Supabase.

/** The site key of the BookTown widget (public, made 2026-10-18). */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAFaNk_RZsadkkqJf";

/** The addresses the widget is made for. Elsewhere the key would be refused. */
export const TURNSTILE_HOSTS = ["booktown.page", "book-town-851k.vercel.app"];

export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * The site key to use on this host, or null for no check. A build may name
 * its own (NEXT_PUBLIC_TURNSTILE_SITE_KEY), such as Cloudflare's test keys
 * for the local Supabase; otherwise only the hosts above use the widget.
 */
export function humanCheckKey(
  hostname: string,
  override = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
): string | null {
  if (override) return override;
  if (!TURNSTILE_SITE_KEY) return null;
  return TURNSTILE_HOSTS.includes(hostname) ? TURNSTILE_SITE_KEY : null;
}

export interface TurnstileOptions {
  sitekey: string;
  action?: string;
  appearance?: "always" | "execute" | "interaction-only";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => boolean | void;
}

export interface Turnstile {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widget: string): void;
  remove(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;

/** Cloudflare's script, asked for once and only on the login screen. */
export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error("Turnstile did not start"));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Turnstile did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
