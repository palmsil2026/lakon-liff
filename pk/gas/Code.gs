/**
 * ════════════════════════════════════════════════════════════
 *  P&K System — ระบบโรงขวด P&K (Google Apps Script)
 *  ออเดอร์ → งานผลิต → งานสกรีน → ออกบิล → ใบวางบิล + บอร์ดบริหาร
 *  ⚠️ คนละบริษัทกับโรงน้ำละกอน — ห้ามชี้ชีตนี้ไปที่ OriginSystem
 * ════════════════════════════════════════════════════════════
 *
 *  วิธีติดตั้ง (ทำครั้งเดียว โดยล็อกอิน palm.work2026@gmail.com):
 *  1) script.new → ตั้งชื่อโปรเจกต์ "P&K System" → วางไฟล์นี้ทั้งไฟล์
 *  2) รัน setupPkSystem() หนึ่งครั้ง → สร้างสเปรดชีต "PKSystem"
 *     และตั้ง Script Property PK_SHEET_ID ให้อัตโนมัติ
 *  3) Project Settings → Script properties → เพิ่ม 2 ค่า:
 *       PK_KEY      = รหัสทีม (พนักงานใช้เข้าแอป)
 *       PK_EXEC_KEY = รหัสผู้บริหาร (เข้าบอร์ด + ทำได้ทุกอย่าง)
 *  4) รัน importLegacyAccounting() → ดึงบิล/ลูกหนี้/ลูกค้า
 *     จากสำเนา "ระบบบัญชี" เดิม (สแนปช็อต 30 ส.ค. 2026)
 *  5) Deploy → New deployment → Web app → Execute as: Me /
 *     Who has access: Anyone → เอา URL ไปวางใน pk/index.html
 *     และ pk/exec/index.html (ตัวแปร GAS_URL)
 *     ครั้งถัดไปแก้โค้ด: Manage deployments → ✏️ → New version เท่านั้น
 *
 *  ข้อตกลงกับแชท "แอพการเงินโรงขวด":
 *  - สเปรดชีต PKSystem คือฐานเดียวของ P&K — เพิ่มแท็บใหม่ได้เลย
 *    (เช่น Expenses) แต่ห้ามเปลี่ยนชื่อคอลัมน์แท็บ Bills / Statements
 *  - เงินรับจริง/ลูกหนี้ อ่านจากแท็บ Bills (สถานะ: ชำระแล้ว/ค้างชำระ/วางบิลแล้ว)
 *  - หาคอลัมน์จากหัวตารางเสมอ อย่าอ้างตำแหน่งคอลัมน์ตายตัว
 */

const CODE_VERSION = '2026-08-30a';
const LEGACY_SNAPSHOT_ID = '13BkMrh9sckRf3lCVW_Kze61zpcLNhGB2ERy1AFSJVhU'; // PK_ระบบบัญชี_snapshot_2026-08-30
const TZ = 'Asia/Bangkok';

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function setProp(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

// ─────────────────────────────────────────────
// โครงสร้างชีต PKSystem
// ─────────────────────────────────────────────
const TABS = {
  Customers:  ['Customer_ID', 'ชื่อลูกค้า', 'เบอร์โทร', 'ที่อยู่', 'เครดิต(วัน)', 'หมายเหตุ', 'สร้างเมื่อ'],
  Products:   ['Product_ID', 'ชื่อสินค้า', 'หน่วย', 'ราคา/หน่วย', 'หมายเหตุ'],
  Orders:     ['Order_ID', 'วันที่รับ', 'ลูกค้า', 'กำหนดส่ง', 'สถานะ', 'มีสกรีน', 'ยอดรวม', 'รายการ', 'หมายเหตุ', 'ผู้รับออเดอร์', 'Bill_No', 'อัปเดตล่าสุด'],
  Production: ['Job_ID', 'Order_ID', 'วันที่เข้าคิว', 'งาน', 'จำนวนรวม', 'สถานะ', 'เริ่มเมื่อ', 'เสร็จเมื่อ', 'ผู้ทำ', 'หมายเหตุ'],
  ScreenJobs: ['Job_ID', 'Order_ID', 'วันที่เข้าคิว', 'ลาย/สี', 'จำนวน', 'สถานะ', 'เริ่มเมื่อ', 'เสร็จเมื่อ', 'ผู้ทำ', 'หมายเหตุ'],
  Bills:      ['Bill_No', 'วันที่', 'ลูกค้า', 'Order_ID', 'ยอดรวม', 'ประเภท', 'ช่องทางชำระ', 'สถานะ', 'กำหนดชำระ', 'ชำระเมื่อ', 'Stmt_No', 'รายการ', 'หมายเหตุ', 'ที่มา'],
  Statements: ['Stmt_No', 'วันที่วาง', 'ลูกค้า', 'จำนวนบิล', 'ยอดรวม', 'กำหนดเก็บเงิน', 'สถานะ', 'บิลที่รวม', 'หมายเหตุ'],
  PriceHistory: ['วันที่', 'Product_ID', 'ชื่อสินค้า', 'ราคาเดิม', 'ราคาใหม่', 'ผู้ปรับ', 'หมายเหตุ'],
  Settings:   ['key', 'value'],
};

const SETTINGS_SEED = [
  ['COMPANY_NAME', 'โรงขวด P&K'],
  ['COMPANY_ADDR', ''],            // เติมที่อยู่จริงในชีต Settings
  ['COMPANY_TEL', ''],
  ['TAX_ID', ''],
  ['BILL_PREFIX', 'PK'],
  ['BILL_NEXT', '1'],
  ['STMT_PREFIX', 'PKS'],
  ['STMT_NEXT', '1'],
];

function setupPkSystem() {
  let ss;
  const id = prop('PK_SHEET_ID');
  if (id) { ss = SpreadsheetApp.openById(id); }
  else {
    ss = SpreadsheetApp.create('PKSystem');
    setProp('PK_SHEET_ID', ss.getId());
  }
  Object.keys(TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(TABS[name]);
      sh.setFrozenRows(1);
    }
  });
  const st = ss.getSheetByName('Settings');
  if (st.getLastRow() <= 1) SETTINGS_SEED.forEach(function (r) { st.appendRow(r); });
  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  Logger.log('PKSystem พร้อมใช้: ' + ss.getUrl());
}

// ─── ตัวช่วยอ่าน/เขียนตามหัวตาราง (ตามกติกา sheet-cols) ───
function book() { return SpreadsheetApp.openById(prop('PK_SHEET_ID')); }
function tab(name) {
  const sh = book().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแท็บ ' + name + ' — รัน setupPkSystem() ก่อน');
  return sh;
}
function readTab(name) {
  const v = tab(name).getDataRange().getValues();
  if (v.length < 1) return { head: [], rows: [] };
  const head = v[0].map(String);
  return { head: head, rows: v.slice(1).filter(function (r) { return r.join('') !== ''; }) };
}
function col(head, label) {
  const i = head.indexOf(label);
  if (i < 0) throw new Error('ไม่พบคอลัมน์ "' + label + '"');
  return i;
}
function rowsToObjs(name) {
  const d = readTab(name);
  return d.rows.map(function (r) {
    const o = {};
    d.head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}
function appendObj(name, obj) {
  const sh = tab(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(head.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
}
function updateWhere(name, idLabel, idValue, patch) {
  const sh = tab(name);
  const v = sh.getDataRange().getValues();
  const head = v[0].map(String);
  const idc = col(head, idLabel);
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][idc]) === String(idValue)) {
      Object.keys(patch).forEach(function (label) {
        sh.getRange(i + 1, col(head, label) + 1).setValue(patch[label]);
      });
      return true;
    }
  }
  return false;
}
function now() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function today() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nextNo(prefixKey, counterKey) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const st = readTab('Settings');
    const kc = col(st.head, 'key'), vc = col(st.head, 'value');
    let prefix = '', n = 1, rowOfCounter = -1;
    st.rows.forEach(function (r, i) {
      if (r[kc] === prefixKey) prefix = String(r[vc]);
      if (r[kc] === counterKey) { n = Number(r[vc]) || 1; rowOfCounter = i + 2; }
    });
    const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
    const no = prefix + '-' + year + '-' + ('0000' + n).slice(-4);
    if (rowOfCounter > 0) tab('Settings').getRange(rowOfCounter, vc + 1).setValue(n + 1);
    return no;
  } finally { lock.releaseLock(); }
}

// ─────────────────────────────────────────────
// นำเข้าข้อมูลเก่าจาก "ระบบบัญชี" (รันครั้งเดียวใน editor)
// อ่านอย่างเดียว: ไม่แตะไฟล์ต้นทาง
// ─────────────────────────────────────────────
function importLegacyAccounting(srcId) {
  srcId = srcId || LEGACY_SNAPSHOT_ID;
  const src = SpreadsheetApp.openById(srcId);
  let bills = 0, ar = 0, customers = 0;
  const seenCust = {};
  rowsToObjs('Customers').forEach(function (c) { seenCust[String(c['ชื่อลูกค้า']).trim()] = true; });

  src.getSheets().forEach(function (sh) {
    const v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    // หาแถวหัวตาราง
    let h = -1;
    for (let i = 0; i < Math.min(v.length, 10); i++) {
      if (v[i].map(String).indexOf('เลขที่บิล') >= 0 || v[i].map(String).indexOf('รายชื่อลูกค้า') >= 0) { h = i; break; }
    }
    if (h < 0) return;
    const head = v[h].map(String);
    const tabName = sh.getName();

    if (head.indexOf('รายชื่อลูกค้า') >= 0) {           // แท็บทะเบียนลูกค้า
      const nc = head.indexOf('รายชื่อลูกค้า');
      for (let i = h + 1; i < v.length; i++) {
        const name = String(v[i][nc]).trim();
        if (!name || seenCust[name]) continue;
        seenCust[name] = true;
        appendObj('Customers', { 'Customer_ID': 'C' + ('000' + (Object.keys(seenCust).length)).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() });
        customers++;
      }
      return;
    }

    const isAR = head.indexOf('ยอดค้าง') >= 0;          // แท็บรายการเครดิต (ลูกหนี้)
    const iDate = head.indexOf('วันที่') >= 0 ? head.indexOf('วันที่') : 0;
    const iNo = head.indexOf('เลขที่บิล');
    const iName = head.indexOf('ชื่อลูกค้า');
    for (let i = h + 1; i < v.length; i++) {
      const r = v[i];
      const name = String(r[iName] || '').trim();
      const no = String(r[iNo] || '').trim();
      if (!name || !no || no === 'เลขที่บิล') continue;
      const rawDate = r[iDate] instanceof Date ? Utilities.formatDate(r[iDate], TZ, 'yyyy-MM-dd') : String(r[iDate] || '').trim();
      if (isAR) {
        const owe = Number(String(r[head.indexOf('ยอดค้าง')]).replace(/,/g, '')) || 0;
        const status = String(r[head.indexOf('สถานะ')] || '').trim();
        if (!owe) continue;
        appendObj('Bills', {
          'Bill_No': 'เก่า-' + tabName + '-' + no, 'วันที่': rawDate, 'ลูกค้า': name,
          'ยอดรวม': owe, 'ประเภท': 'เครดิต',
          'สถานะ': (status.indexOf('จ่าย') >= 0 || status.indexOf('ชำระ') >= 0 || status.indexOf('เก็บ') >= 0) ? 'ชำระแล้ว' : 'ค้างชำระ',
          'ช่องทางชำระ': String(r[head.indexOf('ช่องทางชำระ')] || ''), 'หมายเหตุ': String(r[head.indexOf('หมายเหตุ')] || ''),
          'ที่มา': 'นำเข้า:' + tabName,
        });
        ar++;
      } else {                                          // แท็บบัญชีส่งเงิน (บิลรายวัน)
        const cash = Number(String(r[head.indexOf('เงินสด')]).replace(/,/g, '')) || 0;
        const credit = Number(String(r[head.indexOf('เครดิต')]).replace(/,/g, '')) || 0;
        if (!cash && !credit) continue;
        appendObj('Bills', {
          'Bill_No': 'เก่า-' + tabName + '-' + no, 'วันที่': rawDate, 'ลูกค้า': name,
          'ยอดรวม': cash + credit, 'ประเภท': credit ? 'เครดิต' : 'เงินสด',
          'ช่องทางชำระ': String(r[head.indexOf('ช่องทางชำระ')] || ''),
          'สถานะ': credit ? 'ค้างชำระ' : 'ชำระแล้ว', 'ชำระเมื่อ': credit ? '' : rawDate,
          'หมายเหตุ': String(r[head.indexOf('หมายเหตุ')] || ''), 'ที่มา': 'นำเข้า:' + tabName,
        });
        bills++;
        if (name !== 'สด' && name !== 'สดเซล' && !seenCust[name]) {
          seenCust[name] = true;
          appendObj('Customers', { 'Customer_ID': 'C' + ('000' + (Object.keys(seenCust).length)).slice(-4), 'ชื่อลูกค้า': name, 'สร้างเมื่อ': now() });
          customers++;
        }
      }
    }
  });
  Logger.log('นำเข้าเสร็จ: บิล ' + bills + ' แถว · ลูกหนี้เครดิต ' + ar + ' แถว · ลูกค้าใหม่ ' + customers + ' ราย');
  Logger.log('⚠️ หมายเหตุ: แท็บเครดิตกับแท็บบิลรายวันของไฟล์เก่าอาจซ้ำกันบางใบ (บิลเดียวโผล่ 2 แท็บ) — เช็คก่อนใช้ยอดรวมย้อนหลังจริงจัง');
}

// ─────────────────────────────────────────────
// Web API — GET ทั้งหมด: ?action=...&key=...[&payload=JSON]
// ─────────────────────────────────────────────
function jsonOut(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function authTeam(key) { return key && (key === prop('PK_KEY') || key === prop('PK_EXEC_KEY')); }
function authExec(key) { return key && key === prop('PK_EXEC_KEY'); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  const a = p.action || '';
  try {
    if (a === 'pkHealth') return jsonOut({ ok: true, version: CODE_VERSION, sheet: !!prop('PK_SHEET_ID') });
    if (!authTeam(p.key)) return jsonOut({ ok: false, error: 'รหัสไม่ถูกต้อง' });
    const pay = p.payload ? JSON.parse(p.payload) : {};

    if (a === 'pkBoot') return jsonOut({ ok: true, version: CODE_VERSION, customers: rowsToObjs('Customers'), products: rowsToObjs('Products'), settings: settingsMap() });
    if (a === 'pkOrders') return jsonOut({ ok: true, orders: rowsToObjs('Orders').reverse().slice(0, Number(p.limit) || 60), production: rowsToObjs('Production').reverse().slice(0, 60), screens: rowsToObjs('ScreenJobs').reverse().slice(0, 60) });
    if (a === 'pkOrderSave') return jsonOut(orderSave(pay, p.user || ''));
    if (a === 'pkOrderStatus') return jsonOut(orderStatus(pay));
    if (a === 'pkJobDo') return jsonOut(jobDo(pay));
    if (a === 'pkBills') return jsonOut({ ok: true, bills: billList(p) });
    if (a === 'pkBillCreate') return jsonOut(billCreate(pay));
    if (a === 'pkBillPay') return jsonOut(billPay(pay));
    if (a === 'pkStmts') return jsonOut({ ok: true, stmts: rowsToObjs('Statements').reverse().slice(0, 40) });
    if (a === 'pkStmtCreate') return jsonOut(stmtCreate(pay));
    if (a === 'pkStmtDone') return jsonOut(stmtDone(pay));
    if (a === 'pkCustSave') return jsonOut(custSave(pay));
    if (a === 'pkExec') { if (!authExec(p.key)) return jsonOut({ ok: false, error: 'รหัสผู้บริหารไม่ถูกต้อง' }); return jsonOut(execData()); }
    if (a === 'pkPriceSet') { if (!authExec(p.key)) return jsonOut({ ok: false, error: 'ปรับราคาได้เฉพาะผู้บริหาร' }); return jsonOut(priceSet(pay)); }
    if (a === 'pkPriceHistory') { if (!authExec(p.key)) return jsonOut({ ok: false, error: 'ดูประวัติราคาได้เฉพาะผู้บริหาร' }); return jsonOut({ ok: true, history: rowsToObjs('PriceHistory').reverse().slice(0, Number(p.limit) || 100) }); }
    return jsonOut({ ok: false, error: 'ไม่รู้จัก action: ' + a });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function settingsMap() {
  const st = readTab('Settings'); const m = {};
  const kc = col(st.head, 'key'), vc = col(st.head, 'value');
  st.rows.forEach(function (r) { m[r[kc]] = r[vc]; });
  return m;
}

// ─── ออเดอร์ ───
function orderSave(o, user) {
  const id = 'PO-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd-HHmmss');
  const items = o.items || [];
  const total = items.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  const hasScreen = items.some(function (it) { return it.screen; });
  appendObj('Orders', {
    'Order_ID': id, 'วันที่รับ': today(), 'ลูกค้า': o.customer || '', 'กำหนดส่ง': o.due || '',
    'สถานะ': 'รอผลิต', 'มีสกรีน': hasScreen ? 'มี' : '', 'ยอดรวม': total,
    'รายการ': JSON.stringify(items), 'หมายเหตุ': o.note || '', 'ผู้รับออเดอร์': user, 'อัปเดตล่าสุด': now(),
  });
  appendObj('Production', {
    'Job_ID': 'PJ-' + id.slice(3), 'Order_ID': id, 'วันที่เข้าคิว': today(),
    'งาน': items.map(function (it) { return it.name + ' ×' + it.qty; }).join(', '),
    'จำนวนรวม': items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0), 'สถานะ': 'รอผลิต',
  });
  if (o.customer && !rowsToObjs('Customers').some(function (c) { return String(c['ชื่อลูกค้า']).trim() === String(o.customer).trim(); })) {
    custSave({ name: o.customer });
  }
  return { ok: true, id: id, total: total };
}
function orderStatus(o) {
  const okO = updateWhere('Orders', 'Order_ID', o.id, { 'สถานะ': o.status, 'อัปเดตล่าสุด': now() });
  return { ok: okO };
}
function jobDo(o) { // {type:'prod'|'screen', id, do:'start'|'done', user}
  const tabName = o.type === 'screen' ? 'ScreenJobs' : 'Production';
  const jobs = rowsToObjs(tabName);
  const job = jobs.filter(function (j) { return j['Job_ID'] === o.id; })[0];
  if (!job) return { ok: false, error: 'ไม่พบงาน ' + o.id };
  const orderId = job['Order_ID'];
  if (o.do === 'start') {
    updateWhere(tabName, 'Job_ID', o.id, { 'สถานะ': o.type === 'screen' ? 'กำลังสกรีน' : 'กำลังผลิต', 'เริ่มเมื่อ': now(), 'ผู้ทำ': o.user || '' });
    updateWhere('Orders', 'Order_ID', orderId, { 'สถานะ': o.type === 'screen' ? 'กำลังสกรีน' : 'กำลังผลิต', 'อัปเดตล่าสุด': now() });
  } else if (o.do === 'done') {
    updateWhere(tabName, 'Job_ID', o.id, { 'สถานะ': 'เสร็จ', 'เสร็จเมื่อ': now(), 'ผู้ทำ': o.user || job['ผู้ทำ'] || '' });
    if (o.type === 'prod') {
      const ord = rowsToObjs('Orders').filter(function (x) { return x['Order_ID'] === orderId; })[0] || {};
      if (ord['มีสกรีน'] === 'มี') {
        let items = []; try { items = JSON.parse(ord['รายการ'] || '[]'); } catch (ignore) {}
        const scr = items.filter(function (it) { return it.screen; });
        appendObj('ScreenJobs', {
          'Job_ID': 'SJ-' + orderId.slice(3), 'Order_ID': orderId, 'วันที่เข้าคิว': today(),
          'ลาย/สี': scr.map(function (it) { return it.name + (it.screenNote ? ' (' + it.screenNote + ')' : ''); }).join(', '),
          'จำนวน': scr.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0), 'สถานะ': 'รอสกรีน',
        });
        updateWhere('Orders', 'Order_ID', orderId, { 'สถานะ': 'รอสกรีน', 'อัปเดตล่าสุด': now() });
      } else {
        updateWhere('Orders', 'Order_ID', orderId, { 'สถานะ': 'พร้อมส่ง', 'อัปเดตล่าสุด': now() });
      }
    } else {
      updateWhere('Orders', 'Order_ID', orderId, { 'สถานะ': 'พร้อมส่ง', 'อัปเดตล่าสุด': now() });
    }
  }
  return { ok: true };
}

// ─── บิล ───
function billList(p) {
  let bills = rowsToObjs('Bills');
  if (p.customer) bills = bills.filter(function (b) { return String(b['ลูกค้า']).trim() === String(p.customer).trim(); });
  if (p.status) bills = bills.filter(function (b) { return b['สถานะ'] === p.status; });
  return bills.reverse().slice(0, Number(p.limit) || 80);
}
function billCreate(o) { // {orderId?, customer, items?, type:'เงินสด'|'เครดิต', channel?, dueDays?, note?}
  let items = o.items || [], customer = o.customer || '', orderId = o.orderId || '';
  if (orderId) {
    const ord = rowsToObjs('Orders').filter(function (x) { return x['Order_ID'] === orderId; })[0];
    if (!ord) return { ok: false, error: 'ไม่พบออเดอร์ ' + orderId };
    if (ord['Bill_No']) return { ok: false, error: 'ออเดอร์นี้ออกบิลแล้ว: ' + ord['Bill_No'] };
    try { items = JSON.parse(ord['รายการ'] || '[]'); } catch (ignore) {}
    customer = ord['ลูกค้า'];
  }
  const total = items.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.price) || 0); }, 0);
  const no = nextNo('BILL_PREFIX', 'BILL_NEXT');
  const isCredit = o.type === 'เครดิต';
  let due = '';
  if (isCredit) {
    const days = Number(o.dueDays) || 30;
    due = Utilities.formatDate(new Date(Date.now() + days * 86400000), TZ, 'yyyy-MM-dd');
  }
  appendObj('Bills', {
    'Bill_No': no, 'วันที่': today(), 'ลูกค้า': customer, 'Order_ID': orderId, 'ยอดรวม': total,
    'ประเภท': o.type || 'เงินสด', 'ช่องทางชำระ': o.channel || '', 'สถานะ': isCredit ? 'ค้างชำระ' : 'ชำระแล้ว',
    'กำหนดชำระ': due, 'ชำระเมื่อ': isCredit ? '' : today(), 'รายการ': JSON.stringify(items), 'หมายเหตุ': o.note || '', 'ที่มา': 'ระบบใหม่',
  });
  if (orderId) updateWhere('Orders', 'Order_ID', orderId, { 'Bill_No': no, 'อัปเดตล่าสุด': now() });
  return { ok: true, no: no, total: total, due: due, customer: customer, items: items, date: today(), settings: settingsMap() };
}
function billPay(o) { // {no, channel}
  return { ok: updateWhere('Bills', 'Bill_No', o.no, { 'สถานะ': 'ชำระแล้ว', 'ชำระเมื่อ': today(), 'ช่องทางชำระ': o.channel || '' }) };
}

// ─── ใบวางบิล ───
function stmtCreate(o) { // {customer, billNos:[], due, note}
  const bills = rowsToObjs('Bills').filter(function (b) { return (o.billNos || []).indexOf(String(b['Bill_No'])) >= 0; });
  if (!bills.length) return { ok: false, error: 'ไม่ได้เลือกบิล' };
  const total = bills.reduce(function (s, b) { return s + (Number(String(b['ยอดรวม']).replace(/,/g, '')) || 0); }, 0);
  const no = nextNo('STMT_PREFIX', 'STMT_NEXT');
  appendObj('Statements', {
    'Stmt_No': no, 'วันที่วาง': today(), 'ลูกค้า': o.customer, 'จำนวนบิล': bills.length,
    'ยอดรวม': total, 'กำหนดเก็บเงิน': o.due || '', 'สถานะ': 'รอเก็บ', 'บิลที่รวม': (o.billNos || []).join(', '), 'หมายเหตุ': o.note || '',
  });
  bills.forEach(function (b) { updateWhere('Bills', 'Bill_No', b['Bill_No'], { 'สถานะ': 'วางบิลแล้ว', 'Stmt_No': no }); });
  return { ok: true, no: no, total: total, bills: bills, date: today(), due: o.due || '', customer: o.customer, settings: settingsMap() };
}
function stmtDone(o) { // {no} เก็บเงินได้แล้ว → บิลทุกใบชำระแล้ว
  const st = rowsToObjs('Statements').filter(function (s) { return s['Stmt_No'] === o.no; })[0];
  if (!st) return { ok: false, error: 'ไม่พบใบวางบิล ' + o.no };
  updateWhere('Statements', 'Stmt_No', o.no, { 'สถานะ': 'เก็บแล้ว' });
  String(st['บิลที่รวม']).split(',').map(function (s) { return s.trim(); }).forEach(function (bn) {
    if (bn) updateWhere('Bills', 'Bill_No', bn, { 'สถานะ': 'ชำระแล้ว', 'ชำระเมื่อ': today() });
  });
  return { ok: true };
}

// ─── ลูกค้า ───
function custSave(o) {
  const all = rowsToObjs('Customers');
  const exist = all.filter(function (c) { return String(c['ชื่อลูกค้า']).trim() === String(o.name).trim(); })[0];
  if (exist) {
    updateWhere('Customers', 'Customer_ID', exist['Customer_ID'], { 'เบอร์โทร': o.tel || exist['เบอร์โทร'], 'ที่อยู่': o.addr || exist['ที่อยู่'], 'เครดิต(วัน)': o.creditDays || exist['เครดิต(วัน)'] });
    return { ok: true, id: exist['Customer_ID'] };
  }
  const id = 'C' + ('000' + (all.length + 1)).slice(-4);
  appendObj('Customers', { 'Customer_ID': id, 'ชื่อลูกค้า': String(o.name).trim(), 'เบอร์โทร': o.tel || '', 'ที่อยู่': o.addr || '', 'เครดิต(วัน)': o.creditDays || '', 'สร้างเมื่อ': now() });
  return { ok: true, id: id };
}

// ─── ราคาสินค้า (ประธานใหญ่กำหนด — ทุกการปรับมีประวัติ) ───
function priceSet(o) { // {name, price, unit?, user, note?} — ไม่มีสินค้านี้ = สร้างใหม่
  const all = rowsToObjs('Products');
  const exist = all.filter(function (x) { return String(x['ชื่อสินค้า']).trim() === String(o.name).trim(); })[0];
  const newPrice = Number(o.price);
  if (!o.name || isNaN(newPrice)) return { ok: false, error: 'ต้องมีชื่อสินค้าและราคา' };
  let id, oldPrice = '';
  if (exist) {
    id = exist['Product_ID'];
    oldPrice = exist['ราคา/หน่วย'];
    updateWhere('Products', 'Product_ID', id, { 'ราคา/หน่วย': newPrice, 'หน่วย': o.unit || exist['หน่วย'] });
  } else {
    id = 'P' + ('000' + (all.length + 1)).slice(-4);
    appendObj('Products', { 'Product_ID': id, 'ชื่อสินค้า': String(o.name).trim(), 'หน่วย': o.unit || '', 'ราคา/หน่วย': newPrice, 'หมายเหตุ': o.note || '' });
  }
  appendObj('PriceHistory', {
    'วันที่': now(), 'Product_ID': id, 'ชื่อสินค้า': String(o.name).trim(),
    'ราคาเดิม': oldPrice, 'ราคาใหม่': newPrice, 'ผู้ปรับ': o.user || 'ประธาน', 'หมายเหตุ': o.note || '',
  });
  return { ok: true, id: id, oldPrice: oldPrice, newPrice: newPrice };
}

// ─── บอร์ดบริหาร ───
function num(x) { return Number(String(x).replace(/,/g, '')) || 0; }
function execData() {
  const bills = rowsToObjs('Bills');
  const orders = rowsToObjs('Orders');
  const prod = rowsToObjs('Production');
  const scr = rowsToObjs('ScreenJobs');
  const stmts = rowsToObjs('Statements');
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const td = today();

  let mCash = 0, mCredit = 0, tSales = 0, arTotal = 0;
  const arByCust = {}, daily = {}, custMonth = {};
  bills.forEach(function (b) {
    const d = String(b['วันที่']);
    const amt = num(b['ยอดรวม']);
    if (d.slice(0, 7) === month) {
      if (b['ประเภท'] === 'เครดิต') mCredit += amt; else mCash += amt;
      custMonth[b['ลูกค้า']] = (custMonth[b['ลูกค้า']] || 0) + amt;
    }
    if (d === td) tSales += amt;
    if (b['สถานะ'] === 'ค้างชำระ' || b['สถานะ'] === 'วางบิลแล้ว') {
      arTotal += amt;
      arByCust[b['ลูกค้า']] = (arByCust[b['ลูกค้า']] || 0) + amt;
    }
    if (d.length >= 10) daily[d] = (daily[d] || 0) + amt;
  });
  const orderCounts = {};
  orders.forEach(function (o) { orderCounts[o['สถานะ']] = (orderCounts[o['สถานะ']] || 0) + 1; });
  const top = function (m) {
    return Object.keys(m).map(function (k) { return { name: k, amt: m[k] }; })
      .sort(function (a, b) { return b.amt - a.amt; }).slice(0, 10);
  };
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = Utilities.formatDate(new Date(Date.now() - i * 86400000), TZ, 'yyyy-MM-dd');
    last30.push({ d: d.slice(5), amt: daily[d] || 0 });
  }
  return {
    ok: true, version: CODE_VERSION, month: month,
    kpi: { monthTotal: mCash + mCredit, monthCash: mCash, monthCredit: mCredit, todaySales: tSales, arTotal: arTotal },
    arTop: top(arByCust), custTop: top(custMonth), orderCounts: orderCounts,
    queues: {
      prodWait: prod.filter(function (j) { return j['สถานะ'] === 'รอผลิต'; }).length,
      prodDoing: prod.filter(function (j) { return j['สถานะ'] === 'กำลังผลิต'; }).length,
      scrWait: scr.filter(function (j) { return j['สถานะ'] === 'รอสกรีน'; }).length,
      scrDoing: scr.filter(function (j) { return j['สถานะ'] === 'กำลังสกรีน'; }).length,
    },
    stmtsWait: stmts.filter(function (s) { return s['สถานะ'] === 'รอเก็บ'; }).length,
    daily30: last30,
    recentOrders: orders.reverse().slice(0, 8),
    products: rowsToObjs('Products'),
    priceHistory: rowsToObjs('PriceHistory').reverse().slice(0, 30),
  };
}

// ─── เช็คระบบ (รันใน editor) ───
function healthCheck() {
  Logger.log('P&K System ' + CODE_VERSION + ' · PK_SHEET_ID=' + (prop('PK_SHEET_ID') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง — รัน setupPkSystem()'));
  Logger.log('PK_KEY=' + (prop('PK_KEY') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง') + ' · PK_EXEC_KEY=' + (prop('PK_EXEC_KEY') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง'));
}
