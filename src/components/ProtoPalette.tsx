"use client";

/**
 * 試作（claude/proto-colors）だけの、色を試す切り替え。6色と昼／夜を選ぶと、
 * <html> の data-palette と data-night を替え、このブラウザに残す。
 * 残した選びは PROTO_PALETTE_BOOT（src/lib/proto-palette.ts）が最初の描画の前に当てる。
 * このブランチは main に取り込まない。
 */

import { useEffect, useState } from "react";
import { PROTO_PALETTE_KEY as KEY } from "../lib/proto-palette";
import "./proto-palette.css";

export const PALETTES = [
  { value: "midori", label: "深緑", day: "#294b3e", night: "#8fc3a9" },
  { value: "ai", label: "藍", day: "#2c4566", night: "#9db8db" },
  { value: "odo", label: "黄土", day: "#7a5220", night: "#dcb070" },
  { value: "azuki", label: "あずき", day: "#7a4446", night: "#dba2a2" },
  { value: "budo", label: "葡萄", day: "#584270", night: "#bfa8db" },
  { value: "sumi", label: "墨", day: "#3e4347", night: "#c2c6c9" },
] as const;

type Choice = { p: string; n: boolean };


function apply({ p, n }: Choice) {
  const html = document.documentElement;
  if (p === "midori") html.removeAttribute("data-palette");
  else html.setAttribute("data-palette", p);
  if (n) html.setAttribute("data-night", "");
  else html.removeAttribute("data-night");
  try {
    localStorage.setItem(KEY, JSON.stringify({ p, n }));
  } catch {
    // 残せなくても、この画面では替わる
  }
}

export function ProtoPalette() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>({ p: "midori", n: false });

  useEffect(() => {
    const html = document.documentElement;
    setChoice({
      p: html.getAttribute("data-palette") ?? "midori",
      n: html.hasAttribute("data-night"),
    });
  }, []);

  const choose = (next: Choice) => {
    setChoice(next);
    apply(next);
  };

  const current = PALETTES.find((palette) => palette.value === choice.p);

  return (
    <>
      <button
        type="button"
        className="proto-palette-tab"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span
          className="proto-palette-dot"
          style={{ background: choice.n ? current?.night : current?.day }}
          aria-hidden="true"
        />
        試作の色
      </button>
      {open && (
        <div
          className="proto-palette-panel"
          role="dialog"
          aria-label="試作の色"
        >
          <div className="proto-palette-head">
            <p className="proto-palette-title">試作の色</p>
            <button
              type="button"
              className="proto-palette-close"
              onClick={() => setOpen(false)}
            >
              閉じる
            </button>
          </div>
          <div
            className="proto-palette-swatches"
            role="radiogroup"
            aria-label="色"
          >
            {PALETTES.map((palette) => (
              <button
                key={palette.value}
                type="button"
                role="radio"
                aria-checked={choice.p === palette.value}
                className="proto-palette-swatch"
                onClick={() => choose({ ...choice, p: palette.value })}
              >
                <span
                  className="proto-palette-chip"
                  style={{ background: choice.n ? palette.night : palette.day }}
                  aria-hidden="true"
                />
                {palette.label}
              </button>
            ))}
          </div>
          <div
            className="proto-palette-modes"
            role="radiogroup"
            aria-label="昼と夜"
          >
            {[
              { n: false, label: "昼" },
              { n: true, label: "夜" },
            ].map((mode) => (
              <button
                key={mode.label}
                type="button"
                role="radio"
                aria-checked={choice.n === mode.n}
                className="proto-palette-mode"
                onClick={() => choose({ ...choice, n: mode.n })}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="proto-palette-note">
            試作です。本物の街にはつながっていない、このブラウザの中だけのデモの街です。
          </p>
        </div>
      )}
    </>
  );
}
