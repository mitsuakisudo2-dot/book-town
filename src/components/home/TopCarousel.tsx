"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
} from "react";
import Link from "next/link";
import {
  type Book,
  type Reader,
  type Shop,
  type TownState,
} from "../../lib/types";
import { posterTitle, type Poster } from "../../lib/posters";
import { posterPath, walkPath } from "../../lib/paths";
import { isSampleId } from "../../lib/record-kind";
import { BookJacket, Icon } from "../ui";
import { PosterThumb } from "../PosterView";
import { SampleTag } from "./FeatureBand";

/** The slides of 「今日の街」 (決定 H:94-97). */
export type Slide =
  | { kind: "welcome" }
  | { kind: "tonight"; shop: Shop; owner?: Reader; covers: Book[] }
  | { kind: "exhibition"; poster: Poster; maker?: Reader };

/** Every this long, the next slide; the turn itself glides this long. */
const TURN_EVERY = 10_000;
const GLIDE = 1100;

/**
 * The slides' art, cut from the woodshop's room (public/home, ASSETS.md):
 * the first slide always has the shelves, so the static page can ask for it
 * first, whatever the slide turns out to be (仮).
 */
const ART = ["shelves", "lamp"] as const;

function Art({ index }: { index: number }) {
  const name = ART[index % ART.length];
  const at = (width: number) => `/home/${name}-${width}-v1.webp`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="home-slide-art"
      src={at(390)}
      srcSet={`${at(390)} 390w, ${at(780)} 780w, ${at(1170)} 1170w`}
      sizes="(min-width: 761px) 600px, 100vw"
      width={390}
      height={244}
      alt=""
      decoding="async"
      loading={index === 0 ? "eager" : "lazy"}
      fetchPriority={index === 0 ? "high" : undefined}
    />
  );
}

const reducedMotion = "(prefers-reduced-motion: reduce)";
/** Whether the reader asked for less motion; on the server, as if they had. */
function useStill(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = matchMedia(reducedMotion);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => matchMedia(reducedMotion).matches,
    () => true,
  );
}

/** Where slide `index` sits in the track's scroll. */
function slideLeft(track: HTMLElement, index: number): number {
  const slide = track.children[index] as HTMLElement | undefined;
  if (!slide) return 0;
  return slide.offsetLeft - parseFloat(getComputedStyle(track).paddingLeft);
}

/** The slide nearest to the track's scroll. */
function slideAt(track: HTMLElement): number {
  let best = 0;
  for (let index = 1; index < track.children.length; index += 1)
    if (
      Math.abs(slideLeft(track, index) - track.scrollLeft) <
      Math.abs(slideLeft(track, best) - track.scrollLeft)
    )
      best = index;
  return best;
}

/**
 * 「今日の街」: a few slides the finger pages through (one per snap), which
 * also turn by themselves every ten seconds, gliding over about a second.
 * Any touch, wheel or press on them stops that for good; focus or the mouse
 * inside holds it. The button beside the dots stops and starts it again. One
 * slide turns nothing, and less motion turns nothing (APG carousel).
 */
export function TopCarousel({
  slides,
  state,
}: {
  /** Null while the town is on its way: the first art, and nothing said. */
  slides: Slide[] | null;
  state: TownState;
}) {
  const track = useRef<HTMLDivElement>(null);
  const still = useStill();
  const [at, setAt] = useState(0);
  const [stopped, setStopped] = useState(false);
  // Focus and the mouse each hold it, apart: the mouse leaving does not let
  // it turn while the focus is still inside, nor the reverse. Only a mouse
  // hovers: a finger's tap leaves no hover behind it.
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const stoppedRef = useRef(false);
  const count = slides?.length ?? 0;
  const turns = count > 1 && !still;
  const auto = turns && !stopped && !focused && !hovered;
  const stop = (now: boolean) => {
    stoppedRef.current = now;
    setStopped(now);
  };
  useEffect(() => {
    const box = track.current;
    if (!auto || !box) return;
    let gliding = 0;
    const timer = setInterval(() => {
      const from = box.scrollLeft;
      const to = slideLeft(box, (slideAt(box) + 1) % box.children.length);
      const started = performance.now();
      box.style.scrollSnapType = "none";
      const step = (time: number) => {
        if (stoppedRef.current) {
          box.style.scrollSnapType = "";
          return;
        }
        const done = Math.min(1, Math.max(0, (time - started) / GLIDE));
        const eased =
          done < 0.5 ? 4 * done ** 3 : 1 - Math.pow(-2 * done + 2, 3) / 2;
        box.scrollLeft = from + (to - from) * eased;
        if (done < 1) gliding = requestAnimationFrame(step);
        else box.style.scrollSnapType = "";
      };
      gliding = requestAnimationFrame(step);
    }, TURN_EVERY);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(gliding);
      box.style.scrollSnapType = "";
    };
  }, [auto]);
  if (slides && !count) return null;
  const leave = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setFocused(false);
  };
  return (
    <section
      className={"home-carousel" + (slides ? "" : " is-loading")}
      aria-roledescription="カルーセル"
      aria-label="今日の街"
      aria-busy={slides ? undefined : true}
      onFocus={() => setFocused(true)}
      onBlur={leave}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setHovered(false);
      }}
    >
      <div
        ref={track}
        className="home-carousel-track"
        aria-live={auto ? "off" : "polite"}
        onScroll={(event) => setAt(slideAt(event.currentTarget))}
        // A finger, the wheel or a press on the slides: they stop turning.
        onTouchStart={() => stop(true)}
        onWheel={() => stop(true)}
        onPointerDown={() => stop(true)}
      >
        {slides ? (
          slides.map((slide, index) => (
            <div
              key={slide.kind}
              className={"home-slide is-" + slide.kind}
              role="group"
              aria-roledescription="スライド"
              aria-label={`${index + 1} / ${count}`}
            >
              <Art index={index} />
              <SlideBody slide={slide} state={state} />
            </div>
          ))
        ) : (
          <div className="home-slide">
            <Art index={0} />
          </div>
        )}
      </div>
      {count > 1 && (
        <div className="home-carousel-nav">
          <span className="home-carousel-dots" aria-hidden="true">
            {slides!.map((slide, index) => (
              <span key={slide.kind} className={index === at ? "is-on" : ""} />
            ))}
          </span>
          {turns && (
            <button
              type="button"
              className="home-carousel-pause"
              aria-label={
                stopped ? "自動の切り替えを再開する" : "自動の切り替えを止める"
              }
              onClick={() => stop(!stopped)}
            >
              <Icon name={stopped ? "play" : "pause"} size={18} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function SlideBody({ slide, state }: { slide: Slide; state: TownState }) {
  switch (slide.kind) {
    case "welcome":
      return (
        <>
          <div className="home-slide-text">
            <p className="home-slide-title">
              本棚をのぞくと、
              <br />
              人に出会う。
            </p>
            <p className="home-slide-meta">
              本好きが一人ずつ小さな本屋を開いている街です。登録しなくても見られます。
            </p>
          </div>
          <Link href="/walk/" className="home-slide-go">
            歩いてみる
            <Icon name="chevron" size={18} />
          </Link>
        </>
      );
    case "tonight":
      return (
        <>
          <div className="home-slide-show" aria-hidden="true">
            {slide.covers.map((book) => (
              <span key={book.id} className="home-slide-book">
                <BookJacket book={book} sizes="44px" />
              </span>
            ))}
          </div>
          <div className="home-slide-text">
            <span className="home-slide-label">今夜の一軒</span>
            <p className="home-slide-title">{slide.shop.name}</p>
            <p className="home-slide-meta">
              {slide.owner && `店主 ${slide.owner.name}`}
              {isSampleId(slide.shop.id) && <SampleTag />}
            </p>
          </div>
          <Link
            href={walkPath(slide.shop.id)}
            className="home-slide-go"
            aria-label={`今夜の一軒「${slide.shop.name}」に入る`}
          >
            入る
            <Icon name="chevron" size={18} />
          </Link>
        </>
      );
    case "exhibition":
      return (
        <>
          {/* The poster is shown, not a second way in: 見に行く is the one. */}
          <div className="home-slide-show is-poster" aria-hidden="true" inert>
            <PosterThumb
              poster={slide.poster}
              books={state.books}
              href={posterPath(slide.poster.id)}
            />
          </div>
          <div className="home-slide-text">
            <span className="home-slide-label">企画展</span>
            <p className="home-slide-title">
              {posterTitle(slide.poster, state.books)}
            </p>
            <p className="home-slide-meta">
              {slide.maker && `${slide.maker.name}さんのポスター`}
              {isSampleId(slide.poster.authorId) && <SampleTag />}
            </p>
          </div>
          <Link
            href={posterPath(slide.poster.id)}
            className="home-slide-go"
            aria-label={
              "企画展「" +
              posterTitle(slide.poster, state.books) +
              "」を見に行く"
            }
          >
            見に行く
            <Icon name="chevron" size={18} />
          </Link>
        </>
      );
  }
}
