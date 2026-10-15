/**
 * 試作（claude/proto-colors）だけ: 残した画面の色と明るさを、最初の描画の前に
 * <html> へ当てる。仕組みは src/lib/proto-time.ts、設定は
 * src/components/ProtoPalette.tsx。このブランチは main に取り込まない。
 */
import { protoEngine } from "./proto-time";

export const PROTO_PALETTE_KEY = "proto-palette-v1";
export const PROTO_TIME_PREVIEW_KEY = "proto-time-preview-v1";

export type ProtoMode = "day" | "lamp" | "night" | "auto" | "time";

export const PROTO_PALETTE_BOOT = `(function(){try{(${protoEngine.toString()})().start()}catch(e){}})()`;
