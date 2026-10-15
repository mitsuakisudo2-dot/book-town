/**
 * 試作（claude/proto-colors）だけ: 残した画面の色と明るさを、最初の描画の前に
 * <html> へ当てる。明るさは day（昼）・lamp（灯り）・night（夜）・auto（端末に
 * 合わせて昼か夜。端末の設定が変わればその場で替える）。設定は
 * src/components/ProtoPalette.tsx。このブランチは main に取り込まない。
 */
export const PROTO_PALETTE_KEY = "proto-palette-v1";

export type ProtoMode = "day" | "lamp" | "night" | "auto";

export const PROTO_PALETTE_BOOT = `(function(){var k="${PROTO_PALETTE_KEY}",h=document.documentElement,q=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)");function read(){try{var v=JSON.parse(localStorage.getItem(k)||"{}");return{p:v.p||"midori",m:v.m||(v.n?"night":"day")}}catch(e){return{p:"midori",m:"day"}}}function put(){var v=read(),m=v.m==="auto"?(q&&q.matches?"night":"day"):v.m;if(v.p!=="midori")h.setAttribute("data-palette",v.p);else h.removeAttribute("data-palette");if(m==="night")h.setAttribute("data-night","");else h.removeAttribute("data-night");if(m==="lamp")h.setAttribute("data-lamp","");else h.removeAttribute("data-lamp")}window.__protoPalette=put;put();if(q&&q.addEventListener)q.addEventListener("change",put)})()`;
