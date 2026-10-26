import Link from "next/link";
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
