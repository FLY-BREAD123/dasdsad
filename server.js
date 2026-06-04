// server.js - 레전드 조직 관리 백엔드 (Express + JSON DB)
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const { data, save, uid } = require("./db");
const R = require("./ranks");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", true); // 호스팅 프록시 뒤에서 실제 IP(X-Forwarded-For) 인식
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- helpers ---------------- */
function clientIp(req) {
  let ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "";
  ip = ip.replace(/^::ffff:/, ""); // IPv4-mapped IPv6 정리
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}
function signToken(member) {
  return jwt.sign({ id: member.id }, data.secret, { expiresIn: "30d" });
}
function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function addLog(type, message) {
  data.logs.unshift({ id: uid(), type, message, at: Date.now() });
  if (data.logs.length > 1000) data.logs.length = 1000;
}
function findMember(id) {
  return data.members.find((m) => m.id === id);
}
function activeSession(memberId) {
  return data.attendance.find((a) => a.memberId === memberId && a.clockOut == null);
}
function totalMs(memberId) {
  const now = Date.now();
  return data.attendance
    .filter((a) => a.memberId === memberId)
    .reduce((sum, a) => sum + ((a.clockOut || now) - a.clockIn), 0);
}
function warnCount(memberId) {
  return data.warnings.filter((w) => w.memberId === memberId).length;
}
function memberScore(memberId) {
  return (data.activities || [])
    .filter((a) => Array.isArray(a.participants) && a.participants.includes(memberId))
    .reduce((s, a) => s + (a.points || 0), 0);
}
function catLabel(c) {
  return { rp: "RP", op: "작전/장물", report: "보고서", etc: "기타" }[c] || "기타";
}
function publicActivity(a) {
  const names = (a.participants || []).map((id, i) => {
    const m = findMember(id);
    return m ? m.name : (a.participantNames && a.participantNames[i]) || "(제명)";
  });
  return {
    id: a.id,
    category: a.category,
    title: a.title,
    desc: a.desc,
    points: a.points,
    by: a.by,
    byId: a.byId,
    at: a.at,
    participants: names,
    loot: a.loot || null,
  };
}
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 외부로 내보낼 멤버 표현 (비밀번호/IP 비노출)
function publicMember(m) {
  const info = R.rankInfo(m.rank);
  const sess = activeSession(m.id);
  const today = dayKey(Date.now());
  const clockedToday = data.attendance.some((a) => a.memberId === m.id && dayKey(a.clockIn) === today);
  const wc = warnCount(m.id);
  return {
    id: m.id,
    name: m.name,
    gobun: m.gobun,
    rank: m.rank,
    tier: info.tier,
    level: info.level,
    status: m.status,
    createdAt: m.createdAt,
    onDuty: !!sess,
    activeSince: sess ? sess.clockIn : null,
    clockedToday,
    totalMs: totalMs(m.id),
    warningCount: wc,
    flagged: wc >= (data.config.warnThreshold || 3),
    dev: !!m.dev,
    score: memberScore(m.id),
  };
}

function auth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: "로그인이 필요합니다." });
  try {
    const payload = jwt.verify(token, data.secret);
    const m = findMember(payload.id);
    if (!m || m.status !== "active") return res.status(401).json({ error: "유효하지 않은 세션입니다." });
    req.member = m;
    next();
  } catch (e) {
    return res.status(401).json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." });
  }
}
const LOCAL_IPS = new Set(["127.0.0.1", "::1", "localhost"]);
function devIpSet() {
  const env = (process.env.DEV_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cfg = Array.isArray(data.config.devIps) ? data.config.devIps : [];
  return new Set([...env, ...cfg]);
}
function isDevIp(ip) {
  return LOCAL_IPS.has(ip) || devIpSet().has(ip);
}
function memberCanManage(m) {
  return !!m.dev || R.canManage(m.rank);
}
// actor가 target에게 (경고/직급변경/제명/비번초기화 등) 조치를 할 수 있는가
function canActOn(actor, target) {
  if (target.id === actor.id) return false;          // 본인에게는 불가
  if (target.dev && !actor.dev) return false;        // 개발자 계정은 개발자만 조치 가능
  if (actor.dev) return true;                        // 개발자는 (본인 제외) 누구든 가능
  return R.rankInfo(target.rank).level < R.rankInfo(actor.rank).level;
}
function requireManage(req, res, next) {
  if (!memberCanManage(req.member)) return res.status(403).json({ error: "권한이 없습니다. (간부직 이상)" });
  next();
}
function genCode() {
  const ch = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c;
  do {
    c = Array.from({ length: 6 }, () => ch[Math.floor(Math.random() * ch.length)]).join("");
  } while ((data.inviteCodes || []).some((x) => x.code === c));
  return c;
}
function occupiesIp(m) {
  return m.status === "active" || m.status === "pending";
}

/* ---------------- meta ---------------- */
app.get("/api/meta", (req, res) => {
  res.json({ tiers: R.TIERS, ranks: R.RANKS, manageLevel: R.MANAGE_LEVEL, config: data.config, regMode: data.config.regMode || "approval" });
});

/* ---------------- auth ---------------- */
app.post("/api/register", async (req, res) => {
  try {
    let { name, gobun, rank, password, invite } = req.body || {};
    name = (name || "").trim();
    gobun = (gobun || "").toString().trim();
    rank = (rank || "").trim();
    invite = (invite || "").toString().trim();
    if (!name || !gobun || !password) return res.status(400).json({ error: "모든 항목을 입력해 주세요." });
    if (password.length < 4) return res.status(400).json({ error: "비밀번호는 4자 이상이어야 합니다." });

    const ip = clientIp(req);
    const firstAccount = !data.members.some((m) => m.status === "active");
    const devGrant = isDevIp(ip) || firstAccount; // 개발자 IP 또는 최초(소유자) 계정 → 전체 권한 + 모드 무시
    const mode = data.config.regMode || "approval";

    // 직급 / 초대코드 / 상태 결정
    let finalRank = rank;
    let usedCode = null;
    let status = "active";

    if (devGrant) {
      if (!R.RANK_MAP[finalRank]) return res.status(400).json({ error: "존재하지 않는 직급입니다." });
      status = "active";
    } else if (mode === "invite") {
      if (!invite) return res.status(400).json({ error: "초대코드를 입력해 주세요." });
      const code = (data.inviteCodes || []).find((c) => c.code.toLowerCase() === invite.toLowerCase() && !c.disabled);
      if (!code) return res.status(400).json({ error: "유효하지 않은 초대코드입니다." });
      if (code.maxUses != null && code.uses >= code.maxUses) return res.status(400).json({ error: "사용 횟수가 모두 소진된 초대코드입니다." });
      finalRank = code.rank;
      usedCode = code;
      status = "active";
    } else {
      // open / approval : 가입자가 직급 선택
      if (!R.RANK_MAP[finalRank]) return res.status(400).json({ error: "존재하지 않는 직급입니다." });
      status = mode === "approval" ? "pending" : "active";
    }

    // IP당 1계정 제한 (개발자 IP는 무제한). 대기/활성 계정이 IP를 점유.
    if (!devGrant && data.members.some((m) => m.ip === ip && occupiesIp(m))) {
      return res.status(409).json({ error: "이미 이 IP로 가입(또는 신청)된 계정이 있습니다. 계정은 IP당 하나만 만들 수 있습니다." });
    }
    if (data.members.some((m) => m.gobun === gobun && occupiesIp(m))) {
      return res.status(409).json({ error: "이미 사용 중인 고번입니다." });
    }

    const member = {
      id: uid(),
      name,
      gobun,
      rank: finalRank,
      passwordHash: await bcrypt.hash(password, 10),
      ip,
      status,
      createdAt: Date.now(),
      dev: devGrant,
    };
    data.members.push(member);
    if (usedCode) usedCode.uses = (usedCode.uses || 0) + 1;
    addLog("register", `${name} (${finalRank}) 님이 ${status === "pending" ? "가입 신청" : "가입"}했습니다.`);
    if (devGrant) addLog("dev", `${name} 님이 개발자(전체 권한) 계정으로 등록되었습니다.`);
    if (status === "pending") addLog("approval", `${name} 님이 승인 대기열에 추가되었습니다.`);
    save();

    if (status === "active") {
      const token = signToken(member);
      setAuthCookie(res, token);
      return res.json({ ok: true, member: publicMember(member) });
    }
    return res.json({ ok: true, pending: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    let { id, password } = req.body || {}; // id = 이름 또는 고번
    id = (id || "").toString().trim();
    if (!id || !password) return res.status(400).json({ error: "이름(또는 고번)과 비밀번호를 입력해 주세요." });
    const cand = data.members.filter((m) => m.gobun === id || m.name === id);
    const member = cand.find((m) => m.status === "active") || cand.find((m) => m.status === "pending") || cand[0];
    if (!member) return res.status(401).json({ error: "계정을 찾을 수 없습니다." });
    const ok = await bcrypt.compare(password, member.passwordHash);
    if (!ok) return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
    if (member.status === "pending") return res.status(403).json({ error: "가입 승인 대기 중입니다. 간부 승인 후 이용할 수 있습니다." });
    if (member.status === "rejected") return res.status(403).json({ error: "가입이 거절된 계정입니다." });
    if (member.status !== "active") return res.status(403).json({ error: "이용할 수 없는 계정입니다. (제명)" });

    const token = signToken(member);
    setAuthCookie(res, token);
    res.json({ ok: true, member: publicMember(member) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ member: publicMember(req.member) });
});

/* ---------------- bootstrap (앱이 필요로 하는 데이터 묶음) ---------------- */
app.get("/api/bootstrap", auth, (req, res) => {
  const me = publicMember(req.member);
  const members = data.members
    .filter((m) => m.status === "active")
    .map(publicMember)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "ko"));

  const announcements = [...data.announcements].sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at - a.at
  );

  const warnings = [...data.warnings]
    .sort((a, b) => b.at - a.at)
    .map((w) => {
      const m = findMember(w.memberId);
      return {
        id: w.id,
        memberId: w.memberId,
        memberName: m ? m.name : "(제명됨)",
        memberRank: m ? m.rank : "-",
        severity: w.severity,
        reason: w.reason,
        by: w.byName,
        at: w.at,
      };
    });

  const attendanceMine = data.attendance
    .filter((a) => a.memberId === req.member.id)
    .sort((a, b) => b.clockIn - a.clockIn)
    .slice(0, 60);

  const logs = data.logs.slice(0, 80);

  // 통계: 근무시간 랭킹
  const leaderboard = members
    .map((m) => ({ name: m.name, rank: m.rank, totalMs: m.totalMs }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10);

  // 점수 랭킹 + 장물 총액 + 최근 활동/보고
  const scoreboard = members
    .map((m) => ({ name: m.name, rank: m.rank, score: m.score }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const lootTotal = (data.activities || []).reduce((s, a) => s + (a.loot ? a.loot.total : 0), 0);
  const activities = (data.activities || []).slice(0, 60).map(publicActivity);

  // 최근 7일 출근(고유 인원) 그래프
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());
    const set = new Set(
      data.attendance.filter((a) => dayKey(a.clockIn) === key).map((a) => a.memberId)
    );
    days.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, count: set.size });
  }

  const canMng = memberCanManage(req.member);
  const pending = canMng
    ? data.members.filter((m) => m.status === "pending").sort((a, b) => a.createdAt - b.createdAt).map(publicMember)
    : [];
  const invites = canMng
    ? (data.inviteCodes || []).map((c) => ({ code: c.code, rank: c.rank, maxUses: c.maxUses, uses: c.uses, note: c.note, by: c.by, at: c.at }))
    : [];

  res.json({
    me,
    config: data.config,
    canManage: canMng,
    regMode: data.config.regMode || "approval",
    pending,
    invites,
    myIp: clientIp(req),
    devIps: req.member.dev ? Array.from(devIpSet()) : [],
    members,
    announcements,
    warnings,
    attendanceMine,
    logs,
    activities,
    stats: { leaderboard, days, scoreboard, lootTotal },
  });
});

/* ---------------- attendance ---------------- */
app.post("/api/attendance/clockin", auth, (req, res) => {
  if (activeSession(req.member.id)) return res.status(400).json({ error: "이미 근무 중입니다." });
  data.attendance.push({ id: uid(), memberId: req.member.id, clockIn: Date.now(), clockOut: null });
  addLog("clockin", `${req.member.name} 님이 출근했습니다.`);
  save();
  res.json({ ok: true });
});

app.post("/api/attendance/clockout", auth, (req, res) => {
  const sess = activeSession(req.member.id);
  if (!sess) return res.status(400).json({ error: "근무 중이 아닙니다." });
  sess.clockOut = Date.now();
  const mins = Math.round((sess.clockOut - sess.clockIn) / 60000);
  addLog("clockout", `${req.member.name} 님이 퇴근했습니다. (근무 ${mins}분)`);
  save();
  res.json({ ok: true });
});

/* ---------------- warnings ---------------- */
app.post("/api/warnings", auth, requireManage, (req, res) => {
  const { memberId, severity, reason } = req.body || {};
  const target = findMember(memberId);
  if (!target || target.status !== "active") return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  if (!canActOn(req.member, target)) {
    return res.status(403).json({ error: target.id === req.member.id ? "본인에게는 경고를 줄 수 없습니다." : "이 대상에게는 경고를 줄 수 없습니다." });
  }
  if (!["주의", "경고", "심각"].includes(severity)) return res.status(400).json({ error: "잘못된 경고 단계입니다." });

  data.warnings.push({
    id: uid(),
    memberId,
    severity,
    reason: (reason || "").trim() || "(사유 미기재)",
    byId: req.member.id,
    byName: req.member.name,
    at: Date.now(),
  });
  addLog("warn", `${req.member.name} → ${target.name} 에게 [${severity}] 경고를 부여했습니다.`);
  save();
  res.json({ ok: true });
});

app.delete("/api/warnings/:id", auth, requireManage, (req, res) => {
  const idx = data.warnings.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "경고를 찾을 수 없습니다." });
  const w = data.warnings[idx];
  const target = findMember(w.memberId);
  data.warnings.splice(idx, 1);
  addLog("warn-del", `${req.member.name} 님이 ${target ? target.name : "?"} 의 경고를 삭제했습니다.`);
  save();
  res.json({ ok: true });
});

/* ---------------- announcements ---------------- */
app.post("/api/announcements", auth, requireManage, (req, res) => {
  const { title, body } = req.body || {};
  if (!(title || "").trim()) return res.status(400).json({ error: "제목을 입력해 주세요." });
  data.announcements.unshift({
    id: uid(),
    title: title.trim(),
    body: (body || "").trim(),
    pinned: false,
    author: req.member.name,
    at: Date.now(),
  });
  addLog("notice", `${req.member.name} 님이 공지 "${title.trim()}" 을 등록했습니다.`);
  save();
  res.json({ ok: true });
});

app.patch("/api/announcements/:id/pin", auth, requireManage, (req, res) => {
  const a = data.announcements.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
  a.pinned = !a.pinned;
  save();
  res.json({ ok: true, pinned: a.pinned });
});

app.delete("/api/announcements/:id", auth, requireManage, (req, res) => {
  const idx = data.announcements.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "공지를 찾을 수 없습니다." });
  data.announcements.splice(idx, 1);
  save();
  res.json({ ok: true });
});

/* ---------------- members management ---------------- */
app.patch("/api/members/:id", auth, requireManage, (req, res) => {
  const target = findMember(req.params.id);
  if (!target || target.status !== "active") return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  const { rank } = req.body || {};
  if (!R.RANK_MAP[rank]) return res.status(400).json({ error: "존재하지 않는 직급입니다." });
  if (!canActOn(req.member, target))
    return res.status(403).json({ error: target.id === req.member.id ? "본인의 직급은 변경할 수 없습니다." : "이 대상의 직급은 변경할 수 없습니다." });
  if (!req.member.dev && R.rankInfo(rank).level >= R.rankInfo(req.member.rank).level)
    return res.status(403).json({ error: "본인과 동급 이상으로는 임명할 수 없습니다." });

  const before = target.rank;
  target.rank = rank;
  addLog("rank", `${req.member.name} 님이 ${target.name} 의 직급을 ${before} → ${rank} 로 변경했습니다.`);
  save();
  res.json({ ok: true });
});

app.post("/api/members/:id/reset-password", auth, requireManage, async (req, res) => {
  const target = findMember(req.params.id);
  if (!target || target.status !== "active") return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  if (target.id !== req.member.id && !canActOn(req.member, target))
    return res.status(403).json({ error: "이 대상의 비밀번호는 초기화할 수 없습니다." });
  const temp = Math.random().toString(36).slice(2, 8);
  target.passwordHash = await bcrypt.hash(temp, 10);
  addLog("pw", `${req.member.name} 님이 ${target.name} 의 비밀번호를 초기화했습니다.`);
  save();
  res.json({ ok: true, tempPassword: temp });
});

app.delete("/api/members/:id", auth, requireManage, (req, res) => {
  const target = findMember(req.params.id);
  if (!target || target.status !== "active") return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  if (!canActOn(req.member, target))
    return res.status(403).json({ error: target.id === req.member.id ? "본인은 제명할 수 없습니다." : "이 대상은 제명할 수 없습니다." });

  target.status = "expelled";
  target.expelledAt = Date.now();
  // 진행 중 근무 종료
  const sess = activeSession(target.id);
  if (sess) sess.clockOut = Date.now();
  // freeIp=true 이면 해당 IP로 재가입 허용
  if (req.body && req.body.freeIp) target.ip = null;
  addLog("expel", `${req.member.name} 님이 ${target.name} 을(를) 제명했습니다.`);
  save();
  res.json({ ok: true });
});

/* ---------------- config ---------------- */
app.patch("/api/config", auth, requireManage, (req, res) => {
  const { warnThreshold, regMode } = req.body || {};
  if (warnThreshold !== undefined) {
    const n = parseInt(warnThreshold, 10);
    if (!Number.isFinite(n) || n < 1 || n > 50) return res.status(400).json({ error: "1~50 사이 값을 입력해 주세요." });
    data.config.warnThreshold = n;
    addLog("config", `${req.member.name} 님이 제명 검토 기준을 ${n}회로 변경했습니다.`);
  }
  if (regMode !== undefined) {
    if (!["open", "approval", "invite"].includes(regMode)) return res.status(400).json({ error: "잘못된 가입 방식입니다." });
    data.config.regMode = regMode;
    const label = { open: "자유 가입", approval: "승인제", invite: "초대코드" }[regMode];
    addLog("config", `${req.member.name} 님이 가입 방식을 '${label}'(으)로 변경했습니다.`);
  }
  save();
  res.json({ ok: true, config: data.config });
});

/* ---------------- approvals ---------------- */
app.post("/api/members/:id/approve", auth, requireManage, (req, res) => {
  const target = findMember(req.params.id);
  if (!target || target.status !== "pending") return res.status(404).json({ error: "승인 대기 중인 대상이 아닙니다." });
  let { rank } = req.body || {};
  if (rank) {
    if (!R.RANK_MAP[rank]) return res.status(400).json({ error: "존재하지 않는 직급입니다." });
    if (!req.member.dev && R.rankInfo(rank).level >= R.rankInfo(req.member.rank).level)
      return res.status(403).json({ error: "본인과 동급 이상으로는 임명할 수 없습니다." });
    target.rank = rank;
  }
  if (!req.member.dev && R.rankInfo(target.rank).level >= R.rankInfo(req.member.rank).level)
    return res.status(403).json({ error: "본인보다 낮은 직급만 승인할 수 있습니다. (상위 직급 신청자는 상급자가 승인)" });
  target.status = "active";
  addLog("approval", `${req.member.name} 님이 ${target.name} (${target.rank}) 의 가입을 승인했습니다.`);
  save();
  res.json({ ok: true });
});

app.post("/api/members/:id/reject", auth, requireManage, (req, res) => {
  const target = findMember(req.params.id);
  if (!target || target.status !== "pending") return res.status(404).json({ error: "승인 대기 중인 대상이 아닙니다." });
  target.status = "rejected";
  target.rejectedAt = Date.now();
  if (req.body && req.body.freeIp) target.ip = null;
  addLog("approval", `${req.member.name} 님이 ${target.name} 의 가입을 거절했습니다.`);
  save();
  res.json({ ok: true });
});

/* ---------------- invite codes ---------------- */
app.post("/api/invites", auth, requireManage, (req, res) => {
  let { rank, maxUses, note } = req.body || {};
  if (!R.RANK_MAP[rank]) return res.status(400).json({ error: "발급할 직급을 선택해 주세요." });
  if (!req.member.dev && R.rankInfo(rank).level >= R.rankInfo(req.member.rank).level)
    return res.status(403).json({ error: "본인과 동급 이상 직급의 코드는 만들 수 없습니다." });
  let mu = maxUses === "" || maxUses == null ? null : parseInt(maxUses, 10);
  if (mu != null && (!Number.isFinite(mu) || mu < 1)) return res.status(400).json({ error: "사용 횟수는 1 이상이어야 합니다." });
  const code = genCode();
  if (!Array.isArray(data.inviteCodes)) data.inviteCodes = [];
  data.inviteCodes.unshift({ code, rank, maxUses: mu, uses: 0, note: (note || "").trim(), disabled: false, by: req.member.name, at: Date.now() });
  addLog("invite", `${req.member.name} 님이 초대코드를 생성했습니다. (${rank}${mu ? `, ${mu}회` : ", 무제한"})`);
  save();
  res.json({ ok: true, code });
});

app.delete("/api/invites/:code", auth, requireManage, (req, res) => {
  if (Array.isArray(data.inviteCodes)) data.inviteCodes = data.inviteCodes.filter((c) => c.code !== req.params.code);
  addLog("invite", `${req.member.name} 님이 초대코드(${req.params.code})를 삭제했습니다.`);
  save();
  res.json({ ok: true });
});

/* ---------------- developer ---------------- */
app.get("/api/whoami", (req, res) => {
  const ip = clientIp(req);
  res.json({ ip, isDevIp: isDevIp(ip) });
});

app.patch("/api/members/:id/dev", auth, (req, res) => {
  if (!req.member.dev) return res.status(403).json({ error: "개발자만 사용할 수 있습니다." });
  const target = findMember(req.params.id);
  if (!target || target.status !== "active") return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  if (target.id === req.member.id) return res.status(400).json({ error: "본인의 개발자 권한은 변경할 수 없습니다." });
  target.dev = !target.dev;
  addLog("dev", `${req.member.name} 님이 ${target.name} 의 개발자 권한을 ${target.dev ? "부여" : "해제"}했습니다.`);
  save();
  res.json({ ok: true, dev: target.dev });
});

app.post("/api/dev/allow-ip", auth, (req, res) => {
  if (!req.member.dev) return res.status(403).json({ error: "개발자만 사용할 수 있습니다." });
  const ip = (req.body && req.body.ip ? String(req.body.ip) : clientIp(req)).trim();
  if (!ip) return res.status(400).json({ error: "IP를 확인할 수 없습니다." });
  if (!Array.isArray(data.config.devIps)) data.config.devIps = [];
  if (!data.config.devIps.includes(ip)) data.config.devIps.push(ip);
  addLog("dev", `${req.member.name} 님이 개발자 IP(${ip})를 등록했습니다.`);
  save();
  res.json({ ok: true, devIps: Array.from(devIpSet()) });
});

app.delete("/api/dev/allow-ip", auth, (req, res) => {
  if (!req.member.dev) return res.status(403).json({ error: "개발자만 사용할 수 있습니다." });
  const ip = (req.body && req.body.ip ? String(req.body.ip) : "").trim();
  if (Array.isArray(data.config.devIps)) data.config.devIps = data.config.devIps.filter((x) => x !== ip);
  addLog("dev", `${req.member.name} 님이 개발자 IP(${ip})를 해제했습니다.`);
  save();
  res.json({ ok: true, devIps: Array.from(devIpSet()) });
});

/* ---------------- activities / reports / score ---------------- */
app.post("/api/activities", auth, (req, res) => {
  let { category, title, desc, points, participants, loot } = req.body || {};
  category = ["rp", "op", "report", "etc"].includes(category) ? category : "etc";
  title = (title || "").trim();
  if (!title) return res.status(400).json({ error: "제목을 입력해 주세요." });
  let pts = parseInt(points, 10);
  if (!Number.isFinite(pts)) pts = 0;
  if (pts < 0 || pts > 1000) return res.status(400).json({ error: "점수는 0~1000 사이여야 합니다." });

  let ids = Array.isArray(participants)
    ? participants.filter((id) => { const m = findMember(id); return m && m.status === "active"; })
    : [];
  if (!ids.length) ids = [req.member.id]; // 기본: 작성자
  ids = Array.from(new Set(ids));
  const names = ids.map((id) => { const m = findMember(id); return m ? m.name : ""; });

  let lootObj = null;
  if (loot && Array.isArray(loot.items)) {
    const items = loot.items
      .map((it) => ({
        name: (it.name || "").toString().slice(0, 40),
        qty: Math.max(0, parseInt(it.qty, 10) || 0),
        price: Math.max(0, parseInt(it.price, 10) || 0),
      }))
      .filter((it) => it.name);
    if (items.length) lootObj = { items, total: items.reduce((s, it) => s + it.qty * it.price, 0) };
  }

  const act = {
    id: uid(),
    category,
    title,
    desc: (desc || "").trim().slice(0, 2000),
    points: pts,
    participants: ids,
    participantNames: names,
    loot: lootObj,
    by: req.member.name,
    byId: req.member.id,
    at: Date.now(),
  };
  data.activities.unshift(act);
  if (data.activities.length > 2000) data.activities.length = 2000;
  addLog("activity", `${req.member.name} 님이 [${catLabel(category)}] "${title}" 보고 (점수 ${pts}, ${ids.length}명${lootObj ? `, 장물 ${lootObj.total.toLocaleString()}` : ""})`);
  save();
  res.json({ ok: true });
});

app.delete("/api/activities/:id", auth, (req, res) => {
  const idx = data.activities.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "활동을 찾을 수 없습니다." });
  const a = data.activities[idx];
  if (a.byId !== req.member.id && !memberCanManage(req.member))
    return res.status(403).json({ error: "작성자 또는 간부만 삭제할 수 있습니다." });
  data.activities.splice(idx, 1);
  addLog("activity-del", `${req.member.name} 님이 활동 "${a.title}" 을 삭제했습니다.`);
  save();
  res.json({ ok: true });
});

/* ---------------- events (알림 폴링용) ---------------- */
app.get("/api/events", auth, (req, res) => {
  const after = parseInt(req.query.after, 10) || 0;
  const events = data.logs.filter((l) => l.at > after).slice(0, 20);
  res.json({
    now: Date.now(),
    latestAt: data.logs[0] ? data.logs[0].at : 0,
    events,
    pending: memberCanManage(req.member) ? data.members.filter((m) => m.status === "pending").length : 0,
  });
});

/* ---------------- SPA fallback ---------------- */
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`레전드 조직 관리 서버 실행 중 → http://localhost:${PORT}`);
});
