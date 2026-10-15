/**
 * 試作（claude/proto-colors）だけ: 画面の色と明るさを当てる仕組み。
 *
 * 明るさは day（昼）・lamp（灯り）・night（夜）・auto（端末に合わせる）・
 * time（時刻で替える）。time では、その日その時の太陽の高さを計算し、空と同じに
 * 朝 → 昼 → 灯り → 夕暮れ →（数秒で切り替え）→ 宵 → 深夜 → 夜明け前 →（切り替え）→ 朝
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
    // 夕暮れ: 濃い文字のまま、紙がいちばん暗くなる所。ここで宵へ切り替わる
    dusk: ["#bea47e", "#c6ad88", "#140d07", "#2a1d12", "#ad946f", "#957c58", "#3a2c20", "#b49b75", "#bfa37a", "#937a59", "#12291f", "#3d2506", "#c79040", "#b79d74", "#4c150b", "#c9b18d", "#a98f69"],
    // 宵の始まり: 明るい文字になって、紙がいちばん明るい所
    eve: ["#4b3d2f", "#544636", "#fffaf2", "#efe2cf", "#635342", "#776653", "#c2ae95", "#574838", "#5a4935", "#3a2f23", "#c3ead4", "#ffd593", "#e0aa58", "#625037", "#ffc3b2", "#584a3a", "#736250"],
    // 夜明け: 宵の始まりと夕暮れを、青みに寄せたもの
    dawnDark: ["#3e4043", "#47494b", "#f6fbff", "#e1e4e7", "#555659", "#68696b", "#b0b2b3", "#494b4d", "#4b4c4e", "#2f3134", "#c3ead4", "#ffd593", "#bbb4a9", "#525354", "#ffc3b2", "#4b4d4f", "#646568"],
    dawnLight: ["#a8a8a6", "#b1b1af", "#0c0f12", "#1f2023", "#989896", "#81807f", "#2e2f32", "#9f9f9d", "#a8a8a5", "#7f7f7e", "#12291f", "#3d2506", "#a29b91", "#a1a19f", "#4c150b", "#b4b5b4", "#949391"],
    predawn: ["#1b1d21", "#23262b", "#e6e8ec", "#aeb2ba", "#33363c", "#464a52", "#868a93", "#292c32", "#2b2d31", "#5f5a50", "#93c4aa", "#dcae6a", "#c49a55", "#33302a", "#f0907a", "#272a2f", "#41444b"],
  };
  // 色ごとの [--green, --on-green, --green-soft]。昼と朝は day、灯りは lamp、
  // 夕暮れと夜明けの明るい側は dusk、宵の始まりと夜明けの暗い側は eve、夜は dark。
  const ACCENT: Record<string, Record<string, string[]>> = {
    midori: { day: ["#294b3e", "#f7f4ee", "#e3ece6"], lamp: ["#294b3e", "#f7f4ee", "#e1e3cf"], dusk: ["#132a21", "#f7f4ee", "#b3aa86"], eve: ["#c0e6d1", "#16241d", "#57503d"], dark: ["#8fc3a9", "#16241d", "#25352d"] },
    ai: { day: ["#2c4566", "#f5f6f8", "#e2e8f0"], lamp: ["#2c4566", "#f5f6f8", "#dfdcd2"], dusk: ["#16263d", "#f5f6f8", "#afa894"], eve: ["#cadcf3", "#141c28", "#544e41"], dark: ["#9db8db", "#141c28", "#232c3a"] },
    odo: { day: ["#7a5220", "#fbf6ee", "#f0e3cc"], lamp: ["#6e4818", "#fbf6ee", "#ecd8b2"], dusk: ["#3b2508", "#fbf6ee", "#b39a6c"], eve: ["#f3d29d", "#251a0c", "#645038"], dark: ["#dcb070", "#251a0c", "#352a1b"] },
    azuki: { day: ["#7a4446", "#fbf3f2", "#f1e2e0"], lamp: ["#743f41", "#fbf3f2", "#ecd6c9"], dusk: ["#3f1f21", "#fbf3f2", "#b69983"], eve: ["#f3caca", "#271516", "#644b3e"], dark: ["#dba2a2", "#271516", "#372526"] },
    budo: { day: ["#584270", "#f6f3f9", "#e9e2f0"], lamp: ["#543e6b", "#f6f3f9", "#e4d8d6"], dusk: ["#2f203e", "#f6f3f9", "#b0a08f"], eve: ["#dfd0f2", "#1e1628", "#5f5148"], dark: ["#bfa8db", "#1e1628", "#2e2639"] },
    sumi: { day: ["#3e4347", "#f5f5f3", "#e6e6e2"], lamp: ["#3b3f43", "#f5f5f3", "#e3dccb"], dusk: ["#1f2225", "#f5f5f3", "#aea488"], eve: ["#e0e3e5", "#1a1c1e", "#5c5343"], dark: ["#c2c6c9", "#1a1c1e", "#2c2e30"] },
  };
  // 太陽の高さを求める場所: 日本の真ん中あたり（北緯36度、東経138度）。
  // 位置情報の許可は求めない。
  const LAT = 36;
  const LON = 138;

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

  /**
   * その時の太陽の高さ（度、地平線が0）と、昇っている途中か。
   * 天文年鑑の簡単な式（誤差はおよそ1度、時刻にして数分）。
   */
  const sunAt = (date: Date) => {
    const rad = Math.PI / 180;
    const d = date.getTime() / 86400000 - 10957.5; // 2000年1月1日12時(UT)からの日
    const g = (357.529 + 0.98560028 * d) * rad;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = 18.697374558 + 24.06570982441908 * d;
    let hour = (gmst * 15 + LON - ra) % 360;
    if (hour > 180) hour -= 360;
    if (hour < -180) hour += 360;
    const altitude =
      Math.asin(
        Math.sin(LAT * rad) * Math.sin(dec) +
          Math.cos(LAT * rad) * Math.cos(dec) * Math.cos(hour * rad),
      ) / rad;
    return { altitude, rising: hour < 0 };
  };

  /**
   * 太陽の高さから、色と、暗い側かどうか。空と同じに移る。
   * 昼: 15度より上。夕方は15度から5度で灯りへ、5度から地平線の下4度で夕暮れへ。
   * 下4度（市民薄明のなかほど）で暗い側へ切り替え、宵の始まりから、下10度で宵、
   * 下18度（天文薄明の終わり）で深夜。朝はその逆を、青みのある色でたどる。
   * 夕暮れと宵の始まり、夜明け（暗）と夜明け（明）は、明るさの差がいちばん
   * 小さくなる所で、そこで切り替える。
   */
  const tokensAt = (date: Date, palette: string) => {
    const { altitude: h, rising } = sunAt(date);
    const of = (anchor: string, accent: string) => tokensOf(anchor, accent, palette);
    // 高さの区切りと色の並び（高さの低い順）を、h の所でつなぐ
    const along = (stops: [number, Record<string, string>][]) => {
      if (h <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) {
        const [to, b] = stops[i];
        if (h < to) {
          const [from, a] = stops[i - 1];
          return mixTokens(a, b, (h - from) / (to - from));
        }
      }
      return stops[stops.length - 1][1];
    };
    const FLIP = -4;
    const day = of("day", "day");
    if (h >= FLIP)
      return {
        dark: false,
        tokens: rising
          ? along([
              [FLIP, of("dawnLight", "dusk")],
              [3, of("morning", "day")],
              [15, day],
            ])
          : along([
              [FLIP, of("dusk", "dusk")],
              [5, of("lamp", "lamp")],
              [15, day],
            ]),
      };
    const night = of("night", "dark");
    return {
      dark: true,
      tokens: rising
        ? along([
            [-18, night],
            [-10, of("predawn", "dark")],
            [FLIP, of("dawnDark", "eve")],
          ])
        : along([
            [-18, night],
            [-10, of("evening", "dark")],
            [FLIP, of("eve", "eve")],
          ]),
    };
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
  let lastInput = 0;

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
    const preview = previewMinute();
    const when = new Date();
    if (preview !== null) when.setHours(Math.floor(preview / 60), preview % 60, 0, 0);
    const { dark, tokens } = tokensAt(when, p);
    mark("data-timed", true);
    mark("data-lamp", false);
    const quiet = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (lastTokens && lastDark !== null && lastDark !== dark && preview === null) {
      // 明るい側と暗い側の入れ替わりは、読んだり触ったりしている間は待ち、
      // 手が止まってから6秒でふわっと（動きを減らす設定ではすぐに）
      if (Date.now() - lastInput < 4000) {
        timer = setTimeout(apply, 2000);
        return;
      }
    }
    if (lastTokens && lastDark !== null && lastDark !== dark && !quiet) {
      const from = lastTokens;
      const start = performance.now();
      const step = (time: number) => {
        const t = Math.min(1, (time - start) / 6000);
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
    for (const type of ["pointerdown", "keydown", "wheel", "touchmove", "scroll"])
      addEventListener(type, () => (lastInput = Date.now()), {
        passive: true,
        capture: true,
      });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) apply();
    });
  };

  return { start, apply, tokensAt, sunAt, tokensOf };
}
