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
