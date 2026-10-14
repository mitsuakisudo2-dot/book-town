"use client";

/**
 * Holds the page beneath a layer still (a book in hand, a 便り's page): the
 * body is fixed where it was scrolled, so neither a finger nor Safari's
 * rubber band moves the page under the layer. Returns the release, which
 * puts the body back and, with `restore`, the page where it was (a layer
 * that leaves for another page does not: that page starts at its own top).
 */
export function lockPageScroll(): (restore: boolean) => void {
  const position = { x: window.scrollX, y: window.scrollY };
  const style = document.body.style;
  const previous = {
    overflow: style.overflow,
    position: style.position,
    top: style.top,
    left: style.left,
    right: style.right,
    width: style.width,
  };
  style.overflow = "hidden";
  style.position = "fixed";
  style.top = `-${position.y}px`;
  style.left = `-${position.x}px`;
  style.right = "0";
  style.width = "100%";
  return (restore) => {
    Object.assign(style, previous);
    if (restore)
      window.scrollTo({
        left: position.x,
        top: position.y,
        behavior: "instant",
      });
  };
}
