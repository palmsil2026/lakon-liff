# วิธี deploy คุณเลขา (GAS) 🚀

## 🤖 อัตโนมัติ (ตั้งไว้แล้ว — ปกติไม่ต้องทำอะไร)

**แชทแก้ `secretary/Code.gs` → push ขึ้น `main` → GitHub ส่งขึ้น Google ให้เอง** ไม่ต้องเปิดคอม ไม่ต้อง copy-paste
กลไกเดียวกับ `origin-hq` (ใช้จริงมา 60+ รอบ)

สิ่งที่ระบบทำทุกครั้ง:
1. ตรวจไวยากรณ์ `Code.gs` ก่อน — พังไม่ส่ง
2. `clasp pull` ดึงไฟล์ที่รันจริงลงมาก่อน (ได้ `appsscript.json` ตัวจริง ไม่เดาสิทธิ์) แล้วทับเฉพาะ `Code.gs`
3. `clasp push` → `clasp redeploy` ลง **deployment เดิม** (`AKfycbwgxZ_…dC9J`) — URL ไม่เปลี่ยน LINE webhook / ลิงก์บอร์ด / ห้องผู้บริหาร ใช้ต่อได้
4. **smoke test**: ยิง `…/exec?action=version` ของจริงต้องตอบ `CODE_VERSION` ตรงกับใน repo ถึงจะถือว่าผ่าน

**ดูผล / สั่งรันเอง:** https://github.com/palmsil2026/palm-hq/actions → workflow **Deploy to Apps Script** → ปุ่ม **Run workflow**
· หน้าสรุปของแต่ละรอบโชว์เลข `@version` และ `CODE_VERSION` ที่ของจริงตอบกลับ

**เช็คจากไลน์:** พิมพ์ "เช็คระบบ" → คุณเลขาบอก `CODE_VERSION` ที่รันอยู่จริง

### ตั้งค่าครั้งเดียว: ใส่ token ลง GitHub Secret ของ repo นี้

ใช้ค่าเดียวกับที่ใส่ใน `origin-hq` ได้เลย (บัญชี Google เดียวกัน)

1. เปิด cmd พิมพ์ `notepad %USERPROFILE%\.clasprc.json` → คัดลอกทั้งไฟล์ (Ctrl+A, Ctrl+C)
2. เปิด https://github.com/palmsil2026/palm-hq/settings/secrets/actions → **New repository secret**
3. Name: `CLASPRC_JSON` · Secret: วางข้อความที่ก๊อปมา → **Add secret**

> ⚠️ ไฟล์นี้ = รหัสผ่าน Google ของคุณปาล์ม **ห้ามวางในแชท ห้าม commit** ใส่ในช่อง Secret ของ GitHub เท่านั้น
> workflow ลบไฟล์ token ทิ้งทุกครั้งหลังรันเสร็จ

### ถอนสิทธิ์เมื่อไหร่ก็ได้
- ลบ Secret ในหน้าเดิม → ระบบอัตโนมัติหยุดทันที (กลับไปวางมือได้ตามปกติ)
- หรือถอนที่ต้นทาง: https://myaccount.google.com/permissions → **clasp** → Remove access

---

## ✋ วางมือ (สำรอง — ใช้เมื่อระบบอัตโนมัติใช้ไม่ได้)

1. เปิดโปรเจกต์ใน https://script.google.com/home → วาง `secretary/Code.gs` **จาก `main` เท่านั้น** ทับทั้งไฟล์
2. Deploy → **Manage deployments** → ✏️ ดินสอ → Version: **New version** → Deploy
   **ห้ามกด New deployment** (URL เปลี่ยน → LINE webhook พัง ลิงก์ทุกหน้าพัง)
3. พิมพ์ "เช็คระบบ" ในไลน์ ต้องขึ้นเวอร์ชันเดียวกับ `CODE_VERSION` ใน repo

## กติกาที่ต้องรักษาไว้
- แก้ `Code.gs` ต้อง bump `CODE_VERSION` ทุกครั้ง — smoke test ใช้ค่านี้เทียบของจริง ไม่ bump = ระบบตรวจไม่ได้ว่าขึ้นจริง
- `STATUS.md` ยังเป็นที่จดว่า "ของจริงรันเวอร์ชันไหน" — deploy อัตโนมัติผ่านแล้วให้ลบแถว "รอ deploy" ออก
