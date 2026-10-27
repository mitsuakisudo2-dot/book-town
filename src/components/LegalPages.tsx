"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MINIMUM_AGE } from "../lib/account";
import { NAMES, OPERATOR } from "../lib/words";
import {
  creditsPath,
  leavePath,
  loginPath,
  privacyPath,
  termsPath,
} from "../lib/paths";
import { BackLink } from "./BackLink";
import { Icon } from "./ui";
import "./account.css";
import "./text-page.css";

// The promises between the town and its readers (管理表 44): the terms, the
// privacy page and the page for a reader who cannot log in. They stand
// alone, outside the town, so they open fast from a link in an email or a
// search, and say the operator's name and address (OPERATOR) and nowhere
// else in the app (けにー 10-26 00:48Z). What they say of the data must stay
// what the code does: the tables are in tests/fixtures/account-tables.ts,
// what is sent out of the browser in docs/開発と運用/外部サービス.md.

/**
 * When these words start to apply: the day they are published (けにー 10-26
 * 02:17Z「おすすめで」; the β has no date yet). Set on the day of merging.
 */
export const TERMS_DATE = "2026年10月26日";
/**
 * The court the terms name, said by where the operator lives rather than by
 * its name, which would tell readers where that is (けにー 10-26 02:17Z).
 */
const COURT = "運営者の住所地を管轄する地方裁判所";

const service = NAMES.service;
// The commission's survey of other countries' systems (個人情報保護法 28条).
const FOREIGN_SYSTEMS = "https://www.ppc.go.jp/news/surveillance";

function TextPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="account-page">
      <Link href="/" className="account-brand">
        <Icon name="store" size={26} />
        <span>{service}</span>
      </Link>
      <article className="account-card text-page">
        <BackLink className="back-link" />
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="page-title">{title}</h1>
        {children}
      </article>
    </main>
  );
}

function Mail() {
  return <a href={`mailto:${OPERATOR.mail}`}>{OPERATOR.mail}</a>;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function TermsView() {
  return (
    <TextPage eyebrow="TERMS" title="利用規約">
      <p>
        この利用規約は、{OPERATOR.name}（以下「運営」）が提供する {service}
        （以下「本サービス」）を使うときの約束です。アカウントを作るときに、この規約と
        <Link href={privacyPath()}>プライバシーについて</Link>
        に同意していただきます。
      </p>
      <Section id="terms-1" title="第1条　本サービスについて">
        <p>
          本サービスは、本を通じて人と出会うSNSです。自分の{NAMES.shop}
          を開く、ほかの人の{NAMES.shop}
          をめぐる、本を登録して読書を記録する、{NAMES.letter}
          やPOPで本について語る、といったことができます。
        </p>
      </Section>
      <Section id="terms-2" title="第2条　使える方">
        <ol>
          <li>見るだけなら、アカウントを作らずにだれでも使えます。</li>
          <li>{`アカウントを作れるのは${MINIMUM_AGE}歳以上の方です。`}</li>
          <li>18歳未満の方は、保護者の同意を得てから使ってください。</li>
          <li>
            この規約に反して利用を止められた方は、運営の許しなくアカウントを作り直せません。
          </li>
        </ol>
      </Section>
      <Section id="terms-3" title="第3条　アカウント">
        <ol>
          <li>
            ログインには、メールアドレスに届くコードかリンク、またはパスキーを使います。
          </li>
          <li>アカウントは1人1つです。人に譲ったり貸したりできません。</li>
          <li>
            ログインに使うメールアドレスとパスキーのある端末は、ご自身で管理してください。
          </li>
          <li>
            いつでも<Link href={leavePath()}>退会</Link>
            できます。退会すると、{NAMES.shop}
            、プロフィール、{NAMES.letter}
            、読書の記録は消えます。安全のために残すものは、プライバシーについての「保管する期間」に書いています。
          </li>
        </ol>
      </Section>
      <Section id="terms-4" title="第4条　書いたものの権利">
        <ol>
          <li>
            {NAMES.shop}の看板やPOP、{NAMES.letter}
            、感想など、利用者が書いたものの著作権は、書いた人に残ります。
          </li>
          <li>
            運営は、書いたものを本サービスの中で見せるため、また書いた人が選んだ共有（ポスターなど）のために必要な範囲で、無償で使えるものとします。
          </li>
          <li>
            書いたものを本サービスの外での宣伝に使うときは、先にその人の同意を得ます。
          </li>
          <li>
            本の文章を引用するときは、著作権法の引用の範囲にしてください。
          </li>
        </ol>
      </Section>
      <Section id="terms-5" title="第5条　してはいけないこと">
        <p>
          {service}
          を、安心して本の感想を語れる場所にするため、次のことを禁止します。
        </p>
        <ol>
          <li>特定の人への攻撃、嫌がらせ、つきまとい、差別</li>
          <li>ほかの人や団体になりすますこと、複数のアカウントでの自作自演</li>
          <li>本の結末や大事な展開を、ネタバレの印を付けずに書くこと</li>
          <li>
            本の文章、表紙、ほかの人の文章などを、引用の範囲を超えて写すこと
          </li>
          <li>ほかの人の個人情報を、その人の同意なく書くこと</li>
          <li>宣伝や勧誘のための書き込み、同じ書き込みのくり返し</li>
          <li>
            本サービスの運営を妨げること（不正なアクセス、プログラムでの大量の取得など）
          </li>
          <li>法令や公の秩序に反すること</li>
        </ol>
        <p>
          ほかの人と違う解釈や感想を書くことは、禁止ではありません。歓迎します。
        </p>
      </Section>
      <Section id="terms-6" title="第6条　ブロックと通報">
        <ol>
          <li>
            ほかの利用者をブロックできます。ブロックすると、お互いの
            {NAMES.shop}や{NAMES.letter}
            が見えなくなり、フォローや反応もできなくなります。相手には知らされません。
          </li>
          <li>
            第5条に当たると思うものを見つけたら、通報してください。通報したことは相手に知らされません。
          </li>
        </ol>
      </Section>
      <Section
        id="terms-7"
        title="第7条　運営が見えなくすることと、利用を止めること"
      >
        <ol>
          <li>
            運営は、第5条に当たると判断したものを、先に知らせずに見えなくすることがあります。
          </li>
          <li>
            第5条にくり返し、または重く反した方の機能を制限したり、アカウントを止めたりすることがあります。
          </li>
          <li>納得できないときは、下の問い合わせ先へ連絡してください。</li>
        </ol>
      </Section>
      <Section id="terms-8" title="第8条　本の情報とお店へのリンク">
        <ol>
          <li>
            本の題名・著者などは、国立国会図書館と openBD
            の書誌データをもとに運営がまとめています。表紙は openBD と Google
            Books から取っています（
            <Link href={creditsPath()}>本のデータの出典</Link>
            ）。表紙の削除の依頼には、すみやかに応じます。
          </li>
          <li>
            本のページにある Amazon
            と楽天ブックスへのリンクは、そのお店で本を探すためのふつうのリンクで、運営は報酬を受け取っていません。報酬を受け取る形にするときは「PR」と表示し、先にこの規約を直します。
          </li>
          <li>
            {NAMES.shop}
            に並ぶ本やPOPは店主が自分で選んだもので、運営がお金を払って書いてもらったものではありません。
          </li>
          <li>
            お店での買い物は、そのお店との取り引きです。値段や在庫、配送はお店で確かめてください。
          </li>
        </ol>
      </Section>
      <Section id="terms-9" title="第9条　本サービスの変更と終了">
        <ol>
          <li>
            運営は、本サービスの中身を変えたり、一時的に止めたりすることがあります。
          </li>
          <li>
            本サービスを終えるときは、30日前までにお知らせし、自分の
            {NAMES.shop}と読書の記録を手元に残せるように努めます。
          </li>
        </ol>
      </Section>
      <Section id="terms-10" title="第10条　運営の責任">
        <ol>
          <li>
            運営は、本サービスを安全に使えるよう努めますが、不具合や中断が起きないことまでは約束できません。
          </li>
          <li>
            利用者どうしのもめごとは、当事者どうしで解決してください。第5条に関わるものは、運営も第7条のとおり対応します。
          </li>
          <li>
            運営に故意または重い過失があったときの損害は、この条の限りではありません。
          </li>
        </ol>
      </Section>
      <Section id="terms-11" title="第11条　規約の変更">
        <p>
          この規約を変えるときは、変える中身と日を、その日より前に本サービスの中でお知らせします。大事な変更のときは、改めて同意をお願いします。
        </p>
      </Section>
      <Section id="terms-12" title="第12条　準拠法と裁判所">
        <p>
          この規約は日本の法令に従います。本サービスについての争いは、
          {COURT}を第一審の専属的合意管轄裁判所とします。
        </p>
      </Section>
      <Section id="terms-contact" title="問い合わせ先">
        <p>
          {OPERATOR.name}　<Mail />
        </p>
      </Section>
      <p className="text-page-date">{TERMS_DATE}から</p>
    </TextPage>
  );
}

export function PrivacyView() {
  return (
    <TextPage eyebrow="PRIVACY" title="プライバシーについて">
      <p>
        {OPERATOR.name}（以下「運営」）は、{service}
        （以下「本サービス」）でお預かりする情報を、次のとおり扱います。本サービスは、広告のために利用者を追いかけることをしません。
      </p>
      <Section id="privacy-1" title="1. お預かりする情報">
        <table>
          <tbody>
            <tr>
              <th scope="row">ログイン</th>
              <td>
                メールアドレス、パスキー（端末の鍵のうち、公開してよい側だけ）
              </td>
            </tr>
            <tr>
              <th scope="row">同意と年齢</th>
              <td>
                {MINIMUM_AGE}歳以上であること、どの版の規約にいつ同意したか
              </td>
            </tr>
            <tr>
              <th scope="row">プロフィールと{NAMES.shop}</th>
              <td>
                名前、ユーザーID、自己紹介、リンク、{NAMES.shop}
                の看板・棚・並べた本・POP
              </td>
            </tr>
            <tr>
              <th scope="row">本と読書</th>
              <td>
                登録した本、読書の状態と時間、感想やメモ、読みたい本、自分で作った本棚、本との出会いの記録
              </td>
            </tr>
            <tr>
              <th scope="row">人とのやりとり</th>
              <td>
                {NAMES.letter}
                、反応、フォロー、ブロック、通報、訪れた{NAMES.shop}
              </td>
            </tr>
            <tr>
              <th scope="row">運営への声</th>
              <td>設定から送った不具合・要望、問い合わせのメール</td>
            </tr>
            <tr>
              <th scope="row">端末と接続</th>
              <td>
                IPアドレスとブラウザの種類（画面の配信とログインの記録）、画面で起きたエラーと、本の検索・登録・バーコードの読み取り・本棚の保存がうまくいったかどうかの回数（どちらも、だれのものかは残しません）
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
      <Section id="privacy-2" title="2. 使い道">
        <ol>
          <li>本サービスを動かし、ログインした人を確かめるため</li>
          <li>
            {NAMES.shop}
            めぐりなど、本や人との出会いをつくるため
          </li>
          <li>嫌がらせや不正を防ぎ、通報に対応するため</li>
          <li>
            本サービスをよくするため（利用の記録は、主に人数や回数にまとめて使います）
          </li>
          <li>お知らせと、問い合わせへの返事のため</li>
        </ol>
        <p>これ以外に使うときは、先にお知らせします。</p>
      </Section>
      <Section id="privacy-3" title="3. 見える範囲">
        <ol>
          <li>
            {NAMES.shop}、プロフィール、{NAMES.letter}
            は、ログインしていない人も含めてだれでも見られます。
          </li>
          <li>
            読書の記録は、項目ごとに見せる範囲を選べます。読書管理モードの間に作った記録は、自分だけのものです。
          </li>
          <li>
            メールアドレス、年齢、同意の記録、訪れた{NAMES.shop}
            、接続の情報は、ほかの利用者には見せません。店主に見えるのは、訪れた人の数だけです。
          </li>
        </ol>
      </Section>
      <Section id="privacy-4" title="4. ほかの人に渡すこと">
        <p>
          次の場合のほかは、本人の同意なく個人情報をほかの人に渡しません。個人情報を売ることはありません。
        </p>
        <ol>
          <li>
            法令に基づくとき（裁判所や警察からの正式な求め、発信者情報の開示の請求など）
          </li>
          <li>
            人の命や体、財産を守るために必要で、本人の同意を得るのが難しいとき
          </li>
          <li>次の「5. 任せている事業者」に、運営に要る範囲で任せるとき</li>
        </ol>
      </Section>
      <Section id="privacy-5" title="5. 任せている事業者">
        <p>
          本サービスは、次の事業者に仕事の一部を任せています。どれも日本の外の事業者です。
        </p>
        <table>
          <tbody>
            <tr>
              <th scope="row">Supabase</th>
              <td>データベース、ログイン（米国）</td>
            </tr>
            <tr>
              <th scope="row">Vercel</th>
              <td>画面の配信（米国）</td>
            </tr>
            <tr>
              <th scope="row">Resend</th>
              <td>ログインのメールを送ること（米国）</td>
            </tr>
            <tr>
              <th scope="row">Cloudflare</th>
              <td>
                ログインのときに、人が操作しているかを確かめること（米国）
              </td>
            </tr>
            <tr>
              <th scope="row">ImprovMX、Google</th>
              <td>
                問い合わせのメールを受け取り、運営のメールに届けて保管すること
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          外国の個人情報の制度は、
          <a href={FOREIGN_SYSTEMS} target="_blank" rel="noopener noreferrer">
            個人情報保護委員会の資料
          </a>
          で見られます。
        </p>
      </Section>
      <Section id="privacy-6" title="6. ブラウザから外へ送られる情報">
        <p>
          本サービスのページを開くと、ブラウザから次の送り先へ情報が送られます。送られるのは、IPアドレス、ブラウザの種類、開いたページなど、ふつうの通信に含まれるものと、下に書いたものです。
        </p>
        <table>
          <tbody>
            <tr>
              <th scope="row">Google Fonts</th>
              <td>文字の形を読み込むため</td>
            </tr>
            <tr>
              <th scope="row">openBD、Google Books</th>
              <td>本の表紙と書誌を探すため（本の ISBN や題名）</td>
            </tr>
            <tr>
              <th scope="row">Cloudflare</th>
              <td>ログインの画面で、人が操作しているかを確かめるため</td>
            </tr>
          </tbody>
        </table>
        <p>
          広告や、外の会社のアクセス解析は置いていません。ブラウザには、ログインの状態と、書きかけなどを残すためのデータを保存します。
        </p>
      </Section>
      <Section id="privacy-7" title="7. 保管する期間">
        <ol>
          <li>
            退会すると、プロフィール、{NAMES.shop}、{NAMES.letter}
            、読書の記録、メールアドレスは消えます。
          </li>
          <li>
            あなたについての通報と、運営が見えなくした記録は、安全のために退会のあとも残します。
          </li>
          <li>
            自分で打ち込んだ本の題名や著者は、だれが入れたかを外して、本の情報として残ることがあります。
          </li>
          <li>
            送った不具合・要望は180日、画面で起きたエラーは30日、うまくいったかどうかの回数は90日、ライブラリの出し入れの記録は1年で消します。
          </li>
          <li>
            配信、ログイン、メールの事業者の記録は、それぞれの事業者の決めた期間残ります。
          </li>
        </ol>
      </Section>
      <Section id="privacy-8" title="8. 安全のためにしていること">
        <ol>
          <li>通信はすべて暗号化しています。</li>
          <li>
            データは、本人と、本人が選んだ範囲の人だけが読めるように、データベースの決まりで守っています。
          </li>
          <li>
            運営が見せていない情報を見るのは、通報への対応や不具合の調べなど、必要なときだけです。
          </li>
          <li>
            もし情報がもれたときは、法令に従って個人情報保護委員会に報告し、関係する方にお知らせします。
          </li>
        </ol>
      </Section>
      <Section
        id="privacy-9"
        title="9. 見せてほしい・直してほしい・消してほしいとき"
      >
        <p>
          自分の情報を見せてほしい、直してほしい、使うのをやめてほしい、消してほしいときは、下の問い合わせ先へ連絡してください。本人であることを確かめてから、法令に従って対応します。プロフィールや読書の記録の多くは、自分で直したり消したりできます。
        </p>
      </Section>
      <Section id="privacy-10" title="10. 18歳未満の方">
        <p>18歳未満の方は、保護者の同意を得てから使ってください。</p>
      </Section>
      <Section id="privacy-11" title="11. この内容の変更">
        <p>
          変えるときは、変える中身と日を、その日より前に本サービスの中でお知らせします。使い道を広げるときは、改めて同意をお願いします。
        </p>
      </Section>
      <Section id="privacy-contact" title="12. 運営と問い合わせ先">
        <p>
          {OPERATOR.name}（個人で運営しています）　
          <Mail />
        </p>
        <p>運営者の名前と住所は、求めがあれば、すみやかにお答えします。</p>
      </Section>
      <p className="text-page-date">{TERMS_DATE}から</p>
    </TextPage>
  );
}

export function LoginHelpView() {
  return (
    <TextPage eyebrow="HELP" title="ログインできないとき">
      <Section id="help-mail" title="ログインのメールが届かない">
        <ol>
          <li>
            迷惑メールのフォルダを見てください。メールは {OPERATOR.loginMail}
            から届きます。
          </li>
          <li>
            届くまで数分かかることがあります。続けて何度も頼むと、しばらく送れなくなります。少し待ってから
            <Link href={loginPath()}>ログインの画面</Link>
            でもう一度頼んでください。
          </li>
          <li>メールアドレスの打ちまちがいがないか、確かめてください。</li>
        </ol>
      </Section>
      <Section id="help-passkey" title="メールが読めなくなった">
        <p>
          前にパスキーを作っていれば、ログインの画面の［パスキーでログイン］から入れます。入ったら、設定でログインのメールアドレスを変えられます。
        </p>
        <p>
          パスキーもないときは、運営がメールアドレスを差し替えます。次のことを書いて、
          <Mail /> へ送ってください。
        </p>
        <ol>
          <li>前に使っていたメールアドレス</li>
          <li>名前とユーザーID</li>
          <li>
            新しく使いたいメールアドレス（このメールを送るアドレスで構いません）
          </li>
        </ol>
        <p>
          本人であることを確かめるために、{NAMES.shop}
          やライブラリのことをいくつか聞くことがあります。パスワードやログインのコードは聞きません。メールに書かないでください。
        </p>
      </Section>
      <Section id="help-other" title="そのほか">
        <p>
          ほかに困ったことも、
          <Mail /> へどうぞ。{OPERATOR.name}
          は個人で運営しているので、返事に数日かかることがあります。
        </p>
        <p>
          <Link href={termsPath()}>利用規約</Link>・
          <Link href={privacyPath()}>プライバシーについて</Link>
        </p>
      </Section>
    </TextPage>
  );
}
