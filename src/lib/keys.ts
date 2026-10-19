// Keys that belong to the keyboard's kana conversion, not to the page: the
// Enter that confirms a conversion and the Escape that cancels one. Safari
// reports isComposing false for the key that ends a conversion, so the
// keyCode 229 it gives every key the conversion takes is checked too.

/** A key pressed while a kana conversion takes it (a native keyboard event). */
export const imeKey = (event: {
  isComposing?: boolean;
  keyCode: number;
}): boolean => Boolean(event.isComposing) || event.keyCode === 229;

/**
 * Enter as the reader meant it: not the Enter that confirms a kana
 * conversion, which belongs to the keyboard.
 */
export const enterPressed = (event: {
  key: string;
  keyCode: number;
  nativeEvent: { isComposing?: boolean };
}): boolean =>
  event.key === "Enter" &&
  !imeKey({
    isComposing: event.nativeEvent.isComposing,
    keyCode: event.keyCode,
  });
