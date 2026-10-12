"use client";
import { useState, type CSSProperties } from "react";
import {
  STORE_TEMPLATES,
  applyStoreTemplate,
  changePlacement,
  insertPlacement,
  migrateShopScene,
  renameSceneObject,
  setRowBoard,
  takePlacementOff,
  type TemplateId,
} from "../lib/store-customization";
import {
  addBookPlacement,
  bookPop,
  objectById,
  unplacedBooks,
  type StoreScene,
} from "../lib/store-scene";
import { useWalkStore } from "../lib/walk-store";
import type { TownState } from "../lib/types";
import { StoreCanvas, StoreStamp } from "./StoreCanvas";
import { Icon, Modal } from "./ui";
import "./walk.css";
import "./scene-editor.css";

/** A small owner-only form editor. Scene geometry stays with the template. */
export function StoreSceneEditor({
  state,
  onClose,
  notify,
}: {
  state: TownState;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const saved = useWalkStore();
  const shop = state.ownShop!;
  const [draft, setDraft] = useState(() =>
    migrateShopScene(
      shop,
      state.books,
      saved.scenes.find((s) => s.storeId === shop.id),
    ),
  );
  const [rowId, setRowId] = useState("row-0");
  const [placementId, setPlacementId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const rows = draft.objects.filter((o) => o.kind === "row");
  const row = objectById(draft, rowId) ?? rows[0];
  const placements = draft.objects
    .filter((o) => o.kind === "book" && o.parentId === row.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const placement = placementId ? objectById(draft, placementId) : undefined;
  const book = state.books.find((b) => b.id === placement?.bookId);
  const pop = placement ? bookPop(draft, placement.id) : undefined;
  const unplaced = unplacedBooks(draft);
  const choices = query.trim()
    ? state.books
        .filter((b) =>
          (b.title + " " + b.author)
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, 10)
    : state.books.filter((b) => state.library.includes(b.id)).slice(0, 10);
  function edit(command: (scene: StoreScene) => StoreScene) {
    setError("");
    setDraft((previous) => command(previous));
  }
  function chooseTemplate(id: TemplateId) {
    edit((scene) => applyStoreTemplate(scene, id, state.books));
    setRowId("row-0");
    setPlacementId(null);
  }
  function selectBook(id: string) {
    setPlacementId(id);
    const selected = objectById(draft, id);
    if (selected?.parentId) setRowId(selected.parentId);
    requestAnimationFrame(() =>
      document
        .getElementById("scene-book-form")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }
  const style = {
    "--walk-wood": draft.theme.wood,
    "--walk-paper": draft.theme.paper,
    "--walk-light": draft.theme.light,
    "--walk-darkness": draft.background.darkness,
  } as CSSProperties;
  return (
    <Modal title="店内をつくる" wide onClose={onClose}>
      <div className="scene-editor" style={style}>
        <p className="scene-editor-intro">
          本を選び、言葉を添えて、あなたの一軒に。保存すると「書店めぐり」に反映されます。
        </p>
        <div className="scene-editor-columns">
          <div className="scene-preview">
            <div className="walk-artboard" aria-label="店内のプレビュー">
              <StoreCanvas
                scene={draft}
                books={state.books}
                onBook={(p) => selectBook(p.id)}
                onPop={(p) => selectBook(p.id)}
                onZoom={(id) => {
                  setRowId(id);
                  setPlacementId(null);
                }}
                onLabel={(o) => {
                  if (o.kind === "row") {
                    setRowId(o.id);
                    setPlacementId(null);
                  }
                }}
              />
            </div>
            <p>棚や本をタップして編集できます</p>
          </div>
          <div className="scene-controls">
            <fieldset className="scene-section">
              <legend>店の雰囲気</legend>
              <div className="scene-template-options">
                {STORE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={draft.templateId === t.id}
                    onClick={() => chooseTemplate(t.id)}
                    style={{ "--template-wood": t.wood } as CSSProperties}
                  >
                    <span className="scene-template-swatch" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <b>{t.name}</b>
                    <small>{t.description}</small>
                  </button>
                ))}
              </div>
              <label>
                看板の店名
                <input
                  value={objectById(draft, "sign")?.text ?? ""}
                  maxLength={80}
                  onChange={(e) =>
                    edit((s) => renameSceneObject(s, "sign", e.target.value))
                  }
                />
              </label>
              <label>
                店主からのひとこと
                <textarea
                  value={objectById(draft, "greeting")?.text ?? ""}
                  maxLength={500}
                  rows={2}
                  onChange={(e) =>
                    edit((s) =>
                      renameSceneObject(s, "greeting", e.target.value),
                    )
                  }
                />
              </label>
              <label>
                店のスタンプ
                <select
                  value={objectById(draft, "stamp")?.stamp ?? "plane"}
                  onChange={(e) =>
                    edit((s) => {
                      const next = structuredClone(s);
                      objectById(next, "stamp")!.stamp = e.target.value;
                      return next;
                    })
                  }
                >
                  <option value="plane">飛行機</option>
                  <option value="coffee">コーヒー</option>
                  <option value="leaf">葉っぱ</option>
                </select>
              </label>
            </fieldset>
            <fieldset className="scene-section">
              <legend>棚と並べ方</legend>
              <label>
                編集する棚
                <select
                  value={row.id}
                  onChange={(e) => {
                    setRowId(e.target.value);
                    setPlacementId(null);
                    setQuery("");
                  }}
                >
                  {rows.map((r, i) => (
                    <option value={r.id} key={r.id}>
                      {i + 1}段目 · {r.text || "名前のない棚"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                棚の案内札
                <input
                  value={row.text ?? ""}
                  maxLength={80}
                  onChange={(e) =>
                    edit((s) => renameSceneObject(s, row.id, e.target.value))
                  }
                />
              </label>
              <label>
                黒板の見出し
                <input
                  value={row.boardTitle ?? ""}
                  maxLength={12}
                  placeholder="旅の本"
                  onChange={(e) =>
                    edit((s) =>
                      setRowBoard(s, row.id, { boardTitle: e.target.value }),
                    )
                  }
                />
              </label>
              <label>
                黒板の絵
                <select
                  value={row.doodle ?? ""}
                  onChange={(e) =>
                    edit((s) =>
                      setRowBoard(s, row.id, { doodle: e.target.value }),
                    )
                  }
                >
                  <option value="">なし</option>
                  <option value="travel">旅</option>
                  <option value="daily">日常</option>
                  <option value="forest">森</option>
                  <option value="stars">星</option>
                  <option value="garden">庭</option>
                  <option value="city">街</option>
                  <option value="lamp">灯り</option>
                </select>
              </label>
              <label className="scene-check">
                <input
                  type="checkbox"
                  checked={row.isPublic === true}
                  onChange={(e) =>
                    edit((s) => {
                      const next = structuredClone(s);
                      objectById(next, row.id)!.isPublic = e.target.checked;
                      return next;
                    })
                  }
                />
                この棚を公開する
              </label>
              <div className="scene-placement-list" aria-label="この棚の本">
                {placements.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={p.id === placementId}
                    onClick={() => selectBook(p.id)}
                  >
                    {state.books.find((b) => b.id === p.bookId)?.title}
                    <small>
                      {p.display === "face" ? "表紙" : "背表紙"}
                      {p.isPublic === false ? " · 非公開" : ""}
                    </small>
                  </button>
                ))}
              </div>
              {placements.length === 0 && (
                <p className="scene-hint">この段は、まだ空いています。</p>
              )}
              <label>
                棚に加える本を探す
                <input
                  type="search"
                  value={query}
                  placeholder="タイトル・著者"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="scene-search-results">
                {choices.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      const id =
                        "placement:" + shop.id + ":" + crypto.randomUUID();
                      edit((s) => {
                        const next = addBookPlacement(
                          s,
                          b,
                          row.id,
                          id,
                          "spine",
                          Math.max(
                            -1,
                            ...s.objects
                              .filter(
                                (o) =>
                                  o.kind === "book" && o.parentId === row.id,
                              )
                              .map((o) => o.order ?? 0),
                          ) + 1,
                        );
                        objectById(next, id)!.isPublic = row.isPublic === true;
                        return next;
                      });
                      setPlacementId(id);
                    }}
                  >
                    <span>
                      {b.title}
                      <small>{b.author}</small>
                    </span>
                    <Icon name="plus" size={16} />
                  </button>
                ))}
              </div>
              {query.trim() && !choices.length && (
                <p className="scene-hint">
                  見つかりませんでした。「本棚」から本を登録すると、ここでも選べます。
                </p>
              )}
            </fieldset>
            {placement && book && (
              <fieldset className="scene-section" id="scene-book-form">
                <legend>{book.title}</legend>
                <label>
                  見せ方
                  <select
                    value={placement.display}
                    onChange={(e) =>
                      edit((s) =>
                        changePlacement(
                          s,
                          placement.id,
                          { display: e.target.value as "face" | "spine" },
                          state.books,
                        ),
                      )
                    }
                  >
                    <option value="spine">背表紙を向ける</option>
                    <option value="face">表紙を正面に向ける</option>
                  </select>
                </label>
                <label>
                  この本を置く棚
                  <select
                    value={placement.parentId ?? ""}
                    onChange={(e) =>
                      edit((s) =>
                        e.target.value
                          ? insertPlacement(
                              s,
                              placement.id,
                              e.target.value,
                              s.objects.filter(
                                (o) =>
                                  o.kind === "book" &&
                                  o.parentId === e.target.value,
                              ).length,
                            )
                          : takePlacementOff(s, placement.id),
                      )
                    }
                  >
                    <option value="">まだ並べない</option>
                    {rows.map((r, i) => (
                      <option key={r.id} value={r.id}>
                        {i + 1}段目 · {r.text || "名前のない棚"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="scene-order-buttons">
                  <button
                    type="button"
                    disabled={
                      !placement.parentId ||
                      placements.findIndex((p) => p.id === placement.id) <= 0
                    }
                    onClick={() =>
                      edit((s) =>
                        insertPlacement(
                          s,
                          placement.id,
                          placement.parentId!,
                          placements.findIndex((p) => p.id === placement.id) -
                            1,
                        ),
                      )
                    }
                  >
                    ← 左へ
                  </button>
                  <button
                    type="button"
                    disabled={
                      !placement.parentId ||
                      placements.findIndex((p) => p.id === placement.id) >=
                        placements.length - 1
                    }
                    onClick={() =>
                      edit((s) =>
                        insertPlacement(
                          s,
                          placement.id,
                          placement.parentId!,
                          placements.findIndex((p) => p.id === placement.id) +
                            1,
                        ),
                      )
                    }
                  >
                    右へ →
                  </button>
                </div>
                <label>
                  この本のPOP
                  <textarea
                    value={pop?.text ?? ""}
                    maxLength={10000}
                    rows={4}
                    placeholder="この一冊を、誰かに手渡すなら。"
                    aria-describedby="scene-pop-hint"
                    onChange={(e) =>
                      edit((s) =>
                        changePlacement(
                          s,
                          placement.id,
                          { pop: e.target.value },
                          state.books,
                        ),
                      )
                    }
                  />
                </label>
                <p className="scene-hint" id="scene-pop-hint">
                  棚には段ごとに1枚、いちばん右の面陳の本のPOPが立ちます。ほかのPOPは本を手に取ると読めます。
                </p>
                <label>
                  POPのスタンプ
                  <select
                    value={pop?.stamp ?? ""}
                    onChange={(e) =>
                      edit((s) =>
                        changePlacement(
                          s,
                          placement.id,
                          { stamp: e.target.value },
                          state.books,
                        ),
                      )
                    }
                  >
                    <option value="">なし</option>
                    <option value="plane">飛行機</option>
                    <option value="coffee">コーヒー</option>
                    <option value="leaf">葉っぱ</option>
                  </select>
                </label>
                {pop?.stamp && (
                  <span
                    className="scene-stamp-preview"
                    aria-label="選んだスタンプ"
                  >
                    <StoreStamp name={pop.stamp} />
                  </span>
                )}
                {!query.trim() && !choices.length && (
                  <p className="scene-hint">
                    タイトル・著者から本を探して、この棚に加えましょう。
                  </p>
                )}
                <label className="scene-check">
                  <input
                    type="checkbox"
                    checked={placement.isPublic !== false}
                    onChange={(e) =>
                      edit((s) =>
                        changePlacement(
                          s,
                          placement.id,
                          { isPublic: e.target.checked },
                          state.books,
                        ),
                      )
                    }
                  />
                  この本とPOPを公開する
                </label>
                <button
                  type="button"
                  className="scene-take-off"
                  disabled={!placement.parentId}
                  onClick={() => edit((s) => takePlacementOff(s, placement.id))}
                >
                  いったん棚から下ろす
                </button>
              </fieldset>
            )}
            {unplaced.length > 0 && (
              <fieldset className="scene-section">
                <legend>まだ並べていない本 · {unplaced.length}冊</legend>
                <p className="scene-hint">
                  棚に入りきらない本や、下ろした本です。POPも残っています。本を選び、置く棚を指定してください。
                </p>
                <div className="scene-placement-list">
                  {unplaced.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      aria-pressed={p.id === placementId}
                      onClick={() => selectBook(p.id)}
                    >
                      {state.books.find((b) => b.id === p.bookId)?.title}
                      <small>
                        {p.isPublic === false ? "非公開" : "未配置"}
                      </small>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </div>
        <div className="scene-editor-footer">
          <p className="scene-hint">
            このブラウザに保存します。これまでの本棚の内容は残ります。
          </p>
          {error && (
            <p className="scene-error" role="alert">
              {error}
            </p>
          )}
          {saved.status === "recovered" && (
            <p className="scene-error" role="alert">
              保存データを読み込めないため上書きできません。元のデータは保持しています。
            </p>
          )}
          <div>
            <button
              type="button"
              className="editor-button secondary"
              onClick={onClose}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="editor-button primary"
              disabled={!saved.ready || saved.status === "recovered"}
              onClick={() => {
                const result = saved.saveScene(draft, state);
                if (!result.ok) {
                  setError(result.error ?? "保存できません");
                  return;
                }
                notify("店内を保存しました。書店めぐりで眺められます。");
                onClose();
              }}
            >
              <Icon name="check" size={16} />
              店内を保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
