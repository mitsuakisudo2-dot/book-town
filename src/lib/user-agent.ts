// What a user agent says about the device and the browser: the barcode
// reader, 注釈モード's device label and この本について調べる ask it.

/**
 * An iPhone, iPad or iPod touch, whichever browser it runs. iPadOS asks for
 * the computer's page and presents itself as a Mac; a Mac has no touch screen.
 */
export function iosDevice(userAgent: string, touchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && touchPoints > 1)
  );
}

/**
 * The browser, such as "Safari" or "LINE"; "アプリ内" for an app's own view,
 * which on an iPhone or iPad is anything that names no browser; "" when
 * nothing tells.
 */
export function browserName(userAgent: string, ios: boolean): string {
  const ua = userAgent;
  return /\bLine\//.test(ua)
    ? "LINE"
    : /Instagram/.test(ua)
      ? "Instagram"
      : /FBAN|FBAV|FB_IAB/.test(ua)
        ? "Facebook"
        : /EdgiOS|EdgA|Edg\//.test(ua)
          ? "Edge"
          : /OPR\/|OPiOS/.test(ua)
            ? "Opera"
            : /SamsungBrowser/.test(ua)
              ? "Samsung Internet"
              : /FxiOS|Firefox\//.test(ua)
                ? "Firefox"
                : /; wv\)/.test(ua)
                  ? "アプリ内"
                  : /CriOS|Chrome\//.test(ua)
                    ? "Chrome"
                    : /Version\/[\d.]+.*Safari\//.test(ua)
                      ? "Safari"
                      : ios
                        ? "アプリ内"
                        : "";
}
