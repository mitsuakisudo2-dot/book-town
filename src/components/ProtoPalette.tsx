"use client";

/**
 * 試作（claude/proto-colors）だけの、画面の色の設定。プロフィールの「設定」の
 * 中に出す。6色と昼／夜を選ぶと、<html> の data-palette と data-night を替え、
 * このブラウザに残す。残した選びは PROTO_PALETTE_BOOT（src/lib/proto-palette.ts）
 * が最初の描画の前に当てる。このブランチは main に取り込まない。
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

export function ProtoPaletteSettings({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [choice, setChoice] = useState<Choice>({ p: "midori", n: false });

  useEffect(() => {
    const html = document.documentElement;
    setChoice({
      p: html.getAttribute("data-palette") ?? "midori",
      n: html.hasAttribute("data-night"),
    });
  }, []);

  const choose = (next: Choice, told: string) => {
    setChoice(next);
    apply(next);
    notify(told);
  };

  return (
    <>
      <fieldset className="record-visibility proto-palette-choices">
        <legend>画面の色（試作）</legend>
        {PALETTES.map((palette) => (
          <label key={palette.value}>
            <input
              type="radio"
              name="proto-palette"
              checked={choice.p === palette.value}
              onChange={() =>
                choose(
                  { ...choice, p: palette.value },
                  `画面の色を${palette.label}にしました`,
                )
              }
            />
            <span
              className="proto-palette-chip"
              style={{ background: choice.n ? palette.night : palette.day }}
              aria-hidden="true"
            />
            {palette.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="record-visibility">
        <legend>昼と夜（試作）</legend>
        {[
          { n: false, label: "昼" },
          { n: true, label: "夜" },
        ].map((mode) => (
          <label key={mode.label}>
            <input
              type="radio"
              name="proto-night"
              checked={choice.n === mode.n}
              onChange={() =>
                choose({ ...choice, n: mode.n }, `${mode.label}の色にしました`)
              }
            />
            {mode.label}
          </label>
        ))}
        <p className="proto-palette-note">
          試作です。本物の街にはつながっていない、このブラウザの中だけのデモの街です。
        </p>
      </fieldset>
    </>
  );
}
