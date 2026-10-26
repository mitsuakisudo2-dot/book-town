"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { FirstSteps as Steps } from "../../lib/home-feed";
import { libraryPath, myShopPath } from "../../lib/paths";
import { LIBRARY_SHELF, REGISTER } from "../../lib/words";
import { Icon } from "../ui";

/**
 * はじめの3つ (管理表 48, AUD-050・140): 本を登録, 棚を作る and 書店を開く,
 * each one tap from ホーム, a done one ticked. Gone once all three are done
 * (showsFirstSteps). No long guide: a line under each says what it is.
 */
export function FirstSteps({
  steps,
  onScan,
}: {
  steps: Steps;
  onScan: () => void;
}) {
  const step = (
    n: number,
    done: boolean,
    name: string,
    line: string,
  ): ReactNode => (
    <>
      <span className="first-step-mark" aria-hidden="true">
        {done ? <Icon name="check" size={18} /> : n}
      </span>
      <span className="first-step-words">
        <b>{name}</b>
        <small>{done ? "できました" : line}</small>
      </span>
      <Icon name="chevron" size={16} />
    </>
  );
  const at = (done: boolean) => "first-step" + (done ? " is-done" : "");
  return (
    <section className="home-first-steps" aria-labelledby="home-first-steps">
      <h2 id="home-first-steps">はじめの3つ</h2>
      <ol>
        <li>
          <button type="button" className={at(steps.book)} onClick={onScan}>
            {step(1, steps.book, REGISTER.start, REGISTER.how)}
          </button>
        </li>
        <li>
          <Link
            href={libraryPath({ makeShelf: true })}
            className={at(steps.shelf)}
          >
            {step(
              2,
              steps.shelf,
              LIBRARY_SHELF.make,
              "好きな名前で、本をまとめる",
            )}
          </Link>
        </li>
        <li>
          <Link href={myShopPath()} className={at(steps.shop)}>
            {step(3, steps.shop, "書店を開く", "本棚の本を、街に並べる")}
          </Link>
        </li>
      </ol>
    </section>
  );
}
