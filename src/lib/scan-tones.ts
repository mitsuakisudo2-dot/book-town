"use client";

import { useSyncExternalStore } from "react";

// 読み取りの音 (114 本を登録する瞬間, けにーさん 2026-10-23): what the scanner
// plays when a book is read. コトッ (the one けにーさん made in 登録の音くらべ:
// 高さ1・長さ1・間10・硬さ1) comes first; 設定 offers a few more and 音なし,
// and plays each as it is picked. The scanner's ♪ stays an on/off switch and
// is the same thing as 音なし. Both are kept on this device only.

export const TONES = [
  { id: "kotto", name: "コトッ" },
  { id: "wood", name: "木の音と響き" },
  { id: "pluck", name: "弾く音" },
  { id: "pip", name: "ピッ" },
] as const;

export type Tone = (typeof TONES)[number]["id"];

/** A tone, or 音なし. */
export type ToneChoice = Tone | "off";

/** 設定's choices: the tones, then 音なし. */
export const TONE_CHOICES: readonly { id: ToneChoice; name: string }[] = [
  ...TONES,
  { id: "off", name: "音なし" },
];

export const FIRST_TONE: Tone = "kotto";

/** 音なし is "off" here, as the scanner's ♪ has always kept it. */
export const SOUND_KEY = "book-town-scan-sound";
export const TONE_KEY = "book-town-scan-tone";

const isTone = (value: unknown): value is Tone =>
  TONES.some((tone) => tone.id === value);

/** The choice kept on this device: コトッ when none (or none readable) is kept. */
export function toneOf(sound: string | null, tone: string | null): ToneChoice {
  if (sound === "off") return "off";
  return isTone(tone) ? tone : FIRST_TONE;
}

/** Chosen on this page, for a browser that refuses storage. */
let chosenHere: ToneChoice | null = null;

function read(): ToneChoice {
  try {
    return toneOf(
      localStorage.getItem(SOUND_KEY),
      localStorage.getItem(TONE_KEY),
    );
  } catch {
    return chosenHere ?? FIRST_TONE;
  }
}

/** The tone last chosen, for ♪ to turn back on (音なし keeps it). */
function lastTone(): Tone {
  try {
    const kept = localStorage.getItem(TONE_KEY);
    return isTone(kept) ? kept : FIRST_TONE;
  } catch {
    return chosenHere && chosenHere !== "off" ? chosenHere : FIRST_TONE;
  }
}

const listeners = new Set<() => void>();

export function chooseTone(choice: ToneChoice) {
  chosenHere = choice;
  try {
    if (choice === "off") localStorage.setItem(SOUND_KEY, "off");
    else {
      localStorage.removeItem(SOUND_KEY);
      localStorage.setItem(TONE_KEY, choice);
    }
  } catch {
    // Kept for this page only.
  }
  listeners.forEach((listener) => listener());
}

/** ♪ in the scanner: 音なし, or back to the tone last chosen. */
export const setSoundOn = (on: boolean) => chooseTone(on ? lastTone() : "off");

const subscribe = (changed: () => void) => {
  listeners.add(changed);
  // Another tab's 設定.
  const stored = (event: StorageEvent) => {
    if (event.key === SOUND_KEY || event.key === TONE_KEY) changed();
  };
  window.addEventListener("storage", stored);
  return () => {
    listeners.delete(changed);
    window.removeEventListener("storage", stored);
  };
};

/** The choice, kept in step with 設定 and ♪. */
export const useToneChoice = (): ToneChoice =>
  useSyncExternalStore(subscribe, read, () => FIRST_TONE);

/** What the sound says: a book taken in, nothing new, or a 段 of the shelf filled. */
export type Moment = "in" | "nothing-new" | "row";

let shared: AudioContext | null = null;

/**
 * The one AudioContext of the page. Phones start sound only from a tap, so
 * a tap calls this first (and so does the first sound).
 */
export function wakeAudio(): AudioContext | null {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return null;
    shared ??= new Context();
    if (shared.state === "suspended") void shared.resume().catch(() => {});
    return shared;
  } catch {
    return null;
  }
}

/** A little different each time, so fifty books in a row don't tire the ear. */
const sway = (width: number) => 1 + (Math.random() - 0.5) * width;

/** From near silence and back, so it never clicks. */
function envelope(
  gain: GainNode,
  start: number,
  peak: number,
  rise: number,
  length: number,
) {
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + rise);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
}

function sine(
  audio: AudioContext,
  to: AudioNode,
  hz: number,
  after: number,
  length: number,
  peak: number,
) {
  const start = audio.currentTime + after;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = hz;
  envelope(gain, start, peak, 0.01, length);
  oscillator.connect(gain).connect(to);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

/**
 * One small wooden tap (登録の音くらべ's コトッ): a breath of noise rung
 * through a narrow band, the wood, and a quick falling sine, its body.
 * けにーさん's 高さ1・長さ1・硬さ1 are 320 Hz, 28 ms and a band of Q 4.
 */
function tap(audio: AudioContext, hz: number, after: number, loud: number) {
  const start = audio.currentTime + after;
  const length = 0.028;
  const noise = audio.createBuffer(
    1,
    Math.ceil(audio.sampleRate * length),
    audio.sampleRate,
  );
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const source = audio.createBufferSource();
  const band = audio.createBiquadFilter();
  const wood = audio.createGain();
  source.buffer = noise;
  band.type = "bandpass";
  band.frequency.value = hz * 2.2;
  band.Q.value = 4;
  wood.gain.value = 0.21 * loud;
  source.connect(band).connect(wood).connect(audio.destination);
  source.start(start);
  const oscillator = audio.createOscillator();
  const body = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(hz, start);
  oscillator.frequency.exponentialRampToValueAtTime(hz * 0.85, start + length);
  envelope(body, start, 0.5 * loud, 0.002, length);
  oscillator.connect(body).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

let room: ConvolverNode | null = null;

/** A short, quiet room, as in a small bookshop. */
function roomOf(audio: AudioContext): ConvolverNode {
  if (room && room.context === audio) return room;
  const length = Math.floor(audio.sampleRate * 0.6);
  const impulse = audio.createBuffer(2, length, audio.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
  }
  const convolver = audio.createConvolver();
  const wet = audio.createGain();
  convolver.buffer = impulse;
  wet.gain.value = 0.22;
  convolver.connect(wet).connect(audio.destination);
  room = convolver;
  return convolver;
}

/** A wooden bar, as a marimba's: the note, a fast-dying partial, a soft thump. */
function bar(
  audio: AudioContext,
  hz: number,
  after: number,
  loud: number,
  partials: readonly (readonly [number, number, number])[],
) {
  const start = audio.currentTime + after;
  const out = audio.createGain();
  out.gain.value = loud;
  out.connect(audio.destination);
  out.connect(roomOf(audio));
  for (const [times, peak, length] of partials) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = hz * times;
    envelope(gain, start, peak, 0.003, length);
    oscillator.connect(gain).connect(out);
    oscillator.start(start);
    oscillator.stop(start + length + 0.03);
  }
}

const WOOD = [
  [1, 0.5, 0.32],
  [3.9, 0.12, 0.06],
  [9.2, 0.03, 0.02],
] as const;
const PLUCK = [
  [1, 0.45, 0.9],
  [2.01, 0.12, 0.35],
  [5.4, 0.04, 0.08],
] as const;
/** 弾く音 climbs a step each book, over ten. */
const PLUCK_STEPS = [
  293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5,
];
/** A 段 filled: three soft notes going up, after the book's own sound. */
const ROW_CHORD = [261.63, 329.63, 392];

/**
 * Plays `tone` for `moment`. `nth` is this time's count of books, for the
 * tones that move with it. Nothing on a device without sound.
 */
export function playTone(tone: Tone, moment: Moment, nth = 1) {
  const audio = wakeAudio();
  if (!audio) return;
  if (moment === "nothing-new") {
    // One sound for it whatever the tone, and nothing like wood (けにーさん
    // 10-24「重複時は違う音の方がいい」: コトッ played lower was heard as the
    // same): two soft round notes going down, "already in", not a buzzer.
    sine(audio, audio.destination, 587.33, 0, 0.11, 0.22);
    sine(audio, audio.destination, 440, 0.13, 0.16, 0.22);
    return;
  }
  const pitch = sway(0.06);
  const loud = 0.9 + Math.random() * 0.15;
  if (tone === "kotto") {
    tap(audio, 320 * pitch, 0, 0.45 * loud);
    tap(audio, 320 * pitch, 0.14, loud);
  } else if (tone === "wood") {
    bar(audio, 392 * pitch, 0, 0.45 * loud, WOOD);
    bar(audio, 261.63 * pitch, 0.09, 0.8 * loud, WOOD);
  } else if (tone === "pluck")
    bar(audio, PLUCK_STEPS[(nth - 1) % PLUCK_STEPS.length], 0, 0.8, PLUCK);
  else sine(audio, audio.destination, 1046.5, 0, 0.08, 0.18);
  if (moment !== "row") return;
  ROW_CHORD.forEach((hz, i) => {
    if (tone === "pip")
      sine(audio, audio.destination, hz * 2, 0.3 + i * 0.09, 0.3, 0.08);
    else bar(audio, hz, 0.3 + i * 0.09, 0.35, WOOD);
  });
}
