"use client";

import { useRef, type KeyboardEvent } from "react";
import type { HomeTab } from "../../lib/home-tab";

export const HOME_TABS: [HomeTab, string][] = [
  ["home", "ホーム"],
  ["letters", "便りだけ"],
];

export const paneId = (tab: HomeTab) => "home-pane-" + tab;
export const tabId = (tab: HomeTab) => "home-tab-" + tab;

/**
 * The two tabs at the top of Home (決定 H:89-93). The arrow keys move between
 * them; a pane is named as theirs only once it is on the page. A tab with
 * new 便り waiting, once the pill has had its time, carries a small green
 * dot (never red, H:54) and says so in its name.
 */
export function HomeTabs({
  tab,
  mounted,
  waiting,
  onSelect,
}: {
  tab: HomeTab;
  mounted: ReadonlySet<HomeTab>;
  /** The tabs with new 便り waiting for the dot. */
  waiting: ReadonlySet<HomeTab>;
  onSelect: (to: HomeTab) => void;
}) {
  const buttons = useRef<Partial<Record<HomeTab, HTMLButtonElement | null>>>(
    {},
  );
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = HOME_TABS.findIndex(([key]) => key === tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % HOME_TABS.length
        : event.key === "ArrowLeft"
          ? (at - 1 + HOME_TABS.length) % HOME_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? HOME_TABS.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    const [key] = HOME_TABS[to];
    if (key !== tab) onSelect(key);
    buttons.current[key]?.focus();
  }
  return (
    <div
      className="home-tabs"
      role="tablist"
      aria-label="ホームの表示"
      onKeyDown={onKeyDown}
    >
      {HOME_TABS.map(([key, label]) => (
        <button
          key={key}
          ref={(button) => {
            buttons.current[key] = button;
          }}
          type="button"
          role="tab"
          id={tabId(key)}
          data-tab={key}
          className="home-tab"
          aria-selected={key === tab}
          aria-controls={mounted.has(key) ? paneId(key) : undefined}
          tabIndex={key === tab ? 0 : -1}
          aria-label={
            waiting.has(key) ? label + "（新しい便りがあります）" : undefined
          }
          onClick={() => onSelect(key)}
        >
          <span>{label}</span>
          {waiting.has(key) && (
            <span className="home-tab-dot" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}
