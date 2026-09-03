#!/usr/bin/env bash
# ============================================================
#  deploy-secretary.sh — ส่ง secretary/Code.gs ขึ้น Google Apps Script ของคุณเลขา (รันโดย GitHub Actions)
#  ยกกลไกจาก origin-hq/.github/scripts/deploy-gas.sh (กับดักที่เคยเจอจดไว้ในคอมเมนต์ อย่าตัดออก)
#
#  ลำดับ: clasp pull (เอาไฟล์ที่รันจริงลงมา — ได้ appsscript.json ตัวจริง ไม่ต้องเดา scope)
#         → ทับ Code.gs ด้วยของใน repo → clasp push → clasp redeploy ลง deployment เดิม (URL ไม่เปลี่ยน
#         → LINE webhook / ลิงก์บอร์ด / ลิงก์ห้องผู้บริหาร ใช้ต่อได้) → smoke test ยิง ?action=version
#         ต้องได้ CODE_VERSION ตรงกับใน repo ถึงจะถือว่าสำเร็จ
# ============================================================
set -euo pipefail

SCRIPT_ID="1F1tH5OQstXi1JBs7TqVJ5K52l2wj8I_90bPVUc9LDL3Rhn5Ol9pIei1-"
# deployment ที่ผูกกับ LINE webhook + ทุกหน้าเว็บ — ห้ามสร้างใหม่ (redeploy เท่านั้น)
DEPLOY_ID="AKfycbwgxZ_yxK21-GcB0yuZSFw-uT7yr9J322ZyMT2H3QsHgcnEuvvhUP3I-yJH3hq9dC9J"
SRC="secretary/Code.gs"
WORK="$(mktemp -d)"

say()   { echo "$@"; }
sumry() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$@" >> "$GITHUB_STEP_SUMMARY"; fi; }

WANT_VER="$(grep -oE "^const CODE_VERSION = '[^']+'" "$SRC" | sed -E "s/.*'([^']+)'/\1/")"
say "เวอร์ชันใน repo: $WANT_VER"
say "clasp version: $(clasp --version 2>&1 | tail -1)"

# ---------- 1) ดึงไฟล์ที่รันจริงลงมาก่อน ----------
# .clasp.json ไม่อยู่ใน repo — สร้างชั่วคราวในโฟลเดอร์ทำงาน
printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$WORK/.clasp.json"
# ส่งขึ้นเฉพาะไฟล์ของ Apps Script — กันไฟล์แปลกปลอมหลุดขึ้น (กับดัก run #42 ฝั่งโรงน้ำ)
printf '%s\n' '**/**' '!*.gs' '!*.js' '!*.html' '!appsscript.json' > "$WORK/.claspignore"

rc=0
out="$( cd "$WORK" && clasp pull </dev/null 2>&1 )" || rc=1
say "$out"
if [ $rc -ne 0 ]; then say "::error::clasp pull ล้มเหลว — token หมดอายุ? (ดู DEPLOY.md วิธีใส่ CLASPRC_JSON ใหม่)"; exit 1; fi

# ไฟล์หลักที่รันจริงชื่ออะไร (.gs หรือ .js แล้วแต่ clasp) — ต้องทับไฟล์เดิมด้วยชื่อเดิม
# ห้ามเดาชื่อ: ถ้าใส่ Code.gs ทั้งที่ของจริงเป็น Code.js จะได้ไฟล์ "Code" สองตัวในโปรเจกต์
MAIN="$( cd "$WORK" && ls Code.gs Code.js 2>/dev/null | head -1 || true )"
if [ -z "$MAIN" ]; then
  say "::error::ดึงมาแล้วไม่เจอไฟล์ Code.gs/Code.js — ไฟล์ในโปรเจกต์: $(ls "$WORK" | tr '\n' ' ')"
  exit 1
fi
if [ ! -f "$WORK/appsscript.json" ]; then
  say "::error::ดึงมาแล้วไม่มี appsscript.json — ไม่ push (กันทำ manifest/สิทธิ์ของจริงหาย)"
  exit 1
fi
say "ไฟล์ในโปรเจกต์: $(ls "$WORK" | tr '\n' ' ')"
say "จะทับไฟล์: $MAIN"
cp "$SRC" "$WORK/$MAIN"

# ---------- 2) push ----------
rc=0
out="$( cd "$WORK" && { clasp push -f 2>&1 || clasp push </dev/null 2>&1; } )" || rc=1
say "$out"
if [ $rc -ne 0 ]; then say "::error::clasp push ล้มเหลว"; exit 1; fi
# ⚠️ Google ปฏิเสธไฟล์แล้วพิมพ์ "Skipping push." แต่ clasp คืน exit 0 → ต้องจับจากข้อความ
if grep -qE "Skipping push\.|Syntax error:" <<<"$out"; then
  say "::error::Google ไม่รับไฟล์ — โค้ดไม่ได้ขึ้นจริง"
  exit 1
fi

# ---------- 3) redeploy ลง deployment เดิม (URL คงเดิม) ----------
rc=0
out="$( cd "$WORK" && clasp redeploy "$DEPLOY_ID" -d "auto $WANT_VER ${GITHUB_SHA:0:7}" 2>&1 )" || rc=1
if [ $rc -ne 0 ]; then
  rc=0
  out="$( cd "$WORK" && clasp redeploy "$DEPLOY_ID" 2>&1 )" || rc=1   # clasp บางเวอร์ชันไม่รับ -d
fi
say "$out"
if [ $rc -ne 0 ]; then say "::error::clasp redeploy ล้มเหลว ($DEPLOY_ID)"; exit 1; fi
ver="$(echo "$out" | grep -oE '@[0-9]+' | tail -1)"

# ---------- 4) smoke test: ของจริงต้องตอบเวอร์ชันเดียวกับ repo ----------
# ต้องมี -L เพราะ exec URL เด้งไป googleusercontent.com เสมอ · ใช้ here-string กัน SIGPIPE ใต้ pipefail
sleep 5
body="$( curl -sSL --max-time 45 "https://script.google.com/macros/s/$DEPLOY_ID/exec?action=version" 2>/dev/null || true )"
if grep -qF "\"version\":\"$WANT_VER\"" <<<"$body"; then
  say "smoke test ผ่าน — ของจริงตอบเวอร์ชัน $WANT_VER"
else
  say "::error::smoke test ไม่ผ่าน — ยิง ?action=version แล้วไม่ได้ $WANT_VER"
  say "ตอบกลับ: $(printf '%s' "$body" | head -c 300)"
  if grep -qF "Access Denied" <<<"$body"; then
    say "::error::โค้ดขึ้นแล้ว แต่ deployment ไม่เปิดสาธารณะ — ใน GAS: Deploy › Manage deployments › ดินสอ › Who has access = Anyone"
  elif grep -qF "Script function not found" <<<"$body"; then
    say "::error::ไม่เจอ doGet — deployment ชี้ไปเวอร์ชันเก่า?"
  fi
  exit 1
fi

sumry "## 🚀 deploy คุณเลขาขึ้น Apps Script"
sumry ""
sumry "| deployment | เวอร์ชัน GAS | CODE_VERSION |"
sumry "|---|---|---|"
sumry "| \`...${DEPLOY_ID: -12}\` | **${ver:-?}** | \`$WANT_VER\` ✅ (ของจริงตอบตรงกัน) |"
sumry ""
sumry "พิมพ์ \"เช็คระบบ\" ในไลน์จะเห็น \`$WANT_VER\` · อัปเดตแถว \"รอ deploy\" ใน STATUS.md ได้เลย"
say "✅ deploy เสร็จ: $WANT_VER ($ver)"
