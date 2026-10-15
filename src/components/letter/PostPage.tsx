"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { afterLayerCloses, useBackLayer } from "../../lib/back-layer";
import { canGoBackInTown, subscribeTrail } from "../../lib/in-town";
import { imeKey } from "../../lib/keys";
import { letterPageOf } from "../../lib/letter";
import { lockPageScroll } from "../../lib/scroll-lock";
import {
  usePersistenceStatus,
  useTownReadCount,
  useTownReads,
} from "../../lib/store";
import { formatPostTime, repliesOf } from "../../lib/social";
import type {
  Notify,
  Post,
  Reader,
  TownActions,
  TownState,
} from "../../lib/types";
import { PostComposer } from "../Social";
import { readPost } from "../home/useArrivals";
import { Modal, ReaderAvatar } from "../ui";
import { LetterIcon } from "./icons";
import { LetterCard } from "./LetterCard";
import {
  closePost,
  focusReturn,
  postLayerName,
  usePostLayer,
  wasOpened,
} from "./post-layer";
import { useSwipeBack } from "./useSwipeBack";
import "./letter.css";

type Shared = {
  state: TownState;
  actions: TownActions;
  notify: Notify;
};

/** The address as Next compares it: path, query and hash. */
const address = () => location.pathname + location.search + location.hash;

/** Elements the keyboard moves through, in order. */
const focusables = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]',
    ),
  ).filter((element) => element.tabIndex >= 0 && element.offsetParent !== null);

/** Another layer is over the page and takes the keys: a sheet, a book, the notes. */
const layerAbove = () =>
  document.querySelector(".modal-backdrop, dialog[open], .site-notes-mode");

/**
 * A 便り's page over whatever screen opened it (決定 H:126-140): the whole
 * screen, bottom tabs included, one step of 戻る. Mounted once in TownApp.
 */
export function PostLayer(props: Shared) {
  const id = usePostLayer();
  if (!id) return null;
  return <OpenLayer key={id} {...props} postId={id} />;
}

function OpenLayer({ postId, ...props }: Shared & { postId: string }) {
  const router = useRouter();
  const shown = letterPageOf(props.state, postId);
  const root = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  // Closing puts the page beneath back where it was; leaving for another
  // page does not, as that page starts at its own top.
  const restore = useRef(true);
  // Before the page beneath is held still, so its scroll is recorded.
  const step = useBackLayer(closePost, postLayerName(postId));
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const release = lockPageScroll();
    const beneath = location.pathname + location.search;
    backButton.current?.focus({ preventScroll: true });
    return () => {
      // Gone with the page beneath (a sign-in invitation's ログインする): the
      // next page starts at its own top, and the focus is its own.
      const staying =
        restore.current && location.pathname + location.search === beneath;
      release(staying);
      if (staying) focusReturn(postId);
    };
  }, [postId]);
  // Deleted, or no longer to be seen: the page closes.
  const gone = shown === null;
  useEffect(() => {
    if (gone) closePost();
  }, [gone]);
  // Registered before the links' listener, so a drag's click is no tap.
  useSwipeBack(root, closePost);
  useEffect(() => {
    const layer = root.current;
    // A link inside leaves from the page beneath, the page kept as this
    // step's to come back to (useLayerReturn opens it again).
    const follow = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download") ||
        link.origin !== location.origin
      )
        return;
      event.preventDefault();
      const href = link.pathname + link.search + link.hash;
      // To the page already beneath (the book of a review opened on that
      // book's page, the writer's name on their profile): the page closes,
      // as 戻る would, and the page beneath stays where it was.
      if (href === address()) {
        closePost();
        return;
      }
      restore.current = false;
      stepRef.current.leave(() => router.push(href));
      closePost();
    };
    layer?.addEventListener("click", follow, true);
    return () => layer?.removeEventListener("click", follow, true);
  }, [router]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const layer = root.current;
      if (!layer || event.defaultPrevented || layerAbove()) return;
      if (event.key === "Escape") {
        // The Escape that cancels a kana conversion is the keyboard's.
        if (imeKey(event)) return;
        event.preventDefault();
        closePost();
        return;
      }
      if (event.key !== "Tab") return;
      const all = focusables(layer);
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at < 0) {
        event.preventDefault();
        (event.shiftKey ? all[all.length - 1] : all[0]).focus();
      } else if (event.shiftKey && at === 0) {
        event.preventDefault();
        all[all.length - 1].focus();
      } else if (!event.shiftKey && at === all.length - 1) {
        event.preventDefault();
        all[0].focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!shown) return null;
  const { post, author } = shown;
  return (
    <div
      ref={root}
      className="post-page is-layer"
      role="dialog"
      aria-modal="true"
      // Its own name, as the layer has no address of its own (注釈モード).
      aria-label={`${author.name}さんの便り（${formatPostTime(post.createdAt)}）`}
    >
      <PostPageHead backRef={backButton} onBack={closePost} />
      <PostPageContent {...props} post={post} author={author} scrolls />
    </div>
  );
}

/**
 * A 便り's page at its own address (/post/?id=), for links and notices from
 * outside. 戻る goes back in the town, or to the town for a page opened
 * directly.
 */
export function PostPageView({
  postId,
  ...props
}: Shared & { postId: string }) {
  const router = useRouter();
  const canGoBack = useSyncExternalStore(
    subscribeTrail,
    canGoBackInTown,
    () => false,
  );
  // Until the town is read, a post not found may yet arrive.
  const loading = usePersistenceStatus() === "loading";
  const shown = letterPageOf(props.state, postId);
  // Deleted here (by its writer, from 「…」): the page is left as 戻る leaves
  // it, or for the town when it was opened directly, once the confirm's own
  // step is off the history. The toast 「投稿を削除しました」 goes along.
  const seen = useRef(false);
  const showing = shown !== null;
  // One the town did not read (an old 便り, from a link or a notice) is
  // read by its id (PR 2), once for each reading of the town (one read
  // again after a refused change has none of it); never again once it was
  // shown and deleted here.
  const reads = useTownReads();
  const key = `${postId}:${useTownReadCount()}`;
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (showing && shownFor !== key) setShownFor(key);
  const [asked, setAsked] = useState<{
    key: string;
    state: "reading" | "read" | "failed";
  } | null>(null);
  const asking =
    !showing && !loading && reads && shownFor !== key && asked?.key !== key;
  const reading = asking || (asked?.key === key && asked.state === "reading");
  const failed = !showing && asked?.key === key && asked.state === "failed";
  useEffect(() => {
    if (!asking) return;
    setAsked({ key, state: "reading" });
    // Read or not, it is asked once: a 便り that did not come cannot be
    // opened. A read the network failed can be asked again.
    const settle = (state: "read" | "failed") => () =>
      setAsked((now) => (now?.key === key ? { key, state } : now));
    readPost(postId).then(settle("read"), settle("failed"));
  }, [asking, key, postId]);
  // Asked again: the focus waits on the page while it is read.
  const body = useRef<HTMLDivElement>(null);
  const askAgain = () => {
    body.current?.focus({ preventScroll: true });
    setAsked(null);
  };
  const gone = !showing && !loading && !reading && !failed;
  useEffect(() => {
    if (showing) seen.current = true;
    if (!gone || !seen.current) return;
    afterLayerCloses(() =>
      canGoBackInTown() ? router.back() : router.replace("/"),
    );
  }, [gone, showing, router]);
  return (
    <div className="post-page is-route">
      <PostPageHead
        page
        label={canGoBack ? "戻る" : "本の街へ"}
        onBack={() => (canGoBack ? router.back() : router.push("/"))}
      />
      <div ref={body} className="post-page-body" tabIndex={-1}>
        {shown ? (
          <PostPageContent {...props} post={shown.post} author={shown.author} />
        ) : loading || reading ? (
          <p className="post-page-none" role="status">
            便りを開いています…
          </p>
        ) : failed ? (
          <div className="post-page-missing">
            <p role="status">つながらないため、開けませんでした</p>
            <button
              type="button"
              className="button secondary"
              onClick={askAgain}
            >
              もう一度読む
            </button>
          </div>
        ) : (
          <div className="post-page-missing">
            <p>この便りは、いまは開けません</p>
            <Link href="/" className="button secondary">
              本の街へ
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function PostPageHead({
  label = "戻る",
  onBack,
  backRef,
  page = false,
}: {
  label?: string;
  onBack: () => void;
  backRef?: RefObject<HTMLButtonElement | null>;
  /** At its own address, the page's heading; in the layer, the dialog's. */
  page?: boolean;
}) {
  const Heading = page ? "h1" : "h2";
  return (
    <header className="post-page-head">
      <button
        ref={backRef}
        type="button"
        className="post-page-back"
        aria-label={label}
        onClick={onBack}
      >
        <LetterIcon name="back" size={22} />
      </button>
      <Heading>便り</Heading>
      <span />
    </header>
  );
}

function PostPageContent({
  state,
  actions,
  notify,
  post,
  author,
  scrolls = false,
}: Shared & {
  post: Post;
  author: Reader;
  /** In the layer, the page scrolls inside it; at its address, the window does. */
  scrolls?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const repliesRef = useRef<HTMLElement>(null);
  const headId = useId();
  const solo = post.readingMode === "solo";
  const replies = solo ? [] : repliesOf(state, post.id);
  const shared = { state, actions, notify };
  // Opened from behind the book page's spoiler door: shown as the door shows.
  const [revealed] = useState(() => wasOpened("door:" + post.id));
  // A reply just sent is brought into view where it landed.
  useEffect(() => {
    if (!landed) return;
    repliesRef.current
      ?.querySelector(`[data-post-id="${CSS.escape(landed)}"]`)
      ?.scrollIntoView({ block: "nearest" });
    setLanded(null);
  }, [landed]);
  const body: ReactNode = (
    <>
      <LetterCard
        {...shared}
        post={post}
        place="page"
        showBook
        revealed={revealed}
      />
      {!solo && (
        <section
          ref={repliesRef}
          className="post-page-replies"
          aria-labelledby={headId}
        >
          <h3 id={headId} className="post-page-replies-head">
            返信
          </h3>
          {replies.length ? (
            replies.map((reply) => (
              <LetterCard
                key={reply.id}
                {...shared}
                post={reply}
                place="page"
                isReply
                opAuthorId={post.authorId}
                revealed={revealed}
              />
            ))
          ) : (
            <p className="post-page-none">
              まだ返信はありません。最初のひとことを送れます。
            </p>
          )}
        </section>
      )}
    </>
  );
  return (
    <>
      {scrolls ? <div className="post-page-scroll">{body}</div> : body}
      {!solo && (
        <div className="post-page-bar">
          <button
            type="button"
            className="post-page-reply"
            // The sheet opens within the tap, so a phone's keyboard rises
            // with its text box (Modal's `writing`).
            onClick={() => flushSync(() => setReplying(true))}
          >
            <ReaderAvatar reader={state.me} size={36} />
            <span>{author.name}さんに返信</span>
          </button>
        </div>
      )}
      {replying && (
        <Modal title="返信" writing onClose={() => setReplying(false)}>
          <PostComposer
            {...shared}
            parent={post}
            sheet
            onDone={(id) => {
              setReplying(false);
              setLanded(id);
            }}
          />
        </Modal>
      )}
    </>
  );
}
