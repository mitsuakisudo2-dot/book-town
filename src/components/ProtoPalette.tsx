"use client";

/**
 * 試作（claude/proto-colors）だけの、画面の色の設定。プロフィールの「設定」の
 * 中に出す。6色と明るさ（昼・灯り・夜・自動・時刻で替える）を選ぶと、この
 * ブラウザに残し、src/lib/proto-time.ts の仕組みで <html> に当てる。
 * このブランチは main に取り込まない。
 */

import { useEffect, useState } from "react";
import {
  PROTO_PALETTE_KEY as KEY,
  PROTO_TIME_PREVIEW_KEY as PREVIEW,
  type ProtoMode,
} from "../lib/proto-palette";
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
  {
    value: "time",
    label: "時刻で替える",
    told: "時刻に合わせて、街の色が移ります",
  },
];

const clock = (minute: number) =>
  `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

function readPreview(): number | null {
  try {
    const value = localStorage.getItem(PREVIEW);
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

function writePreview(minute: number | null) {
  try {
    if (minute === null) localStorage.removeItem(PREVIEW);
    else localStorage.setItem(PREVIEW, String(minute));
  } catch {
    // 残せなくても、この画面では動く
  }
  window.__protoPalette?.();
}

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
  const [preview, setPreview] = useState<number | null>(null);

  useEffect(() => {
    setChoice(read());
    setNight(document.documentElement.hasAttribute("data-night"));
    setPreview(readPreview());
  }, []);

  const showAt = (minute: number | null) => {
    setPreview(minute);
    writePreview(minute);
    setNight(document.documentElement.hasAttribute("data-night"));
  };
  const now = new Date();

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
        {choice.m === "time" && (
          <div className="proto-time-preview">
            <label htmlFor="proto-time-preview">
              {preview === null
                ? `いまの時刻（${clock(now.getHours() * 60 + now.getMinutes())}）の色です。動かすと、ほかの時刻の色を見られます（試作）`
                : `${clock(preview)} の色を見ています（試作）`}
            </label>
            <input
              id="proto-time-preview"
              type="range"
              min={0}
              max={1430}
              step={10}
              value={preview ?? now.getHours() * 60 + now.getMinutes()}
              onChange={(event) => showAt(Number(event.target.value))}
            />
            {preview !== null && (
              <button type="button" onClick={() => showAt(null)}>
                いまの時刻に戻す
              </button>
            )}
          </div>
        )}
        <p className="proto-palette-note">
          試作です。本物の街にはつながっていない、このブラウザの中だけのデモの街です。
        </p>
      </fieldset>
    </>
  );
}
