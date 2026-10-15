"use client";

/**
 * 試作（claude/proto-colors）だけの、画面の色の設定。プロフィールの「設定」の
 * 中に出す。6色と明るさ（昼・灯り・夜・自動）を選ぶと、このブラウザに残し、
 * PROTO_PALETTE_BOOT（src/lib/proto-palette.ts）と同じ手で <html> に当てる。
 * このブランチは main に取り込まない。
 */

import { useEffect, useState } from "react";
import { PROTO_PALETTE_KEY as KEY, type ProtoMode } from "../lib/proto-palette";
import "./proto-palette.css";

export const PALETTES = [
  { value: "midori", label: "深緑", day: "#294b3e", night: "#8fc3a9" },
  { value: "ai", label: "藍", day: "#2c4566", night: "#9db8db" },
  { value: "odo", label: "黄土", day: "#7a5220", night: "#dcb070" },
  { value: "azuki", label: "あずき", day: "#7a4446", night: "#dba2a2" },
  { value: "budo", label: "葡萄", day: "#584270", night: "#bfa8db" },
  { value: "sumi", label: "墨", day: "#3e4347", night: "#c2c6c9" },
] as const;

type Choice = { p: string; m: ProtoMode };

const MODES: { value: ProtoMode; label: string; told: string }[] = [
  { value: "day", label: "昼", told: "昼の色にしました" },
  { value: "lamp", label: "灯り", told: "灯りの色にしました" },
  { value: "night", label: "夜", told: "夜の色にしました" },
  {
    value: "auto",
    label: "自動（端末に合わせる）",
    told: "端末の明るさの設定に合わせます",
  },
];

declare global {
  interface Window {
    __protoPalette?: () => void;
  }
}

function read(): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      p: saved.p ?? "midori",
      m: saved.m ?? (saved.n ? "night" : "day"),
    };
  } catch {
    return { p: "midori", m: "day" };
  }
}

function apply(choice: Choice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // 残せなければ、この画面でも替えられない（試作）
  }
  window.__protoPalette?.();
}

export function ProtoPaletteSettings({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [choice, setChoice] = useState<Choice>({ p: "midori", m: "day" });
  const [night, setNight] = useState(false);

  useEffect(() => {
    setChoice(read());
    setNight(document.documentElement.hasAttribute("data-night"));
  }, []);

  const choose = (next: Choice, told: string) => {
    setChoice(next);
    apply(next);
    setNight(document.documentElement.hasAttribute("data-night"));
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
              style={{ background: night ? palette.night : palette.day }}
              aria-hidden="true"
            />
            {palette.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="record-visibility">
        <legend>明るさ（試作）</legend>
        {MODES.map((mode) => (
          <label key={mode.value}>
            <input
              type="radio"
              name="proto-mode"
              checked={choice.m === mode.value}
              onChange={() => choose({ ...choice, m: mode.value }, mode.told)}
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
