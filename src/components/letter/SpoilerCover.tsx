import { LetterIcon } from "./icons";
import { quote } from "../../lib/book-name";

/**
 * A spoiler, covered: the whole box is one button, and a tap anywhere opens
 * it. The covered words are not on the page until then (a blur over the
 * real text would still give them to a selection or a screen reader), so
 * the box draws bars about as tall as the words would be.
 */
export function SpoilerCover({
  words,
  title,
  bars,
  onOpen,
}: {
  /** What kind of spoiler, ending in 「押すと表示」. */
  words: string;
  /** The book it is about, so the button says which. */
  title?: string;
  bars: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="letter-spoiler"
      aria-expanded={false}
      onClick={onOpen}
    >
      <span className="letter-spoiler-bars" aria-hidden="true">
        {Array.from({ length: bars }, (_, index) => (
          <i key={index} />
        ))}
      </span>
      <span className="letter-spoiler-words">
        <LetterIcon name="lock" size={18} />
        <span>
          {/* Folded at its 「・」 only, so 「押すと表示」 never breaks apart. */}
          {words.split("・").map((part, index) => (
            <span key={index} className="letter-spoiler-part">
              {index > 0 && "・"}
              {part}
            </span>
          ))}
          {title && <span className="sr-only">（{quote(title)}）</span>}
        </span>
      </span>
    </button>
  );
}
