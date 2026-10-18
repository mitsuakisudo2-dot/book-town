"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Icon } from "../ui";
import { scrollToPart } from "./hooks";
import { myShopPath } from "../../lib/paths";

/** A door still on its way: its shape, saying nothing and doing nothing. */
const Waiting = () => (
  <span className="home-entrance is-waiting" aria-hidden="true">
    <span className="home-entrance-icon" />
  </span>
);

/**
 * On a short phone, the doors lie under the 投稿 button when Home opens
 * (通し確認 2026-10-16): while they do, the button steps aside
 * (`data-fab-aside` on <html>, social.css), and it is back as soon as the
 * page moves them up from under it.
 */
function useFabAside() {
  const doors = useRef<HTMLElement>(null);
  useEffect(() => {
    const html = document.documentElement;
    let frame = 0;
    const check = () => {
      frame = 0;
      const fab = document.querySelector(".compose-fab");
      const at = doors.current?.getBoundingClientRect();
      // Where the button stands; while it is aside, where it stood.
      const stand = fab?.getBoundingClientRect();
      const under =
        !!at &&
        !!stand &&
        stand.height > 0 &&
        at.bottom > stand.top - 8 &&
        at.top < stand.bottom;
      if (under) html.dataset.fabAside = "";
      else delete html.dataset.fabAside;
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    addEventListener("scroll", soon, { passive: true });
    addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", soon);
      removeEventListener("resize", soon);
      delete html.dataset.fabAside;
    };
  }, []);
  return doors;
}

/**
 * What one can do here, as four doors (決定 H:98-102): look into the shops,
 * start reading, the board, and 本を登録. A first-timer gets 書店を開く in
 * its place. 選んでもらう waits for 選書カルテ. Until the town is read
 * (`newcomer` null), the two that depend on it wait as shapes: who the
 * reader is decides the fourth, and the board is not on the page yet.
 */
export function Entrances({
  newcomer,
  onRead,
  onScan,
}: {
  newcomer: boolean | null;
  onRead: () => void;
  onScan: () => void;
}) {
  const doors = useFabAside();
  return (
    <nav ref={doors} className="home-entrances" aria-label="できること">
      <button
        type="button"
        className="home-entrance is-shops"
        onClick={() => scrollToPart("home-alley")}
      >
        <span className="home-entrance-icon">
          <Icon name="store" size={26} />
        </span>
        書店をのぞく
      </button>
      <button type="button" className="home-entrance is-read" onClick={onRead}>
        <span className="home-entrance-icon">
          <Icon name="reading" size={26} />
        </span>
        読書をはじめる
      </button>
      {newcomer === null ? (
        <Waiting />
      ) : (
        <button
          type="button"
          className="home-entrance is-board"
          onClick={() => scrollToPart("home-board")}
        >
          <span className="home-entrance-icon">
            <Icon name="pin" size={26} />
          </span>
          掲示板
        </button>
      )}
      {newcomer === null ? (
        <Waiting />
      ) : newcomer ? (
        <Link href={myShopPath()} className="home-entrance is-open">
          <span className="home-entrance-icon">
            <Icon name="plus" size={26} />
          </span>
          書店を開く
        </Link>
      ) : (
        <button
          type="button"
          className="home-entrance is-scan"
          onClick={onScan}
        >
          <span className="home-entrance-icon">
            <Icon name="barcode" size={26} />
          </span>
          本を登録
        </button>
      )}
    </nav>
  );
}
