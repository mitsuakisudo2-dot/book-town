#!/bin/bash
# スレッドのチェックリストが変わったら、けにーさんの机（Surface の画面）へ送る。
# 送り先と合言葉は作業環境の DESK_URL と DESK_WRITE_TOKEN。無い環境では何もしない。
# 机に届かなくても作業は止めない（いつも 0 で終わる）。
[ -n "${DESK_URL:-}" ] && [ -n "${DESK_WRITE_TOKEN:-}" ] || exit 0
command -v jq >/dev/null && command -v curl >/dev/null || exit 0
body=$(jq -c --arg s "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" \
  '{session: (if $s == "" then .session_id else $s end), text: (.tool_input.text // ""), start_new: (.tool_input.start_new // false)}' 2>/dev/null) || exit 0
curl -sS -m 5 -o /dev/null -X POST "${DESK_URL%/}/api/hook" \
  -H "Authorization: Bearer ${DESK_WRITE_TOKEN}" -H "Content-Type: application/json" \
  --data "$body" >/dev/null 2>&1 || true
exit 0
