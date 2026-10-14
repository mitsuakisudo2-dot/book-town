// The marks a 便り's card and page draw, from the v37 prototype (app.js):
// thin lines at 1.75, so the reply, いいね and 「…」 read as one family.

const shapes = {
  reply: <path d="M5 5.5h14v10H11l-4 3.5v-3.5H5z" />,
  like: (
    <path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z" />
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  want: <path d="M7 3.5h10v17l-5-3.8-5 3.8z" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
};

export type LetterIconName = keyof typeof shapes;

export function LetterIcon({
  name,
  size = 21,
  filled = false,
  className,
}: {
  name: LetterIconName;
  size?: number;
  /** Filled with the line's colour: a pressed いいね, a book wanted. */
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes[name]}
    </svg>
  );
}
