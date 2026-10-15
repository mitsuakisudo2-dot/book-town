/**
 * 試作（claude/proto-colors）だけ: 残した色の選びを、最初の描画の前に
 * <html> へ当てる。切り替えは src/components/ProtoPalette.tsx。
 * このブランチは main に取り込まない。
 */
export const PROTO_PALETTE_KEY = "proto-palette-v1";

export const PROTO_PALETTE_BOOT = `(function(){try{var v=JSON.parse(localStorage.getItem("${PROTO_PALETTE_KEY}")||"{}"),h=document.documentElement;if(v.p&&v.p!=="midori")h.setAttribute("data-palette",v.p);if(v.n)h.setAttribute("data-night","")}catch(e){}})()`;
