"use client";
import type { CSSProperties } from "react";
import {
  GROW,
  SHOP_SIZES,
  growingFrame,
  tiersFor,
  type ShopSize,
} from "../lib/growing-shop";
import type { StoreScene } from "../lib/store-scene";
import type { Book } from "../lib/types";
import { counted } from "../lib/words";
import { StoreCanvas } from "./StoreCanvas";
import "./walk.css";
import "./scene-editor.css";

export const sizeName = (size: ShopSize) =>
  size === "auto" ? GROW.auto : counted(size, "段");

/** The case drawn from its own frame, so each choice looks like the shop it
 * makes. `more` draws a faint tier below: the case still grows. */
function CaseDrawing({ tiers, more }: { tiers: number; more?: boolean }) {
  const frame = growingFrame(tiers);
  const f = frame.furniture;
  const next = more && tiers < 4 ? growingFrame(tiers + 1).furniture : null;
  const top = 0.17,
    tall = 0.66;
  const x = (v: number) => v * 90;
  const y = (v: number) => (v - top) * 160;
  return (
    <svg
      aria-hidden="true"
      className="shop-size-case"
      viewBox={`0 0 90 ${tall * 160}`}
    >
      {next && (
        <rect
          x={x(next.x)}
          y={y(next.y)}
          width={x(next.w)}
          height={y(next.y + next.h) - y(next.y)}
          rx="2"
          className="is-more"
        />
      )}
      <rect
        x={x(f.x)}
        y={y(f.y)}
        width={x(f.w)}
        height={y(f.y + f.h) - y(f.y)}
        rx="2"
      />
      {frame.rows.map((row, i) => {
        const left = f.x + row.rect.x * f.w,
          bottom = f.y + (row.rect.y + row.rect.h) * f.h,
          height = row.rect.h * f.h * 160;
        return (
          <g key={i}>
            <line x1={x(f.x)} x2={x(f.x + f.w)} y1={y(bottom)} y2={y(bottom)} />
            {[0, 1, 2, 3, 4].map((n) => (
              <rect
                key={n}
                className="is-book"
                x={x(left) + 4 + n * 9}
                y={y(bottom) - height * 0.8}
                width={n < 2 ? 7 : 4}
                height={height * 0.8}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 店の大きさ, chosen by pressing a drawing of the case, beside the shop as
 * it stands now. Choosing saves at once; the toast can take it back.
 */
export function ShopSizePicker({
  scene,
  books,
  bookCount,
  disabled,
  onChoose,
}: {
  scene: StoreScene;
  books: Book[];
  /** The books on the public shelves, for the drawing of 本に合わせる. */
  bookCount: number;
  disabled: boolean;
  onChoose: (size: ShopSize) => void;
}) {
  const style = {
    "--walk-wood": scene.theme.wood,
    "--walk-paper": scene.theme.paper,
    "--walk-light": scene.theme.light,
    "--walk-darkness": scene.background.darkness,
  } as CSSProperties;
  return (
    <section className="shop-size" aria-labelledby="shop-size-title">
      <h2 id="shop-size-title">{GROW.size}</h2>
      <div className="shop-size-stage">
        <div className="scene-preview shop-size-preview" style={style} inert>
          <div className="walk-artboard" aria-label="いまの店内">
            <StoreCanvas
              scene={scene}
              books={books}
              onBook={() => {}}
              onPop={() => {}}
              onZoom={() => {}}
              onLabel={() => {}}
            />
          </div>
        </div>
        <div className="shop-size-options" role="group" aria-label={GROW.size}>
          {SHOP_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={scene.growth === size}
              disabled={disabled}
              onClick={() => onChoose(size)}
            >
              <CaseDrawing
                tiers={
                  size === "auto" ? Math.max(1, tiersFor(bookCount)) : size
                }
                more={size === "auto"}
              />
              <span>{sizeName(size)}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="shop-size-hint">
        {scene.growth === undefined
          ? GROW.oldCase
          : scene.growth === "auto"
            ? GROW.autoHint
            : GROW.keptHint(sizeName(scene.growth))}
      </p>
    </section>
  );
}
