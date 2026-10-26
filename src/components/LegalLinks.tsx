import Link from "next/link";
import type { Ref } from "react";
import { MINIMUM_AGE } from "../lib/account";
import { loginHelpPath, privacyPath, termsPath } from "../lib/paths";
import "./account.css";

/**
 * The quiet links to the terms, the privacy page and the help, under the
 * login (管理表 44). Apart from LegalPages so the login page does not read
 * their words.
 */
export function LegalLinks({ help = false }: { help?: boolean }) {
  return (
    <nav className="legal-links" aria-label="規約と困ったとき">
      {help && <Link href={loginHelpPath()}>ログインできないとき</Link>}
      <Link href={termsPath()}>利用規約</Link>
      <Link href={privacyPath()}>プライバシー</Link>
    </nav>
  );
}

/**
 * The one box asked of everyone who starts, and of a reader from before the
 * terms (管理表44): being 13 or older, and agreeing to the terms and the
 * privacy page, which open from its words.
 */
export function AgreeToTerms({
  checked,
  onChange,
  inputRef,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <label className="account-check account-agree">
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {MINIMUM_AGE}歳以上で、<Link href={termsPath()}>利用規約</Link>と
        <span className="account-agree-end">
          <Link href={privacyPath()}>プライバシー</Link>に同意します
        </span>
      </span>
    </label>
  );
}
