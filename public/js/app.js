// ============================================================
//  북부 경찰서 인트라넷 · 프론트엔드 로직
// ============================================================

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const state = { me: null, announcements: [], warnings: [], reports: [], meta: null };

// ---------- 메타데이터 (직급/카테고리) ----------
async function loadMeta() {
  if (state.meta) return state.meta;
  try {
    state.meta = await api("GET", "/api/meta");
  } catch (e) {
    state.meta = { tiers: [], categories: ["공지사항"], defaultRank: "" };
  }
  // 가입 폼 직급 선택 채우기 (티어별 그룹)
  const rankSel = document.querySelector("#reg-rank");
  if (rankSel && state.meta.tiers) {
    rankSel.innerHTML =
      '<option value="" disabled selected>직급을 선택하세요</option>' +
      state.meta.tiers
        .map(
          (t) =>
            `<optgroup label="${t.icon} ${escAttr(t.label)}">` +
            t.ranks.map((r) => `<option value="${escAttr(r)}">${escAttr(r)}</option>`).join("") +
            `</optgroup>`
        )
        .join("");
  }
  // 공지 카테고리 채우기
  const catSel = document.querySelector("#post-category");
  if (catSel && state.meta.categories) {
    catSel.innerHTML = state.meta.categories
      .map((c) => `<option value="${escAttr(c)}">${escAttr(c)}</option>`)
      .join("");
  }
  // 보고서 종류 채우기
  const repSel = document.querySelector("#rep-category");
  if (repSel && state.meta.reportCategories) {
    repSel.innerHTML = state.meta.reportCategories
      .map((c) => `<option value="${escAttr(c)}">${escAttr(c)}</option>`)
      .join("");
  }

  // 가입 폼 팀 선택 채우기
  const teamSel = document.querySelector("#reg-team");
  if (teamSel && state.meta.teams) {
    teamSel.innerHTML =
      '<option value="">팀 없음</option>' +
      state.meta.teams.map((t) => `<option value="${escAttr(t.key)}">${escAttr(t.name)}</option>`).join("");
  }
  const teamRoleSel = document.querySelector("#reg-teamrole");
  if (teamRoleSel && state.meta.teamRoles) {
    teamRoleSel.innerHTML = state.meta.teamRoles.map((r) => `<option value="${escAttr(r)}">${escAttr(r)}</option>`).join("");
  }
  // 휴가 종류 채우기
  const lvSel = document.querySelector("#lv-type");
  if (lvSel && state.meta.leaveTypes) {
    lvSel.innerHTML = state.meta.leaveTypes.map((t) => `<option value="${escAttr(t)}">${escAttr(t)}</option>`).join("");
  }
  // 디스코드 로그인 버튼 노출
  const dlw = document.querySelector("#discord-login-wrap");
  if (dlw) dlw.classList.toggle("hidden", !state.meta.discordLoginEnabled);
  // 보고서 폼 초기 구성 (로또/주식 동적 필드)
  if (document.querySelector("#rep-category") && typeof configureReportForm === "function") configureReportForm();
  return state.meta;
}
const escAttr = (s) => String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// 금액 포맷 (천단위 콤마 + 단위)
function won(n) {
  const unit = (state.meta && state.meta.currencyUnit) || "원";
  return Number(n || 0).toLocaleString("ko-KR") + unit;
}

// ---------- API 헬퍼 ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

// ---------- 토스트 ----------
function toast(msg, type = "") {
  const wrap = $("#toast");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s, transform .3s";
    t.style.opacity = "0";
    t.style.transform = "translateY(10px)";
    setTimeout(() => t.remove(), 320);
  }, 2600);
}

// ---------- 모달 ----------
function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

// ---------- 날짜 유틸 ----------
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtFull = (iso) => { const d = new Date(iso); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function dur(a, b) {
  const m = Math.max(0, Math.floor((new Date(b) - new Date(a)) / 60000));
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

// ============================================================
//  배경 낙엽 애니메이션
// ============================================================
// ============================================================
//  배경 낙엽 효과 (캔버스)
// ============================================================
(function leaves() {
  const cv = $("#leaves");
  const ctx = cv.getContext("2d");
  let W, H, items = [];
  const COLORS = ["#E8772E", "#F2A93B", "#C75B1E", "#D98C2B", "#B8541C", "#E0A84B"];

  function resize() {
    W = cv.width = window.innerWidth;
    H = cv.height = window.innerHeight;
    const count = Math.round((W * H) / 95000); // 화면 크기에 비례
    items = Array.from({ length: Math.min(22, Math.max(8, count)) }, spawn);
  }
  function spawn() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      s: 9 + Math.random() * 14,
      vy: 0.25 + Math.random() * 0.55,
      vx: -0.3 + Math.random() * 0.6,
      rot: Math.random() * Math.PI * 2,
      vr: -0.012 + Math.random() * 0.024,
      sway: Math.random() * Math.PI * 2,
      sw: 0.005 + Math.random() * 0.012,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      a: 0.35 + Math.random() * 0.35,
    };
  }
  function leafPath(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.moveTo(0, -p.s);
    ctx.quadraticCurveTo(p.s * 0.7, 0, 0, p.s);
    ctx.quadraticCurveTo(-p.s * 0.7, 0, 0, -p.s);
    ctx.fill();
    // 잎맥
    ctx.globalAlpha = p.a * 0.5;
    ctx.strokeStyle = "rgba(120,60,20,.7)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -p.s);
    ctx.lineTo(0, p.s);
    ctx.stroke();
    ctx.restore();
  }
  function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of items) {
      p.sway += p.sw;
      p.x += p.vx + Math.sin(p.sway) * 0.5;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y - p.s > H) { Object.assign(p, spawn(), { y: -20 }); }
      if (p.x < -30) p.x = W + 30;
      if (p.x > W + 30) p.x = -30;
      leafPath(p);
    }
    requestAnimationFrame(tick);
  }
  window.addEventListener("resize", resize);
  resize();
  tick();
})();

// ============================================================
//  실시간 시계
// ============================================================
setInterval(() => {
  const t = $("#clock-time"), d = $("#clock-date");
  if (!t || $("#view-dashboard").classList.contains("hidden")) return;
  const n = new Date();
  t.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
  d.textContent = `${n.getFullYear()}년 ${n.getMonth() + 1}월 ${n.getDate()}일 (${WD[n.getDay()]})`;
}, 1000);

// ============================================================
//  뷰 라우팅
// ============================================================
function show(view) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(view).classList.remove("hidden");
}

// ---------- 대시보드 페이지 전환 (메뉴별 따로) ----------
function setPage(key) {
  if (key === "admin" && !(state.me && state.me.isAdmin)) key = "attendance";
  $$(".dash-page").forEach((p) => p.classList.toggle("active", p.dataset.page === key));
  $$(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.page === key));
  // 페이지 전환 시 상단으로
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
}
$$(".nav-link").forEach((a) =>
  a.addEventListener("click", (e) => { e.preventDefault(); setPage(a.dataset.page); })
);
$$("[data-goto]").forEach((el) =>
  el.addEventListener("click", (e) => { e.preventDefault(); setPage(el.dataset.goto); })
);

async function refresh() {
  await loadMeta();
  let data;
  try { data = await api("GET", "/api/me"); }
  catch (e) { data = { user: null }; }
  state.me = data.user;

  if (!state.me) { $("#topbar").classList.add("hidden"); $("#notif-panel").classList.add("hidden"); show("#view-auth"); return; }

  if (state.me.status !== "approved") {
    $("#topbar").classList.add("hidden");
    $("#pending-name").textContent = state.me.username;
    $("#pending-gobun").textContent = state.me.gobun || "-";
    show("#view-pending");
    return;
  }

  // 승인된 회원 → 대시보드
  $("#topbar").classList.remove("hidden");
  renderUserChip();
  show("#view-dashboard");
  $("#nav-admin").classList.toggle("hidden", !state.me.isAdmin);
  $("#sec-admin").classList.toggle("hidden", !state.me.isAdmin);
  $("#btn-new-notice").classList.toggle("hidden", !state.me.isAdmin);
  setPage("home");
  await loadDashboard();
  startAlarmPolling();
  // 알람 설정 UI 갱신 + (권한·알람 ON 이면) 백그라운드 푸시 재구독
  syncAlarmUI();
  if (alarmOn() && pushSupported() && Notification.permission === "granted") subscribePush();
}

function renderUserChip() {
  const m = state.me;
  $("#chip-icon").textContent = m.tierIcon;
  $("#chip-name").textContent = m.username;
  $("#chip-rank").textContent = m.teamTitle ? `${m.rank} · ${m.teamTitle}` : m.rank;
  $("#hero-name").textContent = `${m.username} 님`;
  $("#hero-icon").textContent = m.tierIcon;
  $("#hero-rankname").textContent = m.rank;
  $("#hero-tier").textContent = m.teamTitle ? `${m.tier} · ${m.teamTitle}` : m.tier;
  // 알람 벨
  const c = m.unread || 0;
  const bc = $("#bell-count");
  bc.textContent = c;
  bc.classList.toggle("hidden", c === 0);
  if (c > 0) { $("#bell").classList.add("ring"); setTimeout(() => $("#bell").classList.remove("ring"), 900); }
}

// ============================================================
//  대시보드 데이터 로드
// ============================================================
async function loadDashboard() {
  renderAttendance();
  try {
    const [ann, warn, roster, reports] = await Promise.all([
      api("GET", "/api/announcements"),
      api("GET", "/api/warnings"),
      api("GET", "/api/roster"),
      api("GET", "/api/reports"),
    ]);
    state.announcements = ann.announcements;
    state.warnings = warn.warnings;
    state.reports = reports.reports;
    renderNotices(ann.announcements);
    renderWarnings(warn.warnings);
    renderRoster(roster);
    renderMyReports(reports.reports);
    renderNotifList();
    loadHome();
    loadLeaves();
  } catch (e) { toast(e.message, "err"); }

  if (state.me.isAdmin) loadAdmin();
}

// ---------- 홈 대시보드 ----------
async function loadHome() {
  try { const d = await api("GET", "/api/dashboard"); renderHome(d); }
  catch (e) {}
}
function fmtDuration(min) {
  min = Math.max(0, Math.round(min || 0));
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}시간 ${m}분`;
}
function renderHome(d) {
  const org = d.org || {}, me = d.me || {};
  $("#st-working").textContent = org.workingNow || 0;
  $("#st-members").textContent = org.totalMembers || 0;
  $("#st-today").textContent = org.todayAttended || 0;
  $("#st-myreports").textContent = me.reportCount || 0;

  $("#hm-week").textContent = fmtDuration(me.weekMinutes);
  $("#hm-sales").textContent = (me.reportPoints || 0) + "점";
  $("#hm-reports").textContent = (me.reportCount || 0) + "건";
  $("#hm-warn").textContent = (me.warningCount || 0) + "건";

  // 점수 순위
  const ol = $("#home-sellers");
  const board = d.topSellers || [];
  if (!board.length) { ol.innerHTML = '<li class="muted">아직 RP 보고서가 없습니다.</li>'; }
  else {
    const medals = ["🥇", "🥈", "🥉"];
    ol.innerHTML = board
      .map((e, i) => `<li class="seller-item ${state.me && e.userId === state.me.id ? "me" : ""}">
        <span class="seller-rankno">${medals[i] || "#" + (i + 1)}</span>
        <span class="seller-name"><b>${esc(e.username)}</b><i>${esc(e.rank || "")}</i></span>
        <span class="seller-amt">${e.totalPoints}점<small>${e.wins || 0}승 ${e.losses || 0}패</small></span>
      </li>`)
      .join("");
  }

  // 최신 공지
  const nb = $("#home-notice");
  const a = d.latestAnnouncement;
  if (!a) { nb.innerHTML = '<p class="muted">공지가 없습니다.</p>'; }
  else {
    const warn = a.type === "warning";
    nb.innerHTML = `<div class="home-notice-item ${warn ? "is-warning" : ""}">
      <div class="hn-title"><span class="tag ${warn ? "warning" : "cat"}">${esc(warn ? "경고" : (a.category || "공지사항"))}</span>${esc(a.title)}</div>
      <div class="hn-meta">${esc(a.author || "")} · ${fmtFull(a.createdAt)}</div>
    </div>`;
  }

  // 관리자 알림
  const adminBox = $("#home-admin");
  if (d.admin) {
    adminBox.classList.remove("hidden");
    $("#ha-pending").querySelector("b").textContent = d.admin.pendingCount || 0;
    $("#ha-leave").querySelector("b").textContent = d.admin.pendingLeaves || 0;
    $("#ha-kick").querySelector("b").textContent = d.admin.kickReviewCount || 0;
    $("#ha-kick").classList.toggle("hidden", (d.admin.kickReviewCount || 0) === 0);
  } else {
    adminBox.classList.add("hidden");
  }
}

// ---------- 휴가 신청 ----------
const fmtDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const LEAVE_STATUS = { pending: { t: "대기", c: "status-pending" }, approved: { t: "승인", c: "status-approved" }, rejected: { t: "거절", c: "status-rejected" } };

async function loadLeaves() {
  try { const d = await api("GET", "/api/leaves"); renderLeaves(d.leaves); } catch (e) {}
}
function renderLeaves(list) {
  const ul = $("#leave-list");
  if (!ul) return;
  if (!list.length) { ul.innerHTML = '<li class="muted">신청 내역이 없습니다.</li>'; return; }
  ul.innerHTML = list
    .map((l) => {
      const s = LEAVE_STATUS[l.status] || LEAVE_STATUS.pending;
      return `<li class="leave-item">
        <div class="lv-top">
          <span class="tag cat">${esc(l.type)}</span>
          <b class="lv-range">${esc(l.startDate)} ~ ${esc(l.endDate)}</b>
          <span class="status-badge ${s.c}">${s.t}</span>
        </div>
        <p class="lv-reason">${esc(l.reason)}</p>
        <div class="lv-meta">
          <span>${fmtFull(l.createdAt)}${l.decidedBy ? ` · 처리: ${esc(l.decidedBy)}` : ""}</span>
          ${l.status === "pending" ? `<button class="lv-cancel" data-lv-cancel="${l.id}">신청 취소</button>` : ""}
        </div>
      </li>`;
    })
    .join("");
  $$("[data-lv-cancel]", ul).forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("이 휴가 신청을 취소할까요?")) return;
      try { await api("DELETE", "/api/leaves/" + b.dataset.lvCancel); toast("취소되었습니다.", "ok"); loadLeaves(); if (state.me.isAdmin) loadAdminLeaves(); }
      catch (e) { toast(e.message, "err"); }
    })
  );
}
$("#form-leave").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#leave-msg"); msg.textContent = ""; msg.className = "form-msg";
  const body = { type: $("#lv-type").value, startDate: $("#lv-start").value, endDate: $("#lv-end").value, reason: $("#lv-reason").value };
  if (!body.startDate || !body.endDate) { msg.textContent = "시작일과 종료일을 입력해 주세요."; msg.classList.add("error"); return; }
  if (body.endDate < body.startDate) { msg.textContent = "종료일이 시작일보다 빠를 수 없습니다."; msg.classList.add("error"); return; }
  try {
    await api("POST", "/api/leaves", body);
    $("#lv-reason").value = "";
    msg.textContent = "휴가 신청이 접수되었습니다."; msg.classList.add("ok");
    toast("휴가 신청이 접수되었습니다.", "ok");
    loadLeaves(); if (state.me.isAdmin) loadAdminLeaves();
  } catch (err) { msg.textContent = err.message; msg.classList.add("error"); }
});

// ---------- 관리자: 휴가 승인 ----------
async function loadAdminLeaves() {
  try { const d = await api("GET", "/api/admin/leaves"); renderAdminLeaves(d.leaves, d.pendingCount); } catch (e) {}
}
function renderAdminLeaves(list, pending) {
  const badge = $("#leave-badge");
  if (badge) { badge.textContent = pending || 0; badge.classList.toggle("hidden", (pending || 0) === 0); }
  const ul = $("#admin-leave-list");
  if (!ul) return;
  if (!list.length) { ul.innerHTML = '<li class="muted">휴가 신청이 없습니다.</li>'; return; }
  ul.innerHTML = list
    .map((l) => {
      const s = LEAVE_STATUS[l.status] || LEAVE_STATUS.pending;
      return `<li class="leave-item admin">
        <div class="lv-top">
          <b>${esc(l.username)}</b> <span class="muted">${esc(l.rank || "")}</span>
          <span class="tag cat">${esc(l.type)}</span>
          <span class="lv-range">${esc(l.startDate)} ~ ${esc(l.endDate)}</span>
          <span class="status-badge ${s.c}">${s.t}</span>
        </div>
        <p class="lv-reason">${esc(l.reason)}</p>
        <div class="lv-meta">
          <span>${fmtFull(l.createdAt)}${l.decidedBy ? ` · 처리: ${esc(l.decidedBy)}` : ""}</span>
          ${l.status === "pending" ? `<span class="lv-actions"><button class="ico-btn good" data-lv-ok="${l.id}">승인</button><button class="ico-btn danger" data-lv-no="${l.id}">거절</button></span>` : ""}
        </div>
      </li>`;
    })
    .join("");
  $$("[data-lv-ok]", ul).forEach((b) => b.addEventListener("click", () => decideLeave(b.dataset.lvOk, "approved")));
  $$("[data-lv-no]", ul).forEach((b) => b.addEventListener("click", () => decideLeave(b.dataset.lvNo, "rejected")));
}
async function decideLeave(id, decision) {
  try {
    await api("POST", `/api/admin/leaves/${id}/decision`, { decision });
    toast(decision === "approved" ? "휴가를 승인했습니다." : "휴가를 거절했습니다.", "ok");
    loadAdminLeaves(); loadLeaves(); loadHome();
  } catch (e) { toast(e.message, "err"); }
}

// ---------- 관리자: 디스코드 연동 ----------
async function loadSettings() {
  try {
    const d = await api("GET", "/api/admin/settings");
    const inp = $("#discord-webhook"); if (inp) inp.value = d.discordWebhook || "";
    setDiscordStatus(d.discordConfigured);
    // OAuth 상태
    const yn = (b) => (b ? "✅ 설정됨" : "❌ 미설정");
    if ($("#st-clientid")) $("#st-clientid").textContent = yn(d.discordClientIdSet);
    if ($("#st-secret")) $("#st-secret").textContent = yn(d.discordSecretSet);
    if ($("#st-login")) $("#st-login").textContent = d.discordLoginEnabled ? "✅ 켜짐" : "❌ 꺼짐";
    if ($("#st-bot")) $("#st-bot").textContent = yn(d.discordBotTokenSet);
    if ($("#discord-redirect")) $("#discord-redirect").value = d.discordRedirectUri || "";
    if ($("#discord-guild")) $("#discord-guild").value = d.discordGuildId || "";
    renderRoleMap(d.ranks || [], d.discordRoleMap || {});
  } catch (e) {}
}
function setDiscordStatus(on, msg) {
  const st = $("#discord-status"); if (!st) return;
  st.textContent = msg || (on ? "● 연동됨" : "○ 미연동");
  st.className = "settings-status " + (on ? "on" : "");
}
function renderRoleMap(ranks, map) {
  const box = $("#role-map-rows"); if (!box) return;
  box.innerHTML = ranks
    .map((r) => `<div class="role-map-row"><span class="rm-rank">${esc(r)}</span><input type="text" class="rm-input" data-rank="${escAttr(r)}" value="${escAttr(map[r] || "")}" placeholder="역할 ID (비우면 미부여)" autocomplete="off" /></div>`)
    .join("");
}
$("#discord-save").addEventListener("click", async () => {
  const url = $("#discord-webhook").value.trim();
  try {
    const r = await api("POST", "/api/admin/settings", { discordWebhook: url });
    toast(url ? "디스코드 웹훅을 저장했습니다." : "디스코드 연동을 해제했습니다.", "ok");
    setDiscordStatus(r.discordConfigured);
  } catch (e) { toast(e.message, "err"); setDiscordStatus(false, "저장 실패"); }
});
$("#discord-test").addEventListener("click", async () => {
  setDiscordStatus(true, "전송 중…");
  try {
    await api("POST", "/api/admin/settings/test-discord", {});
    toast("디스코드로 테스트 메시지를 보냈습니다. 채널을 확인하세요!", "ok");
    setDiscordStatus(true, "● 전송 성공");
  } catch (e) { toast(e.message, "err"); setDiscordStatus(false, "전송 실패"); }
});
$("#discord-sync-save").addEventListener("click", async () => {
  const guild = $("#discord-guild").value.trim();
  const map = {};
  $$(".rm-input").forEach((i) => { const v = i.value.trim(); if (v) map[i.dataset.rank] = v; });
  const st = $("#discord-sync-status");
  try {
    await api("POST", "/api/admin/settings", { discordGuildId: guild, discordRoleMap: map });
    toast("서버·역할 설정을 저장했습니다.", "ok");
    if (st) { st.textContent = "● 저장됨"; st.className = "settings-status on"; }
  } catch (e) { toast(e.message, "err"); if (st) { st.textContent = "저장 실패"; st.className = "settings-status"; } }
});

// 디스코드 OAuth 리다이렉트 결과 안내
(function handleDiscordRedirect() {
  const p = new URLSearchParams(location.search);
  const d = p.get("discord");
  if (!d) return;
  const msgs = {
    linked: ["디스코드 연동이 완료되었습니다.", "ok"],
    login: ["디스코드로 로그인했습니다.", "ok"],
    pending: ["가입 신청이 접수되었습니다. 관리자 승인 후 디스코드로 로그인할 수 있어요.", "ok"],
    rejected: ["가입이 거절된 계정입니다.", "err"],
    conflict: ["이미 다른 계정에 연동된 디스코드입니다.", "err"],
    state: ["인증 세션이 만료되었습니다. 다시 시도해 주세요.", "err"],
    token: ["디스코드 인증에 실패했습니다.", "err"],
    me: ["디스코드 정보를 가져오지 못했습니다.", "err"],
    disabled: ["디스코드 로그인이 비활성화되어 있습니다.", "err"],
    error: ["디스코드 처리 중 오류가 발생했습니다.", "err"],
  };
  const m = msgs[d];
  if (m) setTimeout(() => toast(m[0], m[1]), 400);
  history.replaceState(null, "", location.pathname);
})();

// ---------- 개인 프로필 ----------
async function openProfile(userId) {
  if (!userId) return;
  setPage("profile");
  const box = $("#profile-body");
  box.innerHTML = '<p class="muted">프로필을 불러오는 중…</p>';
  try { const d = await api("GET", "/api/profile/" + userId); renderProfile(d.profile); }
  catch (e) { box.innerHTML = '<p class="muted">프로필을 불러올 수 없습니다.</p>'; }
}
function renderProfile(p) {
  const box = $("#profile-body");
  const badge = p.isOwner ? '<span class="owner-badge">👑 소유자</span>' : (p.isAdmin ? '<span class="crown">👑 관리자</span>' : "");
  const work = p.isWorking ? '<span class="pf-work on">● 근무중</span>' : '<span class="pf-work">● 퇴근</span>';
  const attHtml = (p.recentAttendance && p.recentAttendance.length)
    ? `<div class="pf-section"><h4>최근 근태</h4><ul class="pf-att">${p.recentAttendance.map((r) => `<li><span>${fmtFull(r.clockIn)}</span><b>${r.clockOut ? fmtDuration(r.minutes) : "근무중"}</b></li>`).join("")}</ul></div>`
    : "";
  const warnsHtml = p.warnings === null
    ? ""
    : (p.warnings.length
        ? `<div class="pf-section"><h4>경고 내역 (${p.warnings.length})</h4><ul class="pf-warns">${p.warnings.map((w) => `<li><span class="pf-wlv lv${w.level}">${w.level}단계</span><span class="pf-wreason">${esc(w.reason)}</span><i>${fmtFull(w.createdAt)}</i></li>`).join("")}</ul></div>`
        : `<div class="pf-section"><h4>경고 내역</h4><p class="muted">경고 없음 👍</p></div>`);
  // 디스코드 연동
  let discordHtml = "";
  const loginOn = state.meta && state.meta.discordLoginEnabled;
  if (p.discordLinked) {
    const av = p.discordAvatar ? `<img class="pf-dc-avatar" src="${escAttr(p.discordAvatar)}" alt="" />` : '<span class="pf-dc-avatar ph">🎮</span>';
    discordHtml = `<div class="pf-section"><h4>디스코드</h4><div class="pf-discord linked">
      ${av}<b>${esc(p.discordUsername || "연동됨")}</b>
      ${p.isMe ? '<button id="pf-discord-unlink" class="lv-cancel">연동 해제</button>' : '<span class="pf-dc-ok">✔ 연동됨</span>'}
    </div></div>`;
  } else if (p.isMe && loginOn) {
    discordHtml = `<div class="pf-section"><h4>디스코드</h4><div class="pf-discord">
      <span class="muted">아직 연동되지 않았습니다.</span>
      <a href="/api/auth/discord" class="btn-discord sm">디스코드 연동하기</a>
    </div></div>`;
  }
  box.innerHTML = `
    <div class="pf-head">
      <div class="pf-avatar">${esc(p.tierIcon || "•")}</div>
      <div class="pf-id">
        <div class="pf-name">${esc(p.username)} ${badge}</div>
        <div class="pf-rank">${esc(p.rank)}${p.teamTitle ? ` · <span class="pf-team">${esc(p.teamIcon || "")} ${esc(p.teamTitle)}</span>` : ""}</div>
        <div class="pf-sub">${esc(p.tier)} · 고번 ${esc(p.gobun || "-")} · 가입 ${fmtDay(p.createdAt)} · ${work}</div>
      </div>
    </div>
    <div class="pf-stats">
      <div class="pf-stat"><b>${p.stats.reportCount}</b><span>보고서</span></div>
      <div class="pf-stat"><b>${p.stats.reportPoints || 0}점</b><span>RP 점수</span></div>
      <div class="pf-stat"><b>${fmtDuration(p.stats.totalMinutes)}</b><span>누적 근무</span></div>
      <div class="pf-stat ${p.stats.warningCount > 0 ? "warn" : ""}"><b>${p.stats.warningCount}</b><span>경고</span></div>
    </div>
    ${discordHtml}
    ${attHtml}
    ${warnsHtml}
  `;
  const unlinkBtn = $("#pf-discord-unlink");
  if (unlinkBtn) unlinkBtn.addEventListener("click", async () => {
    if (!confirm("디스코드 연동을 해제할까요? (연동으로 받은 역할도 회수됩니다)")) return;
    try {
      const r = await api("POST", "/api/discord/unlink", {});
      if (r.user) state.me = r.user;
      toast("디스코드 연동을 해제했습니다.", "ok");
      openProfile(p.id);
    } catch (e) { toast(e.message, "err"); }
  });
}
$("#profile-back").addEventListener("click", () => setPage("home"));
$("#user-chip").addEventListener("click", () => { if (state.me) openProfile(state.me.id); });

// ---------- 근태 ----------
function renderAttendance() {
  const m = state.me;
  const badge = $("#att-status");
  badge.className = "att-badge " + (m.isWorking ? "on" : "off");
  badge.textContent = m.isWorking ? "근무중" : "퇴근 상태";
  $("#btn-in").disabled = m.isWorking;
  $("#btn-out").disabled = !m.isWorking;

  const today = new Date().toDateString();
  const recs = (m.attendance || []).filter((r) => new Date(r.clockIn).toDateString() === today);
  if (!recs.length) $("#att-today-val").textContent = "기록 없음";
  else {
    const r = recs[0];
    $("#att-today-val").textContent =
      `${fmtTime(r.clockIn)} 출근` + (r.clockOut ? ` · ${fmtTime(r.clockOut)} 퇴근` : " · 근무중");
  }

  const log = $("#att-log-list");
  if (!m.attendance || !m.attendance.length) log.innerHTML = '<li class="muted">기록이 없습니다.</li>';
  else
    log.innerHTML = m.attendance
      .slice(0, 8)
      .map((r) => {
        const right = r.clockOut
          ? `${fmtTime(r.clockIn)} – ${fmtTime(r.clockOut)} <span class="dur">${dur(r.clockIn, r.clockOut)}</span>`
          : `${fmtTime(r.clockIn)} – <span class="dur">근무중</span>`;
        return `<li><span>${fmtDate(r.clockIn)}</span><span>${right}</span></li>`;
      })
      .join("");
}

$("#btn-in").addEventListener("click", async () => {
  try { const r = await api("POST", "/api/attendance/clock-in"); state.me = r.user; renderAttendance(); toast("출근 처리되었습니다.", "ok"); reloadRoster(); }
  catch (e) { toast(e.message, "err"); }
});
$("#btn-out").addEventListener("click", async () => {
  try { const r = await api("POST", "/api/attendance/clock-out"); state.me = r.user; renderAttendance(); toast("퇴근 처리되었습니다.", "ok"); reloadRoster(); }
  catch (e) { toast(e.message, "err"); }
});

async function reloadRoster() {
  try { renderRoster(await api("GET", "/api/roster")); } catch (e) {}
}

// ---------- 공지 ----------
function renderNotices(list) {
  const ul = $("#notice-list");
  if (!list.length) { ul.innerHTML = '<li class="muted">공지가 없습니다.</li>'; return; }
  const isAdmin = state.me.isAdmin;
  ul.innerHTML = list
    .map((a) => {
      const warn = a.type === "warning";
      const tagText = warn ? "경고" : (a.category || "공지사항");
      return `<li class="notice-item ${warn ? "is-warning" : ""}">
        ${isAdmin ? `<button class="notice-del" data-del="${a.id}" title="삭제">✕</button>` : ""}
        <div class="notice-top">
          <span class="notice-title"><span class="tag ${warn ? "warning" : "cat"}">${esc(tagText)}</span>${esc(a.title)}</span>
        </div>
        ${a.body ? `<p class="notice-body">${esc(a.body)}</p>` : ""}
        <div class="notice-meta"><span>${esc(a.author)}</span><span>${fmtFull(a.createdAt)}</span></div>
      </li>`;
    })
    .join("");
  $$("[data-del]", ul).forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("이 공지를 삭제할까요?")) return;
      try { await api("DELETE", "/api/announcements/" + b.dataset.del); toast("삭제되었습니다.", "ok"); const r = await api("GET", "/api/announcements"); state.announcements = r.announcements; renderNotices(r.announcements); renderNotifList(); }
      catch (e) { toast(e.message, "err"); }
    })
  );
}

// ---------- 경고 ----------
function renderWarnings(list) {
  $("#warn-total").textContent = list.length + "건";
  const ul = $("#warn-list");
  if (!list.length) { ul.innerHTML = '<li class="muted">경고 기록이 없습니다.</li>'; return; }
  ul.innerHTML = list
    .map((w) => {
      const dots = [1, 2, 3].map((i) => `<span class="w-dot ${i <= w.level ? "on" : ""}"></span>`).join("");
      return `<li class="warn-item">
        <div class="w-top"><b>${w.level}단계 경고</b><span class="w-level">${dots}</span></div>
        <p class="w-reason">${esc(w.reason)}</p>
        <p class="w-meta">발부: ${esc(w.issuedBy)} · ${fmtFull(w.createdAt)}</p>
      </li>`;
    })
    .join("");
}

// ---------- 직급표 ----------
function renderRoster(data) {
  $("#roster-total").textContent = data.total;
  const tierClass = { executive: "t-exec", manager: "t-manager", staff: "t-staff" };
  $("#roster").innerHTML = data.tiers
    .map((t) => {
      const rows = t.ranks
        .map((r) => {
          const members = r.members.length
            ? r.members
                .map((m) => `<span class="member clickable ${m.isWorking ? "working" : ""} ${m.isAdmin ? "is-admin" : ""}" data-uid="${m.id}">
                    <span class="stat"></span>${esc(m.username)}${m.teamTitle ? `<span class="m-team">${esc(m.teamTitle)}</span>` : ""}${m.isAdmin ? '<span class="crown">👑</span>' : ""}</span>`)
                .join("")
            : '<span class="empty">—</span>';
          return `<div class="rank-row">
            <span class="rank-name">${t.icon} ${esc(r.name)} <span class="dash">·</span></span>
            <span class="rank-members">${members}</span>
          </div>`;
        })
        .join("");
      return `<div class="tier-block">
        <div class="tier-banner ${tierClass[t.key] || ""}">${t.icon} ${t.label} (<b>${t.count}</b>) ${t.icon}</div>
        <div class="rank-rows">${rows}</div>
      </div>`;
    })
    .join("");

  // 팀 편성
  renderTeamRoster(data.teams || []);
}

function renderTeamRoster(teams) {
  const box = $("#team-roster");
  if (!box) return;
  if (!teams.length) { box.innerHTML = '<span class="empty">팀 정보가 없습니다.</span>'; return; }
  box.innerHTML = teams
    .map((tm) => {
      const rows = tm.roles
        .map((role) => {
          const members = role.members.length
            ? role.members
                .map((m) => `<span class="member clickable ${m.isWorking ? "working" : ""}" data-uid="${m.id}"><span class="stat"></span>${esc(m.username)}<span class="m-rank">${esc(m.rank)}</span></span>`)
                .join("")
            : '<span class="empty">—</span>';
          return `<div class="rank-row">
            <span class="rank-name">${esc(role.title)} <span class="dash">·</span></span>
            <span class="rank-members">${members}</span>
          </div>`;
        })
        .join("");
      return `<div class="tier-block team-block">
        <div class="tier-banner t-team">${tm.icon} ${esc(tm.name)} (<b>${tm.count}</b>) ${tm.icon}</div>
        <div class="rank-rows">${rows}</div>
      </div>`;
    })
    .join("");
  bindProfileClicks();
}

// 직급표/팀 멤버 클릭 → 프로필 열기
function bindProfileClicks() {
  $$("[data-uid]").forEach((el) => {
    if (el._pfBound) return;
    el._pfBound = true;
    el.addEventListener("click", () => openProfile(el.dataset.uid));
  });
}

// ============================================================
//  판매 보고서
// ============================================================
function reportRowHtml(r, canDelete) {
  const win = r.result === "승리";
  const resultBadge = r.result
    ? `<span class="result-badge ${win ? "win" : "lose"}">${win ? "🏆 승리" : "💀 패배"}</span>`
    : "";
  const pts = (r.points != null) ? `<span class="rp-pts ${win ? "win" : "lose"}">+${r.points}점</span>` : "";
  const author = (!canDelete && r.author) ? `<b class="rp-cust">${esc(r.author)}</b>` : "";
  return `<li class="report-item">
    ${canDelete ? `<button class="report-del" data-rep-del="${r.id}" title="삭제">✕</button>` : ""}
    <div class="rp-top">
      <span class="tag cat">${esc(r.category || "RP")}</span>
      ${author}
      ${resultBadge}
      ${pts}
    </div>
    ${r.participants ? `<p class="rp-partners">함께: ${esc(r.participants)}</p>` : ""}
    ${r.content ? `<p class="rp-content">${esc(r.content)}</p>` : ""}
    <div class="rp-meta"><span>${fmtFull(r.createdAt)}</span></div>
  </li>`;
}

function renderMyReports(list) {
  const ul = $("#report-list");
  if (!list.length) { ul.innerHTML = '<li class="muted">제출한 보고서가 없습니다.</li>'; return; }
  ul.innerHTML = list.map((r) => reportRowHtml(r, true)).join("");
  bindReportDelete(ul, async () => {
    const r = await api("GET", "/api/reports");
    state.reports = r.reports; renderMyReports(r.reports);
    if (state.me.isAdmin) loadAdminReports();
  });
}

function bindReportDelete(scope, after) {
  $$("[data-rep-del]", scope).forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("이 보고서를 삭제할까요?")) return;
      try { await api("DELETE", "/api/reports/" + b.dataset.repDel); toast("삭제되었습니다.", "ok"); await after(); }
      catch (e) { toast(e.message, "err"); }
    })
  );
}

// ---------- 가입 폼: 팀 선택 시 팀직책 표시 ----------
(function () {
  const t = $("#reg-team"), wrap = $("#reg-teamrole-wrap");
  if (t && wrap) t.addEventListener("change", () => wrap.classList.toggle("hidden", !t.value));
})();

// ---------- RP 보고서 폼: 승리/패배 토글 ----------
let repResult = "승리";
(function bindResultSeg() {
  const seg = $("#rep-result-seg");
  if (!seg) return;
  $$(".result-opt", seg).forEach((b) =>
    b.addEventListener("click", () => {
      $$(".result-opt", seg).forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      repResult = b.dataset.result;
    })
  );
})();

$("#form-report").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#report-msg"); msg.textContent = ""; msg.className = "form-msg";
  const body = {
    category: $("#rep-category").value,
    participants: $("#rep-participants").value,
    result: repResult,
    content: $("#rep-content").value,
  };
  try {
    const r = await api("POST", "/api/reports", body);
    $("#rep-participants").value = ""; $("#rep-content").value = "";
    const pts = r.report ? r.report.points : 0;
    msg.textContent = `RP 보고서가 제출되었습니다. (+${pts}점)`; msg.classList.add("ok");
    toast(repResult === "승리" ? `🏆 승리 등록! +${pts}점` : `💀 패배 등록 (+${pts}점)`, "ok");
    const g = await api("GET", "/api/reports"); state.reports = g.reports; renderMyReports(g.reports);
    if (state.me.isAdmin) loadAdminReports();
    loadHome();
  } catch (err) { msg.textContent = err.message; msg.classList.add("error"); }
});

// 관리자: 전체 보고서 + 합계
async function loadAdminReports() {
  try {
    const d = await api("GET", "/api/admin/reports");
    renderAdminReports(d.reports, d.summary, d.byCategory);
  } catch (e) {}
}

function renderAdminReports(list, summary, byCategory) {
  const sum = $("#report-summary");
  if (sum) {
    const cats = Object.entries(byCategory || {})
      .map(([k, v]) => `<span class="rs-cat">${esc(k)} <b>${v.count}건</b> · ${v.points}점</span>`)
      .join("");
    sum.innerHTML = `
      <div class="rs-cards">
        <div class="rs-card"><span>총 보고</span><b>${summary.count}건</b></div>
        <div class="rs-card"><span>승 / 패</span><b>${summary.wins || 0} / ${summary.losses || 0}</b></div>
        <div class="rs-card accent"><span>총 점수</span><b>${summary.totalPoints || 0}점</b></div>
      </div>
      ${cats ? `<div class="rs-bycat">${cats}</div>` : ""}`;
  }
  const body = $("#admin-reports-body");
  if (!list.length) { body.innerHTML = '<tr><td colspan="8" class="muted" style="padding:16px">제출된 RP 보고서가 없습니다.</td></tr>'; return; }
  body.innerHTML = list
    .map((r) => {
      const win = r.result === "승리";
      return `<tr>
      <td><b>${esc(r.author)}</b><br><span class="muted" style="font-size:.74rem">${esc(r.authorRank || "")}</span></td>
      <td><span class="tag cat">${esc(r.category || "")}</span></td>
      <td><span class="result-badge ${win ? "win" : "lose"}">${win ? "🏆 승리" : "💀 패배"}</span></td>
      <td><b class="${win ? "rp-pts win" : "rp-pts lose"}">+${r.points != null ? r.points : 0}</b></td>
      <td>${esc(r.participants || "-")}</td>
      <td class="rp-cell-content">${esc(r.content || "")}</td>
      <td class="muted" style="font-size:.78rem;white-space:nowrap">${fmtFull(r.createdAt)}</td>
      <td><button class="ico-btn danger" data-rep-del="${r.id}">삭제</button></td>
    </tr>`;
    })
    .join("");
  bindReportDelete(body, loadAdminReports);
}

// ============================================================
//  알람 소리 (띠링) + 폴링
// ============================================================
let _audioCtx = null;
function ensureAudio() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
  } catch (e) {}
  return _audioCtx;
}
// 첫 사용자 동작에서 오디오 권한 활성화 (브라우저 자동재생 정책)
["click", "keydown", "touchstart"].forEach((ev) =>
  window.addEventListener(ev, ensureAudio)
);
// ---------- 알람 켜기/끄기 + 브라우저 알림 (Web Push) ----------
function alarmOn() {
  try { return localStorage.getItem("pb_alarm") !== "off"; } catch (e) { return true; }
}
function setAlarmOn(on) {
  try { localStorage.setItem("pb_alarm", on ? "on" : "off"); } catch (e) {}
  syncAlarmUI();
  // 알람을 끄면 백그라운드 푸시 구독도 해제, 켜면(권한 있으면) 다시 구독
  if (on) { if (("Notification" in window) && Notification.permission === "granted") subscribePush(); }
  else { unsubscribePush(); }
}
function syncAlarmUI() {
  const on = alarmOn();
  const t = $("#alarm-toggle");
  if (t) { t.classList.toggle("on", on); t.setAttribute("aria-checked", on ? "true" : "false"); }
  const permitBtn = $("#notif-permit"), note = $("#notif-permit-note");
  const supported = pushSupported();
  if (permitBtn && note) {
    if (!supported || !(state.meta && state.meta.pushEnabled)) { permitBtn.classList.add("hidden"); note.classList.add("hidden"); }
    else if (Notification.permission === "granted") { permitBtn.classList.add("hidden"); note.classList.toggle("hidden", !on); }
    else if (Notification.permission === "denied") { permitBtn.classList.add("hidden"); note.classList.add("hidden"); }
    else { permitBtn.classList.toggle("hidden", !on); note.classList.add("hidden"); }
  }
}
// 탭이 열려 있을 때의 즉시 알림 (포그라운드)
function notify(title, body) {
  if (!alarmOn()) return;
  try {
    if (("Notification" in window) && Notification.permission === "granted") {
      const n = new Notification(title, { body, tag: "perfect-bank", renotify: true });
      setTimeout(() => { try { n.close(); } catch (e) {} }, 8000);
    }
  } catch (e) {}
}

// ----- Web Push (백그라운드: 탭을 닫아도 알림) -----
function pushSupported() {
  return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
}
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
let _swReg = null;
async function ensureSW() {
  if (!pushSupported()) return null;
  if (_swReg) return _swReg;
  try { _swReg = await navigator.serviceWorker.register("/sw.js"); return _swReg; }
  catch (e) { return null; }
}
async function subscribePush() {
  try {
    if (!pushSupported() || !alarmOn()) return;
    if (!(state.meta && state.meta.pushEnabled && state.meta.vapidPublicKey)) return;
    if (Notification.permission !== "granted") return;
    const reg = await ensureSW();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.meta.vapidPublicKey),
      });
    }
    await api("POST", "/api/push/subscribe", { subscription: sub.toJSON() });
  } catch (e) { /* 조용히 무시 */ }
}
async function unsubscribePush() {
  try {
    if (!pushSupported()) return;
    const reg = await ensureSW();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try { await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }); } catch (e) {}
      try { await sub.unsubscribe(); } catch (e) {}
    }
  } catch (e) {}
}

(function bindAlarmControls() {
  const t = $("#alarm-toggle");
  if (t) t.addEventListener("click", (e) => { e.stopPropagation(); setAlarmOn(!alarmOn()); toast(alarmOn() ? "알람을 켰습니다." : "알람을 껐습니다.", "ok"); });
  const permitBtn = $("#notif-permit");
  if (permitBtn) permitBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!pushSupported()) { toast("이 브라우저는 백그라운드 알림을 지원하지 않습니다.", "err"); return; }
    let perm = Notification.permission;
    if (perm !== "granted") { try { perm = await Notification.requestPermission(); } catch (e) {} }
    syncAlarmUI();
    if (perm === "granted") {
      await subscribePush();
      toast("백그라운드 알림이 켜졌습니다. (탭이 열려 있으면 OS 알림으로 받아요)", "ok");
      notify("북부 경찰서", "알림이 정상적으로 설정되었습니다.");
    } else {
      toast("브라우저에서 알림 권한이 거부되었습니다.", "err");
    }
  });
  syncAlarmUI();
})();

function playDing() {
  if (!alarmOn()) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [{ f: 1318.5, t: 0 }, { f: 1760, t: 0.12 }].forEach(({ f, t }) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    o.connect(g); g.connect(ctx.destination);
    const s = now + t;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(0.18, s + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.start(s); o.stop(s + 0.55);
  });
}

let _lastUnread = 0;
let _alarmTimer = null;
function startAlarmPolling() {
  _lastUnread = (state.me && state.me.unread) || 0;
  if (_alarmTimer) clearInterval(_alarmTimer);
  _alarmTimer = setInterval(checkAlarms, 20000);
}
async function checkAlarms() {
  if (!state.me || state.me.status !== "approved") return;
  try {
    const me = await api("GET", "/api/me");
    if (!me.user) return;
    const u = me.user.unread || 0;
    if (u > _lastUnread) {
      playDing();
      $("#bell").classList.add("ring"); setTimeout(() => $("#bell").classList.remove("ring"), 900);
      if (alarmOn()) toast("🔔 새 알람이 도착했습니다.", "ok");
      notify("북부 경찰서 — 새 알람", `읽지 않은 알람이 ${u}건 있습니다.`);
      try {
        const [ann, warn] = await Promise.all([api("GET", "/api/announcements"), api("GET", "/api/warnings")]);
        state.announcements = ann.announcements; state.warnings = warn.warnings;
        renderNotices(ann.announcements); renderWarnings(warn.warnings); renderNotifList();
      } catch (e) {}
    }
    state.me.unread = u;
    const bc = $("#bell-count"); bc.textContent = u; bc.classList.toggle("hidden", u === 0);
    _lastUnread = u;
  } catch (e) {}
}

// ============================================================
//  알람 (벨 + 패널)
// ============================================================
function renderNotifList() {
  const items = [
    ...state.announcements.map((a) => ({ kind: a.type === "warning" ? "warn" : "notice", icon: a.type === "warning" ? "⚠️" : "📢", title: a.title, time: a.createdAt })),
    ...state.warnings.map((w) => ({ kind: "warn", icon: "⚠️", title: `${w.level}단계 경고 — ${w.reason}`, time: w.createdAt })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 14);

  const list = $("#notif-list");
  if (!items.length) { list.innerHTML = '<div class="notif-empty">알람이 없습니다.</div>'; return; }
  list.innerHTML = items
    .map((i) => `<div class="notif-row ${i.kind === "warn" ? "warn" : ""}">
      <div class="ni">${i.icon}</div>
      <div><div class="nt">${esc(i.title)}</div><div class="nm">${fmtFull(i.time)}</div></div>
    </div>`)
    .join("");
}

$("#bell").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#notif-panel").classList.toggle("hidden");
});
$("#notif-panel").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => $("#notif-panel").classList.add("hidden"));

$("#notif-clear").addEventListener("click", async () => {
  try {
    await api("POST", "/api/seen");
    $("#bell-count").classList.add("hidden");
    if (state.me) state.me.unread = 0;
    toast("알람을 모두 읽음 처리했습니다.", "ok");
  } catch (e) { toast(e.message, "err"); }
});

// ============================================================
//  로그인 / 회원가입
// ============================================================
$$(".auth-tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    $("#form-login").classList.toggle("hidden", !isLogin);
    $("#form-register").classList.toggle("hidden", isLogin);
  })
);

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, msg = $("#login-msg");
  msg.textContent = ""; msg.className = "form-msg";
  try {
    await api("POST", "/api/login", { username: f.username.value, password: f.password.value });
    await refresh();
    toast("환영합니다!", "ok");
  } catch (err) { msg.textContent = err.message; msg.classList.add("error"); }
});

$("#form-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, msg = $("#register-msg");
  msg.textContent = ""; msg.className = "form-msg";
  if (!f.rank.value) { msg.textContent = "직급을 선택해 주세요."; msg.classList.add("error"); return; }
  if (f.password.value !== f.password2.value) { msg.textContent = "비밀번호가 일치하지 않습니다."; msg.classList.add("error"); return; }
  try {
    const r = await api("POST", "/api/register", {
      username: f.username.value,
      password: f.password.value,
      gobun: f.gobun.value,
      rank: f.rank.value,
      team: f.team ? f.team.value : "",
      teamRole: f.teamRole ? f.teamRole.value : "",
    });
    if (r.developer) { await refresh(); toast("개발자(소유자) 권한으로 가입되었습니다.", "ok"); return; }
    msg.textContent = r.message; msg.classList.add("ok");
    f.reset();
    toast("가입 신청이 접수되었습니다.", "ok");
    setTimeout(() => $('.auth-tab[data-tab="login"]').click(), 1200);
  } catch (err) { msg.textContent = err.message; msg.classList.add("error"); }
});

// 로그아웃
async function doLogout() { try { await api("POST", "/api/logout"); } catch (e) {} await refresh(); }
$("#logout").addEventListener("click", doLogout);
$("#pending-logout").addEventListener("click", doLogout);

// ============================================================
//  공지 작성 (상단 + 버튼)
// ============================================================
$("#btn-new-notice").addEventListener("click", () => {
  setPage("admin");
  $$('.admin-tab').forEach((t) => t.classList.toggle("active", t.dataset.atab === "post"));
  $$(".admin-pane").forEach((p) => p.classList.add("hidden"));
  $("#atab-post").classList.remove("hidden");
  $("#post-title").focus();
});

// ============================================================
//  관리자 콘솔
// ============================================================
$$(".admin-tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$(".admin-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    $$(".admin-pane").forEach((p) => p.classList.add("hidden"));
    $("#atab-" + tab.dataset.atab).classList.remove("hidden");
  })
);

async function loadAdmin() {
  try {
    const [p, u, w] = await Promise.all([
      api("GET", "/api/admin/pending"),
      api("GET", "/api/admin/users"),
      api("GET", "/api/admin/warnings"),
    ]);
    renderPending(p.pending);
    renderAdminUsers(u.users, u.ranks, u.teams, u.teamRoles);
    populateWarnTarget(u.users);
    renderAdminWarnings(w.warnings);
    loadAdminLeaves();
    loadSettings();
  } catch (e) {}
  loadAdminReports();
  loadLogs();
}

// 경고 대상 회원 드롭다운 (소유자 제외)
function populateWarnTarget(users) {
  const sel = $("#warn-target");
  if (!sel) return;
  const prev = sel.value;
  const list = users.filter((u) => !u.isOwner && u.status === "approved");
  sel.innerHTML = list.length
    ? list.map((u) => `<option value="${escAttr(u.id)}">${escAttr(u.username)} · ${escAttr(u.rank)}${u.warningCount ? ` (경고 ${u.warningCount})` : ""}</option>`).join("")
    : '<option value="" disabled>경고 가능한 회원이 없습니다</option>';
  if (prev && list.some((u) => u.id === prev)) sel.value = prev;
}

// 전체 경고 내역 렌더 + 삭제
function renderAdminWarnings(list) {
  const ul = $("#admin-warn-list");
  if (!ul) return;
  if (!list.length) { ul.innerHTML = '<li class="muted">발부된 경고가 없습니다.</li>'; return; }
  ul.innerHTML = list
    .map((w) => {
      const dots = [1, 2, 3].map((i) => `<span class="w-dot ${i <= w.level ? "on" : ""}"></span>`).join("");
      return `<li class="warn-all-item lv${w.level}">
        <button class="report-del" data-warn-del="${w.id}" title="경고 취소">✕</button>
        <div class="wa-top">
          <b class="wa-target">${esc(w.targetUsername)}</b>
          <span class="wa-rank">${esc(w.targetRank || "")}</span>
          <span class="w-level">${dots}</span>
          <span class="wa-lvtxt">${w.level}단계</span>
        </div>
        <p class="wa-reason">${esc(w.reason)}</p>
        <div class="wa-meta"><span>발부자 ${esc(w.issuedBy || "-")}</span><span>${fmtFull(w.createdAt)}</span></div>
      </li>`;
    })
    .join("");
  $$("[data-warn-del]", ul).forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("이 경고를 취소(삭제)할까요?")) return;
      try { await api("DELETE", "/api/admin/warning/" + b.dataset.warnDel); toast("경고가 취소되었습니다.", "ok"); await loadAdmin(); await reloadMyWarnings(); }
      catch (e) { toast(e.message, "err"); }
    })
  );
}

async function reloadMyWarnings() {
  try { const w = await api("GET", "/api/warnings"); state.warnings = w.warnings; renderWarnings(w.warnings); renderNotifList(); } catch (e) {}
}

// 경고 부여 폼
$("#form-warn").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#warn-msg"); msg.textContent = ""; msg.className = "form-msg";
  const userId = $("#warn-target").value;
  if (!userId) { msg.textContent = "대상 회원을 선택해 주세요."; msg.classList.add("error"); return; }
  try {
    const r = await api("POST", "/api/admin/warn", { userId, level: +$("#warn-level").value, reason: $("#warn-reason").value });
    $("#warn-reason").value = "";
    if (r.kickReview) {
      msg.textContent = `경고 부여 완료 — 누적 ${r.count}회로 강퇴 검토 대상입니다.`; msg.classList.add("ok");
      toast(`🚨 강퇴 검토 대상 (경고 ${r.count}회 누적)`, "err");
    } else {
      msg.textContent = `경고가 부여되었습니다. (누적 ${r.count}회)`; msg.classList.add("ok");
      toast("경고가 부여되었습니다.", "ok");
    }
    await loadAdmin();
    await reloadMyWarnings();
  } catch (err) { msg.textContent = err.message; msg.classList.add("error"); }
});

// 활동 로그
let _allLogs = [];
let _logFilter = "all";
const LOG_GROUPS = {
  auth: ["register", "owner", "login", "logout", "approve", "reject"],
  warn: ["warn", "warn-del", "kick-review"],
  report: ["report"],
  att: ["clock-in", "clock-out"],
};
function logGroup(type) {
  for (const g in LOG_GROUPS) if (LOG_GROUPS[g].includes(type)) return g;
  return "etc";
}
async function loadLogs() {
  try { const d = await api("GET", "/api/admin/logs?limit=200"); _allLogs = d.logs || []; renderLogs(); }
  catch (e) {}
}
function renderLogs() {
  const ul = $("#log-list");
  if (!ul) return;
  const list = _logFilter === "all" ? _allLogs : _allLogs.filter((l) => logGroup(l.type) === _logFilter);
  if (!list || !list.length) { ul.innerHTML = '<li class="muted">해당하는 활동 기록이 없습니다.</li>'; return; }
  ul.innerHTML = list
    .map((l) => `<li class="log-item log-${esc(l.type)}">
      <span class="log-ico">${esc(l.icon || "•")}</span>
      <div class="log-body">
        <p class="log-msg"><b>${esc(l.actor)}</b> ${esc(l.message)}</p>
        <span class="log-time">${fmtFull(l.createdAt)}</span>
      </div>
    </li>`)
    .join("");
}
$$("#log-filters .log-filter").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#log-filters .log-filter").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    _logFilter = b.dataset.lf;
    renderLogs();
  })
);
const _logRefresh = $("#log-refresh");
if (_logRefresh) _logRefresh.addEventListener("click", loadLogs);

function renderPending(list) {
  const badge = $("#pending-badge");
  badge.textContent = list.length;
  badge.classList.toggle("hidden", list.length === 0);
  const box = $("#admin-pending-list");
  if (!list.length) { box.innerHTML = '<p class="muted">대기중인 신청이 없습니다.</p>'; return; }
  box.innerHTML = list
    .map((u) => `<div class="pending-row">
      <div class="pr-info"><b>${esc(u.username)}</b><span>고번 ${esc(u.gobun || "-")} · 희망직급 ${esc(u.rank || "-")} · ${fmtFull(u.createdAt)}</span></div>
      <div class="pr-actions">
        <button class="btn-approve" data-approve="${u.id}">승인</button>
        <button class="btn-reject" data-reject="${u.id}">거절</button>
      </div>
    </div>`)
    .join("");
  $$("[data-approve]", box).forEach((b) => b.addEventListener("click", () => adminAction("/api/admin/approve", { userId: b.dataset.approve }, "승인되었습니다.")));
  $$("[data-reject]", box).forEach((b) => b.addEventListener("click", () => { if (confirm("이 신청을 거절할까요?")) adminAction("/api/admin/reject", { userId: b.dataset.reject }, "거절되었습니다."); }));
}

function renderAdminUsers(users, ranks, teams, teamRoles) {
  teams = teams || [];
  teamRoles = teamRoles || [];
  const body = $("#admin-users-body");
  const iAmOwner = !!(state.me && state.me.isOwner);
  body.innerHTML = users
    .map((u) => {
      const opts = ranks.map((r) => `<option ${r === u.rank ? "selected" : ""}>${esc(r)}</option>`).join("");
      const stCls = { approved: "status-approved", pending: "status-pending", rejected: "status-rejected" }[u.status];
      const stTxt = { approved: "승인", pending: "대기", rejected: "거절" }[u.status];
      // 이름 옆 배지: 소유자 / 관리자
      const badge = u.isOwner
        ? ' <span class="owner-badge" title="개발자(소유자)">👑 소유자</span>'
        : (u.isAdmin ? ' <span class="crown" title="관리자">👑</span>' : "");
      // 소유자 계정은 직급을 소유자 본인만 변경 가능
      const rankDisabled = u.isOwner && !iAmOwner ? "disabled" : "";
      // 팀 배정 셀 (직급과 별개)
      const teamOpts = '<option value="">팀 없음</option>' +
        teams.map((t) => `<option value="${escAttr(t.key)}" ${u.team === t.key ? "selected" : ""}>${esc(t.name)}</option>`).join("");
      const roleOpts = teamRoles.map((r) => `<option ${u.teamRole === r ? "selected" : ""}>${esc(r)}</option>`).join("");
      const teamCell = `<div class="team-cell">
          <select data-team="${u.id}">${teamOpts}</select>
          <select data-teamrole="${u.id}" ${u.team ? "" : "disabled"}>${roleOpts}</select>
        </div>`;
      // 소유자 계정은 경고·관리해제·삭제 불가 → 버튼 대신 안내 표시
      const actions = u.isOwner
        ? '<span class="muted owner-lock">최고 관리자</span>'
        : `<div class="row-actions">
            <button class="ico-btn" data-warn="${u.id}" data-name="${esc(u.username)}">경고</button>
            <button class="ico-btn" data-admin="${u.id}" data-on="${u.isAdmin ? 0 : 1}">${u.isAdmin ? "관리해제" : "관리지정"}</button>
            <button class="ico-btn danger" data-del-user="${u.id}">삭제</button>
          </div>`;
      return `<tr>
        <td><b>${esc(u.username)}</b>${badge}</td>
        <td><select data-rank="${u.id}" ${rankDisabled}>${opts}</select></td>
        <td>${teamCell}</td>
        <td><span class="status-badge ${stCls}">${stTxt}</span></td>
        <td>${u.warningCount}건${u.kickReview ? ' <span class="kick-badge">🚨 강퇴검토</span>' : ""}</td>
        <td><code style="font-size:.82rem;color:var(--ink-soft)">${esc(u.gobun || "-")}</code></td>
        <td>${actions}</td>
      </tr>`;
    })
    .join("");

  $$("[data-rank]", body).forEach((sel) =>
    sel.addEventListener("change", () => adminAction("/api/admin/set-rank", { userId: sel.dataset.rank, rank: sel.value }, "직급이 변경되었습니다."))
  );
  $$("[data-team]", body).forEach((sel) =>
    sel.addEventListener("change", () => {
      const cell = sel.closest(".team-cell");
      const role = cell ? cell.querySelector("[data-teamrole]") : null;
      if (role) role.disabled = !sel.value;
      adminAction("/api/admin/set-team", { userId: sel.dataset.team, team: sel.value, teamRole: role ? role.value : "" }, sel.value ? "팀이 배정되었습니다." : "팀이 해제되었습니다.");
    })
  );
  $$("[data-teamrole]", body).forEach((sel) =>
    sel.addEventListener("change", () => {
      const cell = sel.closest(".team-cell");
      const team = cell ? cell.querySelector("[data-team]") : null;
      adminAction("/api/admin/set-team", { userId: sel.dataset.teamrole, team: team ? team.value : "", teamRole: sel.value }, "팀 직책이 변경되었습니다.");
    })
  );
  $$("[data-admin]", body).forEach((b) =>
    b.addEventListener("click", () => { if (confirm("관리자 권한을 변경할까요?")) adminAction("/api/admin/set-admin", { userId: b.dataset.admin, isAdmin: b.dataset.on === "1" }, "권한이 변경되었습니다."); })
  );
  $$("[data-del-user]", body).forEach((b) =>
    b.addEventListener("click", () => { if (confirm("이 회원을 삭제할까요? 되돌릴 수 없습니다.")) adminAction("/api/admin/delete-user", { userId: b.dataset.delUser }, "삭제되었습니다."); })
  );
  $$("[data-warn]", body).forEach((b) => b.addEventListener("click", () => openWarnModal(b.dataset.warn, b.dataset.name)));

  renderKickReview(users);
}

// 강퇴 검토 대상 목록 (경고 누적 기준 이상)
function renderKickReview(users) {
  const box = $("#kick-review-box"), list = $("#kick-list"), cnt = $("#kick-count");
  if (!box) return;
  const targets = users.filter((u) => u.kickReview);
  cnt.textContent = targets.length;
  box.classList.toggle("hidden", targets.length === 0);
  if (!targets.length) { list.innerHTML = ""; return; }
  list.innerHTML = targets
    .map((u) => `<li class="kick-item">
      <div><b>${esc(u.username)}</b> <span class="muted">${esc(u.rank)}${u.teamTitle ? " · " + esc(u.teamTitle) : ""}</span></div>
      <div class="kick-right"><span class="kick-cnt">경고 ${u.warningCount}회</span>
      <button class="ico-btn danger" data-kick="${u.id}" data-name="${esc(u.username)}">강퇴</button></div>
    </li>`)
    .join("");
  $$("[data-kick]", list).forEach((b) =>
    b.addEventListener("click", () => {
      if (confirm(`${b.dataset.name} 님을 강퇴(삭제)할까요? 되돌릴 수 없습니다.`)) adminAction("/api/admin/delete-user", { userId: b.dataset.kick }, "강퇴(삭제) 처리되었습니다.");
    })
  );
}

function openWarnModal(userId, name) {
  openModal("경고 발부 · " + name, `
    <label>경고 단계
      <select id="m-level"><option value="1">1단계 (주의)</option><option value="2">2단계 (경고)</option><option value="3">3단계 (중대)</option></select>
    </label>
    <label>사유
      <textarea id="m-reason" rows="4" placeholder="경고 사유를 입력하세요"></textarea>
    </label>
    <button class="btn-primary" id="m-submit">경고 발부</button>
  `);
  $("#m-submit").addEventListener("click", async () => {
    try {
      const r = await api("POST", "/api/admin/warn", { userId, level: +$("#m-level").value, reason: $("#m-reason").value });
      closeModal();
      if (r.kickReview) toast(`🚨 ${name} — 강퇴 검토 대상 (경고 ${r.count}회)`, "err");
      else toast(`경고가 발부되었습니다. (누적 ${r.count}회)`, "ok");
      loadAdmin();
      const w = await api("GET", "/api/warnings"); state.warnings = w.warnings; renderWarnings(w.warnings);
    } catch (e) { toast(e.message, "err"); }
  });
}

async function adminAction(url, body, okMsg) {
  try {
    await api("POST", url, body);
    toast(okMsg, "ok");
    await loadAdmin();
    await reloadRoster();
    // 본인 정보가 바뀌었을 수 있으니 갱신
    const me = await api("GET", "/api/me"); if (me.user) { state.me = me.user; renderUserChip(); }
  } catch (e) { toast(e.message, "err"); }
}

// 공지/경고 게시
$("#form-post").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#post-msg"); msg.textContent = ""; msg.className = "form-msg";
  const type = $('input[name="ptype"]:checked').value;
  const category = $("#post-category") ? $("#post-category").value : "";
  try {
    await api("POST", "/api/announcements", { type, category, title: $("#post-title").value, body: $("#post-body").value });
    $("#post-title").value = ""; $("#post-body").value = "";
    msg.textContent = "게시되었습니다."; msg.classList.add("ok");
    toast("게시되었습니다.", "ok");
    const r = await api("GET", "/api/announcements"); state.announcements = r.announcements; renderNotices(r.announcements); renderNotifList();
    // 본인이 올린 공지로 자기 알람이 울리지 않도록 읽음 처리
    try { await api("POST", "/api/seen"); state.me.unread = 0; _lastUnread = 0; $("#bell-count").classList.add("hidden"); } catch (e2) {}
  } catch (err) { msg.textContent = err.message; msg.classList.add("error"); }
});

// ---------- 시작 ----------
refresh();
