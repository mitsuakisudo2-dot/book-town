"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Notify, TownActions, TownState } from "../lib/types";
import { leaveLayers } from "../lib/back-layer";
import { inManageMode } from "../lib/town-mode";
import { NAMES } from "../lib/words";
import { Icon } from "./ui";
import "./mode-switch.css";

/**
 * 読書管理モード on or off, the first thing of 設定 (管理表 99, けにーさん
 * 10-25: no switch in the bars, so the town's screens stay as they are).
 * Going in, what changes is said first, in place; coming back is one tap.
 * Either way only the setting changes (docs/機能/読書管理モード.md).
 */
export function ModeSwitch({
  state,
  actions,
  notify,
}: {
  state: TownState;
  actions: TownActions;
  notify: Notify;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  if (inManageMode(state))
    return (
      <section className="mode-switch is-on" aria-labelledby="mode-title">
        <div className="mode-switch-head">
          <Icon name="leaf" size={22} />
          <div>
            <h3 id="mode-title">読書管理モードで使っています</h3>
            <p>自分と本だけの時間です。</p>
          </div>
        </div>
        <p className="mode-switch-note">
          通常モードに戻しても、この間の記録と本は、あなただけのままです。
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            actions.setTownMode("normal");
            notify("通常モードに戻しました");
          }}
        >
          通常モードに戻す
        </button>
      </section>
    );
  return (
    <section className="mode-switch" aria-labelledby="mode-title">
      <div className="mode-switch-head">
        <Icon name="leaf" size={22} />
        <div>
          <h3 id="mode-title">読書管理モード</h3>
          <p>街と人を見えなくして、自分と本だけで使えます。</p>
        </div>
      </div>
      {asking ? (
        <>
          <ul className="mode-switch-list">
            <li>
              <Icon name="check" size={15} />
              <span>
                ライブラリ、本棚、記録、読書の時間は、そのまま使えます
              </span>
            </li>
            <li>
              <Icon name="check" size={15} />
              <span>
                新しく入れた本と記録は、あなただけのものになり、人の数にも入りません
              </span>
            </li>
            <li>
              <Icon name="leaf" size={15} />
              <span>
                書店めぐり、人の{NAMES.letter}
                やPOP、人からのお知らせは見えなくなります
              </span>
            </li>
            <li>
              <Icon name="leaf" size={15} />
              <span>
                今まで見せた物は、そのまま見えます。閉店や1つずつの非公開は、いつでもできます
              </span>
            </li>
            <li>
              <Icon name="leaf" size={15} />
              <span>設定から、いつでも戻せます</span>
            </li>
          </ul>
          <div className="mode-switch-actions">
            <button
              type="button"
              className="btn fill"
              onClick={() => {
                actions.setTownMode("manage");
                notify("読書管理モードにしました");
                leaveLayers(() => router.push("/"));
              }}
            >
              読書管理モードにする
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={() => setAsking(false)}
            >
              やめる
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn"
          aria-expanded={false}
          onClick={() => setAsking(true)}
        >
          読書管理モードにする
        </button>
      )}
    </section>
  );
}
