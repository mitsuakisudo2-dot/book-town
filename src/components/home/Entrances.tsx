"use client";

import Link from "next/link";
import { Icon } from "../ui";
import { scrollToPart } from "./hooks";

/**
 * What one can do here, as four doors (決定 H:98-102): look into the shops,
 * start reading, the board, and 本を登録. A first-timer gets 本屋を開く in
 * its place. 選んでもらう waits for 選書カルテ.
 */
export function Entrances({
  newcomer,
  onRead,
  onScan,
}: {
  newcomer: boolean;
  onRead: () => void;
  onScan: () => void;
}) {
  return (
    <nav className="home-entrances" aria-label="できること">
      <button
        type="button"
        className="home-entrance is-shops"
        onClick={() => scrollToPart("home-alley")}
      >
        <span className="home-entrance-icon">
          <Icon name="store" size={26} />
        </span>
        本屋をのぞく
      </button>
      <button type="button" className="home-entrance is-read" onClick={onRead}>
        <span className="home-entrance-icon">
          <Icon name="reading" size={26} />
        </span>
        読書をはじめる
      </button>
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
      {newcomer ? (
        <Link href="/my-shop/" className="home-entrance is-open">
          <span className="home-entrance-icon">
            <Icon name="plus" size={26} />
          </span>
          本屋を開く
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
