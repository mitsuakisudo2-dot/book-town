"use client";

import { useId, type ReactNode } from "react";
import type { Feature } from "../../lib/features";
import { Icon } from "../ui";
import type { Shared } from "./Letters";
import type { Picked } from "./ShopFront";
import { Exhibition } from "./features/Exhibition";
import { ShelvesRail } from "./features/Shelves";
import { Reviews } from "./features/Reviews";
import { Pops } from "./features/Pops";

/**
 * A 特集 between the 便り: a full-width band, so it never passes for a post.
 * Its kicker says 特集; its tiles run sideways.
 */
export function FeatureBand({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="home-feature" aria-labelledby={id}>
      <div className="feature-head">
        <p className="feature-kicker">
          <Icon name="spark" size={14} />
          特集
        </p>
        <h2 id={id}>{title}</h2>
        <p>{lead}</p>
      </div>
      <ul className="home-rail">{children}</ul>
    </section>
  );
}

/** The tag on a tile drawn from a 見本 (sample) record. */
export const SampleTag = () => <span className="home-tag">見本</span>;

/** Each kind of 特集, with its words (v37). */
export function FeatureView({
  feature,
  onPick,
  ...shared
}: Shared & { feature: Feature; onPick: (picked: Picked) => void }) {
  switch (feature.kind) {
    case "exhibition":
      return (
        <FeatureBand
          title="企画展"
          lead="読書家が本を選んで貼り出したポスターです。"
        >
          <Exhibition posters={feature.posters} state={shared.state} />
        </FeatureBand>
      );
    case "shelves":
      return (
        <FeatureBand
          title="棚をのぞく"
          lead="本好きが開いている書店です。気になる店に入ってみてください。"
        >
          <ShelvesRail shops={feature.shops} state={shared.state} />
        </FeatureBand>
      );
    case "reviews":
      return (
        <FeatureBand
          title="感想が面白い本"
          lead="読んだ人のひとことで選んでいます。星や点数はありません。"
        >
          <Reviews posts={feature.posts} state={shared.state} />
        </FeatureBand>
      );
    case "pops":
      return (
        <FeatureBand
          title="書店のPOP"
          lead="店主たちが棚の本に添えた言葉です。"
        >
          <Pops pops={feature.pops} state={shared.state} onPick={onPick} />
        </FeatureBand>
      );
  }
}
