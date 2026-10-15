/**
 * 試作（claude/proto-colors）だけ: 画面の色と明るさを当てる仕組み。
 *
 * 明るさは day（昼）・lamp（灯り）・night（夜）・auto（端末に合わせる）・
 * time（時刻で替える）。time では、季節の日の出と日の入りに合わせて
 * 朝 → 昼 → 灯り →（数秒で切り替え）→ 宵 → 深夜 → 夜明け前 →（数秒で切り替え）→ 朝
 * と移る。明るい側と暗い側の中では、1分ごとに色を少しずつずらす（OKLab で混ぜる）。
 * 明るい側から暗い側へは、紙と文字の明るさが入れ替わり、途中で読めない灰色を
 * 通るので、そこだけは数秒で切り替える。
 *
 * protoEngine は、それだけで閉じた関数にしてある。PROTO_PALETTE_BOOT
 * （proto-palette.ts）がこの関数の文字を最初の描画の前に流すため、外の名前を
 * 使ってはいけない。このブランチは main に取り込まない。
 */
export function protoEngine() {
  const KEY = "proto-palette-v1";
  const PREVIEW = "proto-time-preview-v1";
  const NAMES = [
    "paper",
    "sheet",
    "ink",
    "ink-2",
    "line",
    "line-2",
    "field",
    "band",
    "notice",
    "cork",
    "forest",
    "lamp",
    "lamp-glow",
    "lamp-soft",
    "alert",
    "pop",
    "pop-line",
  ];
  // 紙・墨・線など（NAMES の順）
  const BASE: Record<string, string[]> = {
    morning: ["#f5f4ef", "#fcfcf9", "#2b2a28", "#5f5b55", "#e6e3dc", "#cfcac0", "#807a70", "#eeebe3", "#f8f5e8", "#c4a67e", "#2f5a48", "#935f17", "#e6b95f", "#f3ecdc", "#a83c2a", "#fcfbf5", "#e5e0d2"],
    day: ["#f8f3eb", "#fffcf7", "#2e2823", "#64594f", "#ebe2d6", "#d4c7b6", "#857767", "#f1e8da", "#fbf4e2", "#c9a678", "#2f5a48", "#9a6418", "#e9b75a", "#f7ecd8", "#a83c2a", "#fffaf0", "#eadfc8"],
    lamp: ["#f2e5cc", "#f8eedb", "#33251a", "#5e4a38", "#e4d2b0", "#cfb68c", "#7a6450", "#eadab9", "#f4e6c6", "#c9a678", "#2d5141", "#7f4f10", "#e9b75a", "#efdcb6", "#97321f", "#f9f0de", "#e2cfa8"],
    evening: ["#231e19", "#2c2620", "#efe4d2", "#bfae98", "#3b342c", "#50473c", "#958470", "#302a23", "#322b21", "#75603f", "#98c7ab", "#e8b263", "#cc9848", "#3e3322", "#f2967f", "#2f2922", "#4b4133"],
    night: ["#1c1a17", "#25221e", "#ece4d6", "#b8ac9c", "#36312b", "#4a433b", "#8f8372", "#2b2723", "#2d2820", "#6e5a3c", "#93c4aa", "#e3ad5f", "#c99545", "#3a3020", "#f0907a", "#2a2621", "#463e31"],
    predawn: ["#1b1d21", "#23262b", "#e6e8ec", "#aeb2ba", "#33363c", "#464a52", "#868a93", "#292c32", "#2b2d31", "#5f5a50", "#93c4aa", "#dcae6a", "#c49a55", "#33302a", "#f0907a", "#272a2f", "#41444b"],
  };
  // 色ごとの [--green, --on-green, --green-soft]。昼と朝は day、灯りは lamp、暗い側は dark。
  const ACCENT: Record<string, Record<string, string[]>> = {
    midori: { day: ["#294b3e", "#f7f4ee", "#e3ece6"], lamp: ["#294b3e", "#f7f4ee", "#e1e3cf"], dark: ["#8fc3a9", "#16241d", "#25352d"] },
    ai: { day: ["#2c4566", "#f5f6f8", "#e2e8f0"], lamp: ["#2c4566", "#f5f6f8", "#dfdcd2"], dark: ["#9db8db", "#141c28", "#232c3a"] },
    odo: { day: ["#7a5220", "#fbf6ee", "#f0e3cc"], lamp: ["#6e4818", "#fbf6ee", "#ecd8b2"], dark: ["#dcb070", "#251a0c", "#352a1b"] },
    azuki: { day: ["#7a4446", "#fbf3f2", "#f1e2e0"], lamp: ["#743f41", "#fbf3f2", "#ecd6c9"], dark: ["#dba2a2", "#271516", "#372526"] },
    budo: { day: ["#584270", "#f6f3f9", "#e9e2f0"], lamp: ["#543e6b", "#f6f3f9", "#e4d8d6"], dark: ["#bfa8db", "#1e1628", "#2e2639"] },
    sumi: { day: ["#3e4347", "#f5f5f3", "#e6e6e2"], lamp: ["#3b3f43", "#f5f5f3", "#e3dccb"], dark: ["#c2c6c9", "#1a1c1e", "#2c2e30"] },
  };
  // 日本の真ん中あたりの、月の半ばの日の出と日の入り（0時からの分、だいたい）
  const SUN = [
    [410, 1010], [390, 1040], [350, 1070], [310, 1095], [280, 1120], [265, 1140],
    [280, 1135], [305, 1110], [330, 1070], [350, 1035], [380, 995], [405, 990],
  ];

  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const toSrgb = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  const toLab = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) =>
      toLinear(parseInt(hex.slice(at, at + 2), 16) / 255),
    );
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const fromLab = ([L, A, B]: number[]) => {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return (
      "#" +
      rgb
        .map((c) =>
          Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  };
  const mix = (a: string, b: string, t: number) => {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const x = toLab(a);
    const y = toLab(b);
    return fromLab(x.map((v, i) => v + (y[i] - v) * t));
  };

  /** 名前（--なし）から色への表。anchor は BASE の名前、accent は day・lamp・dark。 */
  const tokensOf = (anchor: string, accent: string, palette: string) => {
    const out: Record<string, string> = {};
    NAMES.forEach((name, at) => (out[name] = BASE[anchor][at]));
    const [green, onGreen, soft] = (ACCENT[palette] ?? ACCENT.midori)[accent];
    out.green = green;
    out["on-green"] = onGreen;
    out["green-soft"] = soft;
    out["on-photo"] = green;
    return out;
  };
  const mixTokens = (
    a: Record<string, string>,
    b: Record<string, string>,
    t: number,
  ) => {
    const out: Record<string, string> = {};
    for (const name of Object.keys(a)) out[name] = mix(a[name], b[name], t);
    return out;
  };

  /** その日の日の出と日の入り（月の半ばの値を日でつなぐ） */
  const sunOn = (date: Date) => {
    const month = date.getMonth();
    const t = (date.getDate() - 15) / 30;
    const other = (month + (t < 0 ? 11 : 1)) % 12;
    const w = Math.abs(t);
    return [0, 1].map((i) => SUN[month][i] + (SUN[other][i] - SUN[month][i]) * w);
  };

  /** 0時からの分と、その日の日の出・日の入りから、色と、暗い側かどうか */
  const tokensAt = (minute: number, rise: number, set: number, palette: string) => {
    const lightFrom = rise - 30;
    const morningTo = rise + 120;
    const lampFrom = set - 120;
    const lampTo = set - 30;
    const darkFrom = set + 90;
    const predawnFrom = rise - 150;
    const at = (from: number, to: number) => (minute - from) / (to - from);
    if (minute >= lightFrom && minute < darkFrom) {
      const morning = tokensOf("morning", "day", palette);
      const day = tokensOf("day", "day", palette);
      const lamp = tokensOf("lamp", "lamp", palette);
      if (minute < morningTo)
        return { dark: false, tokens: mixTokens(morning, day, at(lightFrom, morningTo)) };
      if (minute < lampFrom) return { dark: false, tokens: day };
      if (minute < lampTo)
        return { dark: false, tokens: mixTokens(day, lamp, at(lampFrom, lampTo)) };
      return { dark: false, tokens: lamp };
    }
    const evening = tokensOf("evening", "dark", palette);
    const night = tokensOf("night", "dark", palette);
    const predawn = tokensOf("predawn", "dark", palette);
    if (minute >= darkFrom)
      return { dark: true, tokens: mixTokens(evening, night, at(darkFrom, 1440)) };
    if (minute < predawnFrom) return { dark: true, tokens: night };
    return { dark: true, tokens: mixTokens(night, predawn, at(predawnFrom, lightFrom)) };
  };

  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        p: (saved.p as string) || "midori",
        m: (saved.m as string) || (saved.n ? "night" : "day"),
      };
    } catch {
      return { p: "midori", m: "day" };
    }
  };
  const previewMinute = () => {
    try {
      const value = localStorage.getItem(PREVIEW);
      return value === null ? null : Number(value);
    } catch {
      return null;
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let fading = 0;
  let lastDark: boolean | null = null;
  let lastTokens: Record<string, string> | null = null;

  const paint = (tokens: Record<string, string>) => {
    const style = document.documentElement.style;
    for (const name of Object.keys(tokens))
      style.setProperty(`--${name}`, tokens[name]);
  };
  const unpaint = () => {
    const style = document.documentElement.style;
    for (const name of [...NAMES, "green", "on-green", "green-soft", "on-photo"])
      style.removeProperty(`--${name}`);
  };
  const mark = (name: string, on: boolean) => {
    const html = document.documentElement;
    if (on) html.setAttribute(name, "");
    else html.removeAttribute(name);
  };

  const apply = () => {
    const html = document.documentElement;
    const { p, m } = read();
    clearTimeout(timer);
    cancelAnimationFrame(fading);
    if (p !== "midori") html.setAttribute("data-palette", p);
    else html.removeAttribute("data-palette");
    if (m !== "time") {
      unpaint();
      lastDark = null;
      lastTokens = null;
      mark("data-timed", false);
      const dark =
        m === "night" ||
        (m === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
      mark("data-night", dark);
      mark("data-lamp", m === "lamp");
      return;
    }
    const now = new Date();
    const preview = previewMinute();
    const minute = preview ?? now.getHours() * 60 + now.getMinutes();
    const [rise, set] = sunOn(now);
    const { dark, tokens } = tokensAt(minute, rise, set, p);
    mark("data-timed", true);
    mark("data-lamp", false);
    const quiet = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (lastTokens && lastDark !== null && lastDark !== dark && !quiet) {
      // 明るい側と暗い側の入れ替わりは、数秒でふわっと
      const from = lastTokens;
      const start = performance.now();
      const step = (time: number) => {
        const t = Math.min(1, (time - start) / 2400);
        paint(mixTokens(from, tokens, t));
        if (t >= 0.5) mark("data-night", dark);
        if (t < 1) fading = requestAnimationFrame(step);
      };
      fading = requestAnimationFrame(step);
    } else {
      paint(tokens);
      mark("data-night", dark);
    }
    lastDark = dark;
    lastTokens = tokens;
    // 次の分の始まりに、もう一度
    timer = setTimeout(apply, 60000 - (Date.now() % 60000) + 50);
  };

  const start = () => {
    (window as unknown as { __protoPalette?: () => void }).__protoPalette = apply;
    apply();
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", apply);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) apply();
    });
  };

  return { start, apply, tokensAt, sunOn, tokensOf };
}
