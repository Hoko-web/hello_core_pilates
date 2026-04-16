// ════════════════════════════════
//  ★ 設定（変更する可能性のある値） ★
// ════════════════════════════════
const CFG = {
  // ── 基本設定 ──
  DEMO: false,  // デモ表示: true=モックデータ / false=本番GAS
  GAS: "https://script.google.com/macros/s/AKfycbwiOJ3EBSzNDd3w5W_6xYFZrDTbT70g-k1T9ukuHPWOE_GrsJgsIdGbFvJBAN2KEigK/exec",

  // ── 営業時間 ──
  START: 8,           // 営業開始（時）
  END: 20,            // 営業終了（時）
  SLOT_MIN: 60,       // 1スロットの長さ（分）

  // ── 予約ルール ──
  MAX: 4,             // グループレッスン上限人数
  BOOK_MONTHS: 1,     // 何ヶ月先まで予約可能か
  WARN_THRESHOLD: 6,  // △（混雑気味）と判定するスロット数
};

// ════════════════════════════════
//  状態管理
// ════════════════════════════════
const S = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  date: null, // 選択日 'YYYY-MM-DD'
  slot: null, // 選択時間 '10:00'
  type: null, // 'trial' | 'group' | 'personal'
  num: 1,
  form: { name: "", furi: "", contact: "" },
  avail: {},
  id: null,
};

// ════════════════════════════════
//  ユーティリティ
// ════════════════════════════════

// XSS対策: innerHTML に埋め込む前にユーザー入力をエスケープする
const esc = (s) =>
  String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const p2 = (n) => String(n).padStart(2, "0");
const fmtD = (d) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const WDAY = ["日", "月", "火", "水", "木", "金", "土"];
const dateLabel = (ds) => {
  const d = new Date(ds + "T00:00:00");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WDAY[d.getDay()]}）`;
};
const typeLabel = (t) =>
  ({
    trial: "初回無料体験",
    group: "グループレッスン",
    personal: "パーソナルレッスン",
  })[t] || t;
const slotEnd = (start) => {
  const h = parseInt(start);
  const m = parseInt(start.split(":")[1]) || 0;
  const total = h * 60 + m + CFG.SLOT_MIN;
  return `${p2(Math.floor(total / 60))}:${p2(total % 60)}`;
};
const slotLabel = () => `${CFG.SLOT_MIN}分`;

function getMaxDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today.getFullYear(), today.getMonth() + CFG.BOOK_MONTHS, today.getDate());
  if (max.getDate() !== today.getDate()) {
    max.setDate(0);
  }
  max.setHours(0, 0, 0, 0);
  return max;
}

function slotSt(s) {
  if (!s || s.closed || s.hasT || s.hasP || s.n >= CFG.MAX)
    return { c: "ng", mark: "×", text: "満席", rem: 0 };
  if (s.n > 0)
    return {
      c: "wa",
      mark: "△",
      text: `残り${CFG.MAX - s.n}枠`,
      rem: CFG.MAX - s.n,
    };
  return { c: "ok", mark: "○", text: "空きあり", rem: CFG.MAX };
}

// バッファー適用: 予約済みスロットの前後1時間を×にする
function applyBuffer(slots) {
  const keys = Object.keys(slots).sort();
  const bookedIdxs = new Set();
  keys.forEach((k, i) => {
    const s = slots[k];
    if (!s.closed && (s.n > 0 || s.hasT || s.hasP)) bookedIdxs.add(i);
  });
  bookedIdxs.forEach((i) => {
    if (i > 0 && !bookedIdxs.has(i - 1)) slots[keys[i - 1]].closed = true;
    if (i < keys.length - 1 && !bookedIdxs.has(i + 1))
      slots[keys[i + 1]].closed = true;
  });
}

function daySt(slots) {
  const vs = Object.values(slots);
  const total = vs.length;
  let ngCount = 0,
    waCount = 0;
  vs.forEach((s) => {
    if (s.closed || s.hasT || s.hasP || s.n >= CFG.MAX) ngCount++;
    else if (s.n > 0) waCount++;
  });
  if (ngCount === total) return { c: "ng", mark: "×" };
  if (ngCount + waCount >= CFG.WARN_THRESHOLD) return { c: "wa", mark: "△" };
  return { c: "ok", mark: "○" };
}

// ════════════════════════════════
//  モックデータ（デモ用）
// ════════════════════════════════
function mockMonth(y, m) {
  const data = {},
    dim = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(y, m, d),
      ds = fmtD(dt),
      dow = dt.getDay();
    const slots = {};
    for (let h = CFG.START; h < CFG.END; h++) {
      const k = `${p2(h)}:00`;
      const r = Math.random();
      if (r < 0.08)
        slots[k] = { closed: false, n: 0, hasT: true, hasP: false };
      else if (r < 0.14)
        slots[k] = { closed: false, n: 0, hasT: false, hasP: true };
      else if (r < 0.25)
        slots[k] = {
          closed: false,
          n: CFG.MAX,
          hasT: false,
          hasP: false,
        };
      else if (r < 0.48)
        slots[k] = {
          closed: false,
          n: Math.ceil(Math.random() * 3),
          hasT: false,
          hasP: false,
        };
      else slots[k] = { closed: false, n: 0, hasT: false, hasP: false };
    }
    applyBuffer(slots);
    const st = daySt(slots);
    data[ds] = { slots, mark: st.mark, code: st.c };
  }
  return data;
}

// ════════════════════════════════
//  API（本番用）
// ════════════════════════════════
async function apiAvail(y, m) {
  const r = await fetch(
    `${CFG.GAS}?action=getMonthAvailability&year=${y}&month=${m + 1}`,
  );
  return r.json();
}
async function apiBook(payload) {
  const r = await fetch(CFG.GAS, {
    method: "POST",
    body: JSON.stringify({ action: "createBooking", ...payload }),
  });
  const text = await r.text();
  if (CFG.DEMO) console.log("apiBook raw response:", text);
  try {
    return JSON.parse(text);
  } catch (e) {
    return { error: "サーバーからの応答を処理できませんでした" };
  }
}

// ════════════════════════════════
//  画面遷移
// ════════════════════════════════
function go(name) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("on"));
  document.getElementById("v-" + name).classList.add("on");
  window.scrollTo(0, 0);
  if (name === "cal") drawCal();
  if (name === "slots") drawSlots();
  if (name === "form") drawForm();
  if (name === "confirm") drawConfirm();
}

// ════════════════════════════════
//  カレンダー描画
// ════════════════════════════════
function drawCal() {
  const MN = [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ];
  document.getElementById("cal-month").textContent =
    `${S.year}年 ${MN[S.month]}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = getMaxDate();
  const first = new Date(S.year, S.month, 1).getDay();
  const dim = new Date(S.year, S.month + 1, 0).getDate();
  let h = "";
  for (let i = 0; i < first; i++) h += `<div class="cell empty"></div>`;
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(S.year, S.month, d),
      ds = fmtD(dt);
    const past = dt <= today;
    const beyond = dt > maxDate;
    const disabled = past || beyond;
    const isToday = dt.getTime() === today.getTime();
    const dow = dt.getDay();
    let cls = "cell";
    if (dow === 0) cls += " sun";
    if (dow === 6) cls += " sat";
    if (isToday) cls += " today";
    if (disabled) cls += " past";
    const a = S.avail[ds];
    let st = "";
    if (!disabled && a) {
      if (a.code === "ng") cls += " closed";
      st = `<span class="ds ${a.code}">${a.mark}</span>`;
    }
    const fn =
      !disabled && a && a.code !== "ng" ? `onclick="pickDate('${ds}')"` : "";
    h += `<div class="${cls}" ${fn}><span class="dn">${d}</span>${st}</div>`;
  }
  document.getElementById("cal-grid").innerHTML = h;

  // 前月・次月ボタンの有効/無効を制御
  const curYear = today.getFullYear();
  const curMonth = today.getMonth();
  document.getElementById("btn-prev-month").disabled =
    S.year === curYear && S.month === curMonth;
  document.getElementById("btn-next-month").disabled =
    S.year > maxDate.getFullYear() ||
    (S.year === maxDate.getFullYear() && S.month >= maxDate.getMonth());
}

function changeMonth(d) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();
  const maxDate = getMaxDate();

  let newMonth = S.month + d;
  let newYear = S.year;
  if (newMonth > 11) {
    newMonth = 0;
    newYear++;
  }
  if (newMonth < 0) {
    newMonth = 11;
    newYear--;
  }

  // 当月より前には戻れない
  if (newYear < curYear || (newYear === curYear && newMonth < curMonth))
    return;
  // maxDateの月より先には進めない
  if (newYear > maxDate.getFullYear() ||
      (newYear === maxDate.getFullYear() && newMonth > maxDate.getMonth()))
    return;

  S.year = newYear;
  S.month = newMonth;

  // 既にデータがあればそのまま描画
  const firstDay = `${S.year}-${p2(S.month + 1)}-01`;
  if (CFG.DEMO) {
    Object.assign(S.avail, mockMonth(S.year, S.month));
    drawCal();
  } else if (S.avail[firstDay] !== undefined) {
    drawCal();
  } else {
    drawCal();
    document.getElementById("overlay").classList.add("on");
    apiAvail(S.year, S.month).then((r) => {
      Object.assign(S.avail, r);
      drawCal();
      document.getElementById("overlay").classList.remove("on");
    }).catch(() => {
      document.getElementById("overlay").classList.remove("on");
      alert("空き状況の取得に失敗しました。通信環境をご確認のうえ、再度お試しください。");
    });
  }
}

function pickDate(ds) {
  S.date = ds;
  S.slot = null;
  S.type = null;
  S.num = 1;
  go("slots");
}

// ════════════════════════════════
//  時間帯描画
// ════════════════════════════════
function drawSlots() {
  document.getElementById("slot-date").textContent = dateLabel(S.date);
  const a = S.avail[S.date];
  if (!a) return;
  let h = "";
  Object.keys(a.slots)
    .sort()
    .forEach((k) => {
      const st = slotSt(a.slots[k]);
      const end = slotEnd(k);
      const dis = st.c === "ng" ? "disabled" : "";
      const fn = st.c !== "ng" ? `onclick="pickSlot('${k}')"` : "";
      h += `<div class="slot-card ${dis}" ${fn}>
  <div><div class="slot-time">${k} 〜 ${end}</div><div class="slot-dur">${slotLabel()}</div></div>
  <div class="slot-right">
    <span class="badge ${st.c}">${st.mark} ${st.text}</span>
    ${st.c === "wa" ? `<span class="slot-rem">グループ残り${st.rem}枠</span>` : ""}
  </div>
</div>`;
    });
  document.getElementById("slots-list").innerHTML = h;

  // 前日・翌日ボタンの有効/無効を制御
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = getMaxDate();
  const currentDate = new Date(S.date + "T00:00:00");

  const prevDate = new Date(currentDate);
  prevDate.setDate(prevDate.getDate() - 1);
  document.getElementById("btn-prev-day").disabled = prevDate <= today;

  const nextDate = new Date(currentDate);
  nextDate.setDate(nextDate.getDate() + 1);
  document.getElementById("btn-next-day").disabled = nextDate > maxDate;
}

function navigateDay(direction) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = getMaxDate();

  const current = new Date(S.date + "T00:00:00");
  const next = new Date(current);
  next.setDate(next.getDate() + direction);
  if (next <= today || next > maxDate) return;
  const nextDs = fmtD(next);

  function goToDay() {
    S.date = nextDs;
    S.slot = null;
    S.type = null;
    S.num = 1;
    S.year = next.getFullYear();
    S.month = next.getMonth();
    go("slots");
  }

  // データが既にあればそのまま遷移
  if (S.avail[nextDs]) {
    goToDay();
    return;
  }

  // 別の月のデータを取得してから遷移
  document.getElementById("overlay").classList.add("on");
  if (CFG.DEMO) {
    Object.assign(S.avail, mockMonth(next.getFullYear(), next.getMonth()));
    document.getElementById("overlay").classList.remove("on");
    goToDay();
  } else {
    apiAvail(next.getFullYear(), next.getMonth()).then((r) => {
      Object.assign(S.avail, r);
      document.getElementById("overlay").classList.remove("on");
      goToDay();
    }).catch(() => {
      document.getElementById("overlay").classList.remove("on");
    });
  }
}

function pickSlot(slot) {
  S.slot = slot;
  go("form");
}

// ════════════════════════════════
//  フォーム描画
// ════════════════════════════════
function drawForm() {
  const end = slotEnd(S.slot);
  document.getElementById("form-banner").innerHTML = `
<div class="brow"><span class="blabel">日付</span><span class="bval">${dateLabel(S.date)}</span></div>
<div class="brow"><span class="blabel">時間</span><span class="bval">${S.slot} 〜 ${end}（${slotLabel()}）</span></div>`;

  const a = S.avail[S.date];
  const st = slotSt(a ? a.slots[S.slot] : null);
  const empty = st.c === "ok";

  const lessons = [
    {
      id: "trial",
      name: "初回無料体験",
      tag: "無料",
      cls: "free",
      dis: !empty,
      desc: "はじめての方はこちら！お友達もご一緒に参加OK（最大4名）",
    },
    {
      id: "group",
      name: "グループレッスン",
      tag: `上限${CFG.MAX}名`,
      cls: "",
      dis: false,
      desc: `少人数レッスン（最大${CFG.MAX}名）`,
    },
    {
      id: "personal",
      name: "パーソナルレッスン",
      tag: "マンツーマン",
      cls: "",
      dis: !empty,
      desc: "1対1で集中してトレーニング",
    },
  ];
  document.getElementById("lesson-opts").innerHTML = lessons
    .map(
      (l) => `
<div class="lopt ${S.type === l.id ? "sel" : ""} ${l.dis ? "dis" : ""}" onclick="pickType('${l.id}')">
  <div class="lopt-head">
    <span class="lopt-name">${l.name}</span>
    <span class="lopt-tag ${l.cls}">${l.tag}</span>
  </div>
  <div class="lopt-desc">${l.desc}</div>
</div>`,
    )
    .join("");

  drawNumGrid(st.rem);
  document.getElementById("f-name").value = S.form.name;
  document.getElementById("f-furi").value = S.form.furi;
  document.getElementById("f-contact").value = S.form.contact;
}

function pickType(id) {
  S.type = id;
  if (id === "personal") S.num = 1;
  document.querySelectorAll(".lopt").forEach((el) => {
    const fn = el.getAttribute("onclick");
    el.classList.toggle("sel", fn === `pickType('${id}')`);
  });
  const a = S.avail[S.date];
  const st = slotSt(a ? a.slots[S.slot] : null);
  const showNum = id === "group" || id === "trial";
  document.getElementById("num-card").style.display = showNum
    ? "block"
    : "none";
  if (showNum) drawNumGrid(id === "group" ? st.rem : CFG.MAX);
}

function drawNumGrid(rem) {
  const nums = [];
  for (let i = 1; i <= CFG.MAX; i++) nums.push(i);
  document.getElementById("num-grid").innerHTML = nums
    .map(
      (n) => `
  <button class="nbtn ${S.num === n ? "sel" : ""}" ${n > rem ? "disabled" : ""} onclick="pickNum(${n})">${n}人</button>
`,
    )
    .join("");
  document.getElementById("num-note").textContent =
    `※ お友達やご家族での参加もOK（上限${CFG.MAX}名まで）`;
}

function pickNum(n) {
  S.num = n;
  document
    .querySelectorAll(".nbtn")
    .forEach((b, i) => b.classList.toggle("sel", i + 1 === n));
}

function sanitizePhone(el) {
  const pos = el.selectionStart;
  const prev = el.value;
  el.value = prev.replace(/\D/g, "").slice(0, 15);
  const diff = prev.length - el.value.length;
  el.setSelectionRange(pos - diff, pos - diff);
}

function clearE(fid, eid) {
  document.getElementById(fid).classList.remove("err");
  document.getElementById(eid).style.display = "none";
}
function showE(fid, eid, msg) {
  document.getElementById(fid).classList.add("err");
  const e = document.getElementById(eid);
  e.textContent = msg;
  e.style.display = "block";
}

function toConfirm() {
  S.form.name = document.getElementById("f-name").value.trim();
  S.form.furi = document.getElementById("f-furi").value.trim();
  S.form.contact = document.getElementById("f-contact").value.trim();
  let err = false;
  if (!S.type) {
    alert("レッスン種別をお選びください");
    return;
  }
  if (!S.form.name) {
    showE("f-name", "err-name", "お名前を入力してください");
    err = true;
  }
  if (!S.form.furi) {
    showE("f-furi", "err-furi", "フリガナを入力してください");
    err = true;
  } else if (!/^[ァ-ヶー\s　]+$/.test(S.form.furi)) {
    showE("f-furi", "err-furi", "カタカナで入力してください");
    err = true;
  }
  if (!S.form.contact) {
    showE("f-contact", "err-contact", "電話番号を入力してください");
    err = true;
  } else if (!/^0\d{9,10}$/.test(S.form.contact)) {
    showE("f-contact", "err-contact", "電話番号の形式が正しくありません（0から始まる10〜11桁）");
    err = true;
  }
  if (!err) go("confirm");
}

// ════════════════════════════════
//  確認画面描画
// ════════════════════════════════
function drawConfirm() {
  const end = slotEnd(S.slot);
  const rows = [
    { l: "日付", v: dateLabel(S.date) },
    { l: "時間", v: `${S.slot} 〜 ${end}（${slotLabel()}）` },
    { l: "レッスン", v: typeLabel(S.type) },
    {
      l: "来店人数",
      v: S.type === "personal" ? "1名（マンツーマン）" : `${S.num}名`,
    },
    { l: "お名前", v: `${esc(S.form.name)}（${esc(S.form.furi)}）` },
    { l: "電話番号", v: esc(S.form.contact) },
  ];
  document.getElementById("cfm-rows").innerHTML = rows
    .map(
      (r) =>
        `<div class="crow"><span class="clabel">${r.l}</span><span class="cval">${r.v}</span></div>`,
    )
    .join("");
}

// ════════════════════════════════
//  送信
// ════════════════════════════════
async function submit() {
  const btn = document.getElementById("btn-cfm");
  btn.disabled = true;
  btn.textContent = "送信中...";
  let cid;
  if (CFG.DEMO) {
    await new Promise((r) => setTimeout(r, 1000));
    cid = String(Math.floor(Math.random() * 9000) + 1000);
    // モックデータ更新
    const s = S.avail[S.date]?.slots[S.slot];
    if (s) {
      if (S.type === "trial") s.hasT = true;
      else if (S.type === "personal") s.hasP = true;
      else s.n = Math.min(s.n + S.num, CFG.MAX);
    }
  } else {
    try {
      const res = await apiBook({
        date: S.date,
        slot: S.slot,
        lesson: S.type,
        numPeople: S.type === "personal" ? 1 : S.num,
        name: S.form.name,
        furigana: S.form.furi,
        contact: S.form.contact,
      });
      if (CFG.DEMO) console.log("apiBook parsed response:", res);
      if (!res || res.error) {
        alert(res?.error || "予約処理中にエラーが発生しました");
        btn.disabled = false;
        btn.textContent = "この内容で予約を確定する";
        return;
      }
      cid = res.confirmId || res.confirmid || res.id;
      if (!cid) {
        if (CFG.DEMO) console.log("confirmId not found in response keys:", Object.keys(res));
        alert("予約は受け付けましたが、予約番号の取得に失敗しました。スプレッドシートをご確認ください。");
        btn.disabled = false;
        btn.textContent = "この内容で予約を確定する";
        return;
      }
    } catch (e) {
      if (CFG.DEMO) console.log("apiBook error:", e);
      alert("通信エラーが発生しました。もう一度お試しください。");
      btn.disabled = false;
      btn.textContent = "この内容で予約を確定する";
      return;
    }
  }
  S.id = cid;
  drawSuccess();
  go("success");
}

// ════════════════════════════════
//  完了画面描画
// ════════════════════════════════
function drawSuccess() {
  document.getElementById("cfm-num").textContent = `#${S.id}`;
  const end = slotEnd(S.slot);
  document.getElementById("suc-detail").innerHTML = [
    { l: "日付", v: dateLabel(S.date) },
    { l: "時間", v: `${S.slot} 〜 ${end}` },
    { l: "レッスン", v: typeLabel(S.type) },
    { l: "お名前", v: esc(S.form.name) },
  ]
    .map(
      (r) =>
        `<div class="srow"><span class="slabel">${r.l}</span><span class="sval">${r.v}</span></div>`,
    )
    .join("");
}

// ════════════════════════════════
//  起動
// ════════════════════════════════
async function init() {
  if (CFG.DEMO) {
    S.avail = mockMonth(S.year, S.month);
  } else {
    try {
      S.avail = await apiAvail(S.year, S.month);
    } catch (e) {
      document.getElementById("loading").innerHTML =
        '<div style="text-align:center;padding:20px;color:var(--text);font-size:14px;line-height:1.8;">'
        + '<div style="font-size:40px;margin-bottom:12px;">⚠️</div>'
        + '<strong>データの取得に失敗しました</strong><br>'
        + '通信環境をご確認のうえ<br>ページを再読み込みしてください。'
        + '</div>';
      return;
    }
  }
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "block";
  go("cal");
}

window.addEventListener("DOMContentLoaded", init);
