// ============================================================
//  북부 경찰서(보안국) · 인트라넷  —  백엔드 서버
// ============================================================

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const config = require("./config");
const db = require("./db");

// ============================================================
//  백그라운드 알림 (Web Push) 초기화
//  - web-push 미설치 시에도 서버는 정상 동작 (알림만 비활성)
//  - VAPID 키는 환경변수 우선, 없으면 최초 1회 생성 후 db에 보존
// ============================================================
let webpush = null;
try { webpush = require("web-push"); } catch (e) { console.warn("[PUSH] web-push 미설치 — 'npm install' 후 백그라운드 알림이 켜집니다."); }
let vapidReady = false;
let vapidPublicKey = "";
function initPush() {
  if (!webpush) return;
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const data = db.read();
    if (data.vapid && data.vapid.publicKey && data.vapid.privateKey) {
      pub = data.vapid.publicKey; priv = data.vapid.privateKey;
    } else {
      const k = webpush.generateVAPIDKeys();
      pub = k.publicKey; priv = k.privateKey;
      const d = db.read(); d.vapid = { publicKey: pub, privateKey: priv }; db.write(d);
      console.log("[PUSH] VAPID 키를 새로 생성했습니다.");
    }
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@perfect-bank.local", pub, priv);
    vapidPublicKey = pub; vapidReady = true;
    console.log("[PUSH] 백그라운드 알림 준비 완료");
  } catch (e) { console.warn("[PUSH] VAPID 설정 실패:", e.message); }
}
initPush();

// 지정한 회원들에게 푸시 발송 (만료된 구독은 자동 정리)
async function pushToUsers(userIds, payload) {
  if (!vapidReady || !webpush) return;
  const ids = new Set(userIds);
  const data = db.read();
  const subs = (data.pushSubs || []).filter((s) => ids.has(s.userId));
  if (!subs.length) return;
  const dead = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload));
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint);
      }
    })
  );
  if (dead.length) {
    const d2 = db.read();
    d2.pushSubs = (d2.pushSubs || []).filter((s) => !dead.includes(s.endpoint));
    db.write(d2);
  }
}

// ============================================================
//  디스코드 웹훅 연동
//  - 웹훅 URL은 db(설정) > 환경변수 > config 순으로 사용
//  - fire-and-forget: 디스코드가 실패해도 앱 동작에는 영향 없음
// ============================================================
function getWebhookUrl(data) {
  const fromDb = data && data.settings && data.settings.discordWebhook;
  return (fromDb || process.env.DISCORD_WEBHOOK_URL || config.DISCORD_WEBHOOK_URL || "").trim();
}
const DISCORD_COLORS = { gold: 0xe8772e, red: 0xc0392b, green: 0x5c8c3a, blue: 0x3b7dd8, orange: 0xe0992b, gray: 0x9aa0a6 };
async function sendDiscord(data, { title, description, color, fields }) {
  const url = getWebhookUrl(data);
  if (!url) return false;
  const embed = {
    title: title || undefined,
    description: description || undefined,
    color: typeof color === "number" ? color : DISCORD_COLORS.gold,
    fields: fields && fields.length ? fields : undefined,
    timestamp: new Date().toISOString(),
    footer: { text: "북부 경찰서" },
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "북부 경찰서", embeds: [embed] }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (e) {
    console.warn("[DISCORD] 전송 실패:", e.message);
    return false;
  }
}

// ── 디스코드 OAuth & 봇(역할 동기화) ──
function discordClientId() { return (process.env.DISCORD_CLIENT_ID || config.DISCORD_CLIENT_ID || "").trim(); }
function discordClientSecret() { return (process.env.DISCORD_CLIENT_SECRET || config.DISCORD_CLIENT_SECRET || "").trim(); }
function discordBotToken() { return (process.env.DISCORD_BOT_TOKEN || config.DISCORD_BOT_TOKEN || "").trim(); }
function discordGuildId(data) { return ((data && data.settings && data.settings.discordGuildId) || process.env.DISCORD_GUILD_ID || config.DISCORD_GUILD_ID || "").trim(); }
function discordRoleMap(data) { return (data && data.settings && data.settings.discordRoleMap) || {}; }
function discordLoginEnabled() { return !!(discordClientId() && discordClientSecret()); }
function discordRedirectUri(req) {
  const explicit = (process.env.DISCORD_REDIRECT_URI || config.DISCORD_REDIRECT_URI || "").trim();
  if (explicit) return explicit.replace(/\/+$/, ""); // 명시 설정이 있으면 그대로 (끝 슬래시 제거)
  const host = (req.get("host") || "").trim();
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  // Render 등 배포 환경은 항상 https (디스코드는 localhost 외에는 https만 허용)
  const proto = isLocal ? (req.protocol || "http") : "https";
  return `${proto}://${host}/api/auth/discord/callback`;
}
function discordApi(method, path, token, body) {
  return fetch("https://discord.com/api/v10" + path, {
    method,
    headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
}
// 직급 → 디스코드 역할 동기화 (REST만 사용, 봇 상시연결 불필요). fire-and-forget.
async function syncDiscordRole(userId) {
  try {
    const data = db.read();
    const user = data.users.find((u) => u.id === userId);
    const token = discordBotToken();
    const guild = discordGuildId(data);
    const map = discordRoleMap(data) || {};
    if (!token || !guild || !user || !user.discordId) return;
    const managed = Object.values(map).filter(Boolean);
    if (!managed.length) return;
    const target = (user.status === "approved" && map[user.rank]) ? map[user.rank] : null;
    const r = await discordApi("GET", `/guilds/${guild}/members/${user.discordId}`, token);
    if (!r.ok) { console.warn("[DISCORD] 멤버 조회 실패:", r.status); return; }
    const member = await r.json();
    const roles = new Set(member.roles || []);
    for (const rid of managed) roles.delete(rid); // 관리 대상 역할 제거
    if (target) roles.add(target);               // 현재 직급 역할만 부여
    const p = await discordApi("PATCH", `/guilds/${guild}/members/${user.discordId}`, token, { roles: [...roles] });
    if (!p.ok) console.warn("[DISCORD] 역할 변경 실패:", p.status);
  } catch (e) { console.warn("[DISCORD] 역할 동기화 오류:", e.message); }
}

const app = express();

// 리버스 프록시(nginx 등) 뒤에서 실제 접속자 IP 인식
if (config.TRUST_PROXY) app.set("trust proxy", true);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // HTTPS 운영 시 true 로 변경
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7일
    },
  })
);

// ------------------------------------------------------------
//  유틸
// ------------------------------------------------------------

// 접속자 IP 추출 + 정규화
function getClientIp(req) {
  let ip =
    req.ip ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "";
  ip = String(ip).replace(/^::ffff:/, ""); // IPv4-mapped IPv6 정규화
  return ip;
}

function isDeveloperIp(ip) {
  return config.DEVELOPER_IPS.includes(ip);
}

// 개발자(소유자) 계정 여부 — 모든 권한을 가지며 다른 관리자가 강등/삭제/경고할 수 없습니다.
function isOwnerUser(u) {
  return !!(u && u.isOwner);
}

// 활동 로그 기록 (data 객체를 받아 push 만 함; 호출한 쪽에서 db.write 필요)
function addLog(data, { type, icon, actor, actorId, message }) {
  if (!data.logs) data.logs = [];
  data.logs.push({
    id: db.uid("log"),
    type: type || "info",
    icon: icon || "•",
    actor: actor || "시스템",
    actorId: actorId || null,
    message: message || "",
    createdAt: new Date().toISOString(),
  });
  // 최근 500건만 유지
  if (data.logs.length > 500) data.logs = data.logs.slice(-500);
}

// 직급명으로 소속 티어 정보 찾기
function tierOfRank(rankName) {
  for (const t of config.TIERS) {
    const idx = t.ranks.indexOf(rankName);
    if (idx !== -1) return { tier: t, rankIndex: idx };
  }
  return null;
}

// 모든 유효 직급명 목록
function allRanks() {
  return config.TIERS.flatMap((t) => t.ranks);
}

// 팀 정보 조회 + 표시 이름 계산 (prefix + 팀직책)
function teamByKey(key) {
  return (config.TEAMS || []).find((t) => t.key === key) || null;
}
function teamTitleOf(teamKey, teamRole) {
  const t = teamByKey(teamKey);
  if (!t) return "";
  const role = (config.TEAM_ROLES || []).includes(teamRole) ? teamRole : (config.TEAM_ROLES ? config.TEAM_ROLES[config.TEAM_ROLES.length - 1] : "팀원");
  return t.prefix + role; // 예: 인사 + 팀원 = 인사팀원
}

// 클라이언트로 내보낼 안전한 유저 객체 (비밀번호·IP 제외)
function publicUser(u) {
  if (!u) return null;
  const data = db.read();
  const unread = countUnread(u, data);
  const ti = tierOfRank(u.rank);
  const tm = teamByKey(u.team);
  return {
    id: u.id,
    username: u.username,
    gobun: u.gobun || "",
    rank: u.rank,
    tier: ti ? ti.tier.label : "미배정",
    tierKey: ti ? ti.tier.key : null,
    tierIcon: ti ? ti.tier.icon : "•",
    team: u.team || "",
    teamName: tm ? tm.name : "",
    teamIcon: tm ? tm.icon : "",
    teamRole: u.teamRole || "",
    teamTitle: tm ? teamTitleOf(u.team, u.teamRole) : "",
    status: u.status,
    isAdmin: !!u.isAdmin,
    isOwner: !!u.isOwner,
    isWorking: !!u.isWorking,
    createdAt: u.createdAt,
    discordLinked: !!u.discordId,
    discordUsername: u.discordUsername || "",
    discordAvatar: u.discordAvatar || "",
    // registeredIp 는 보안상 클라이언트로 보내지 않습니다 (서버 내부에서만 사용)
    attendance: (u.attendance || []).slice(-20).reverse(),
    unread,
  };
}

// 미확인 알람 개수 (마지막 확인 시각 이후의 공지 + 본인 경고)
function countUnread(user, data) {
  const last = user.lastSeen || 0;
  const ann = data.announcements.filter(
    (a) => new Date(a.createdAt).getTime() > last
  ).length;
  const warn = data.warnings.filter(
    (w) => w.targetUserId === user.id && new Date(w.createdAt).getTime() > last
  ).length;
  return ann + warn;
}

function findUserById(id) {
  return db.read().users.find((u) => u.id === id) || null;
}

// ------------------------------------------------------------
//  인증 미들웨어
// ------------------------------------------------------------

function resolveUser(req, res, next) {
  if (!req.session.userId) {
    req.currentUser = null;
    return next();
  }
  req.currentUser = findUserById(req.session.userId);
  if (!req.currentUser) {
    req.session.destroy(() => {});
  }
  next();
}
app.use(resolveUser);

function requireAuth(req, res, next) {
  if (!req.currentUser)
    return res.status(401).json({ error: "로그인이 필요합니다." });
  next();
}

function requireApproved(req, res, next) {
  if (!req.currentUser)
    return res.status(401).json({ error: "로그인이 필요합니다." });
  if (req.currentUser.status !== "approved")
    return res.status(403).json({ error: "관리자 승인 후 이용할 수 있습니다." });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || !req.currentUser.isAdmin)
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  next();
}

// ============================================================
//  공개 메타데이터 (가입 폼의 직급 선택 / 카테고리 등)
// ============================================================
app.get("/api/meta", (req, res) => {
  res.json({
    tiers: config.TIERS.map((t) => ({
      key: t.key,
      label: t.label,
      icon: t.icon,
      ranks: t.ranks,
    })),
    categories: config.ANNOUNCEMENT_CATEGORIES,
    reportCategories: config.REPORT_CATEGORIES,
    currencyUnit: config.CURRENCY_UNIT || "원",
    teams: (config.TEAMS || []).map((t) => ({ key: t.key, name: t.name, prefix: t.prefix, icon: t.icon })),
    teamRoles: config.TEAM_ROLES || [],
    reportResults: config.RP_RESULTS || ["승리", "패배"],
    winPoints: config.RP_WIN_POINTS != null ? config.RP_WIN_POINTS : 3,
    losePoints: config.RP_LOSE_POINTS != null ? config.RP_LOSE_POINTS : 1,
    pointUnit: config.POINT_UNIT || "점",
    warnKickThreshold: config.WARN_KICK_THRESHOLD || 3,
    leaveTypes: config.LEAVE_TYPES || [],
    discordLoginEnabled: discordLoginEnabled(),
    pushEnabled: vapidReady,
    vapidPublicKey: vapidReady ? vapidPublicKey : "",
    defaultRank: config.DEFAULT_RANK,
    allowRankOnSignup: !!config.ALLOW_RANK_ON_SIGNUP,
    requireGobun: !!config.REQUIRE_GOBUN,
  });
});

// ============================================================
//  인증 API
// ============================================================

// 회원가입
app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const gobun = String(req.body.gobun || "").trim();
  const ip = getClientIp(req);
  const dev = isDeveloperIp(ip);

  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ error: "아이디는 2~20자로 입력해 주세요." });
  if (password.length < 4)
    return res.status(400).json({ error: "비밀번호는 4자 이상이어야 합니다." });

  // 고유번호(고번) 검증
  if (config.REQUIRE_GOBUN) {
    if (!gobun)
      return res.status(400).json({ error: "고유번호(고번)를 입력해 주세요." });
    if (gobun.length > 20)
      return res.status(400).json({ error: "고유번호는 20자 이하로 입력해 주세요." });
  }

  // 가입 시 선택한 직급 (허용된 직급이 아니면 기본 직급)
  let rank = config.DEFAULT_RANK;
  if (config.ALLOW_RANK_ON_SIGNUP && req.body.rank && allRanks().includes(String(req.body.rank)))
    rank = String(req.body.rank);

  // 가입 시 선택한 팀 (선택사항)
  let team = "";
  let teamRole = "";
  if (req.body.team && teamByKey(String(req.body.team))) {
    team = String(req.body.team);
    teamRole = (config.TEAM_ROLES || []).includes(String(req.body.teamRole))
      ? String(req.body.teamRole)
      : (config.TEAM_ROLES ? config.TEAM_ROLES[config.TEAM_ROLES.length - 1] : "팀원");
  }

  const data = db.read();

  // 아이디 중복 확인
  if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });

  // 고유번호 중복 확인
  if (gobun && data.users.some((u) => (u.gobun || "") === gobun))
    return res.status(409).json({ error: "이미 사용 중인 고유번호입니다." });

  // IP 중복 확인 (개발자 IP는 예외)
  if (config.BLOCK_DUPLICATE_IP && !dev) {
    if (data.users.some((u) => u.registeredIp === ip)) {
      return res
        .status(409)
        .json({ error: "이미 이 IP로 가입된 계정이 있습니다. (1 IP = 1 계정)" });
    }
  }

  const now = new Date().toISOString();
  const user = {
    id: db.uid("user"),
    username,
    gobun,
    passwordHash: bcrypt.hashSync(password, 10),
    registeredIp: ip,
    rank,
    team,
    teamRole,
    status: dev ? "approved" : "pending", // 개발자 IP는 즉시 승인
    isAdmin: dev, // 개발자 IP는 관리자
    isOwner: dev, // 개발자 IP는 소유자(최고 권한, 강등·삭제 불가)
    createdAt: now,
    approvedAt: dev ? now : null,
    isWorking: false,
    attendance: [],
    lastSeen: 0,
  };

  data.users.push(user);
  addLog(data, {
    type: dev ? "owner" : "register",
    icon: dev ? "👑" : "📝",
    actor: username,
    actorId: user.id,
    message: dev
      ? `개발자(소유자) 계정으로 가입 · 직급 ${rank}`
      : `가입 신청 (승인 대기) · 희망직급 ${rank}`,
  });
  db.write(data);

  if (dev) {
    // 개발자는 바로 로그인 처리
    req.session.userId = user.id;
    return res.json({
      ok: true,
      developer: true,
      message: "개발자 IP로 인식되어 최고 관리자(소유자) 권한으로 가입되었습니다.",
      user: publicUser(user),
    });
  }

  sendDiscord(data, {
    title: "🆕 새 가입 신청",
    description: "관리자 승인이 필요합니다.",
    color: DISCORD_COLORS.orange,
    fields: [
      { name: "이름", value: username, inline: true },
      { name: "고번", value: String(req.body.gobun || "-"), inline: true },
      { name: "희망 직급", value: rank, inline: true },
    ],
  });

  return res.json({
    ok: true,
    developer: false,
    message: "가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
  });
});

// 로그인
app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const data = db.read();
  const user = data.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash))
    return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });

  if (user.status === "rejected")
    return res.status(403).json({ error: "가입이 거절된 계정입니다." });

  req.session.userId = user.id;
  addLog(data, { type: "login", icon: "🔑", actor: user.username, actorId: user.id, message: "로그인" });
  db.write(data);
  return res.json({ ok: true, user: publicUser(user) });
});

// ============================================================
//  디스코드 OAuth 로그인 / 연동
// ============================================================
app.get("/api/auth/discord", (req, res) => {
  if (!discordLoginEnabled()) return res.status(503).send("디스코드 로그인이 설정되지 않았습니다.");
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  req.session.discordState = state;
  req.session.discordLink = !!req.currentUser; // 로그인 상태면 '연동' 모드
  const params = new URLSearchParams({
    client_id: discordClientId(),
    redirect_uri: discordRedirectUri(req),
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });
  res.redirect("https://discord.com/api/oauth2/authorize?" + params.toString());
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const back = (q) => res.redirect("/?discord=" + q);
  try {
    if (!discordLoginEnabled()) return back("disabled");
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.discordState) return back("state");
    const isLink = !!req.session.discordLink;
    req.session.discordState = null;
    req.session.discordLink = false;

    // 1) code → access token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: discordClientId(),
        client_secret: discordClientSecret(),
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: discordRedirectUri(req),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return back("token");
    const token = await tokenRes.json();

    // 2) 사용자 정보
    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!meRes.ok) return back("me");
    const du = await meRes.json();
    const dname = du.global_name || du.username || ("user" + du.id);
    const davatar = du.avatar ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.png` : "";

    const data = db.read();

    // A) 연동 모드 (로그인된 사용자)
    if (isLink && req.currentUser) {
      const taken = data.users.find((u) => u.discordId === du.id && u.id !== req.currentUser.id);
      if (taken) return back("conflict");
      const u = data.users.find((x) => x.id === req.currentUser.id);
      u.discordId = du.id; u.discordUsername = dname; u.discordAvatar = davatar;
      addLog(data, { type: "discord-link", icon: "🔗", actor: u.username, actorId: u.id, message: `디스코드 연동 (${dname})` });
      db.write(data);
      syncDiscordRole(u.id);
      return back("linked");
    }

    // B) 로그인 모드 — 이미 연동된 계정 찾기
    const existing = data.users.find((u) => u.discordId === du.id);
    if (existing) {
      if (existing.status === "rejected") return back("rejected");
      if (existing.status !== "approved") return back("pending");
      req.session.userId = existing.id;
      addLog(data, { type: "login", icon: "🔑", actor: existing.username, actorId: existing.id, message: "디스코드 로그인" });
      db.write(data);
      return back("login");
    }

    // C) 신규 — 승인 대기 계정 생성 (디스코드 전용, 비밀번호 없음)
    let base = dname.replace(/\s+/g, "").slice(0, 20) || "user";
    let username = base, n = 1;
    while (data.users.some((x) => x.username.toLowerCase() === username.toLowerCase())) username = base + ++n;
    const newUser = {
      id: db.uid("user"),
      username,
      gobun: "",
      rank: config.DEFAULT_RANK,
      status: "pending",
      isAdmin: false,
      isOwner: false,
      team: "", teamRole: "",
      attendance: [],
      createdAt: new Date().toISOString(),
      registeredIp: getClientIp(req),
      discordId: du.id, discordUsername: dname, discordAvatar: davatar,
    };
    data.users.push(newUser);
    addLog(data, { type: "register", icon: "📝", actor: username, actorId: newUser.id, message: `디스코드로 가입 신청 (승인 대기) — ${dname}` });
    db.write(data);
    sendDiscord(data, {
      title: "🆕 새 가입 신청 (디스코드)",
      description: "관리자 승인이 필요합니다.",
      color: DISCORD_COLORS.orange,
      fields: [{ name: "이름", value: username, inline: true }, { name: "디스코드", value: dname, inline: true }],
    });
    return back("pending");
  } catch (e) {
    console.warn("[DISCORD] OAuth 오류:", e.message);
    return back("error");
  }
});

// 디스코드 연동 해제
app.post("/api/discord/unlink", requireApproved, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.currentUser.id);
  if (!u) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  const wasLinked = !!u.discordId;
  const oldDiscordId = u.discordId;
  u.discordId = null; u.discordUsername = ""; u.discordAvatar = "";
  addLog(data, { type: "discord-link", icon: "🔓", actor: u.username, actorId: u.id, message: "디스코드 연동 해제" });
  db.write(data);
  // 연동 해제 시 디스코드 역할도 회수
  if (wasLinked && oldDiscordId) {
    const token = discordBotToken(), guild = discordGuildId(data), map = discordRoleMap(data) || {};
    const managed = Object.values(map).filter(Boolean);
    if (token && guild && managed.length) {
      (async () => {
        try {
          const r = await discordApi("GET", `/guilds/${guild}/members/${oldDiscordId}`, token);
          if (r.ok) {
            const m = await r.json();
            const roles = (m.roles || []).filter((rid) => !managed.includes(rid));
            await discordApi("PATCH", `/guilds/${guild}/members/${oldDiscordId}`, token, { roles });
          }
        } catch (e) {}
      })();
    }
  }
  res.json({ ok: true, user: publicUser(u) });
});

// 로그아웃
app.post("/api/logout", (req, res) => {
  if (req.currentUser) {
    const data = db.read();
    addLog(data, { type: "logout", icon: "🚪", actor: req.currentUser.username, actorId: req.currentUser.id, message: `로그아웃` });
    db.write(data);
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// 내 정보
app.get("/api/me", (req, res) => {
  if (!req.currentUser) return res.json({ user: null });
  res.json({ user: publicUser(req.currentUser) });
});

// 브라우저 푸시 구독 등록 (백그라운드 알림)
app.post("/api/push/subscribe", requireApproved, (req, res) => {
  const sub = req.body && req.body.subscription ? req.body.subscription : req.body;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: "구독 정보가 올바르지 않습니다." });
  const data = db.read();
  data.pushSubs = data.pushSubs || [];
  data.pushSubs = data.pushSubs.filter((s) => s.endpoint !== sub.endpoint); // 중복 제거
  data.pushSubs.push({
    userId: req.currentUser.id,
    endpoint: sub.endpoint,
    keys: sub.keys,
    createdAt: new Date().toISOString(),
  });
  db.write(data);
  res.json({ ok: true });
});

// 브라우저 푸시 구독 해제
app.post("/api/push/unsubscribe", requireApproved, (req, res) => {
  const endpoint = String((req.body && req.body.endpoint) || "");
  const data = db.read();
  data.pushSubs = (data.pushSubs || []).filter((s) => s.endpoint !== endpoint);
  db.write(data);
  res.json({ ok: true });
});

// 알람 확인 처리 (마지막 확인 시각 갱신)
app.post("/api/seen", requireAuth, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.currentUser.id);
  if (!u) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  u.lastSeen = Date.now();
  db.write(data);
  res.json({ ok: true });
});

// ============================================================
//  출근 / 퇴근
// ============================================================

app.post("/api/attendance/clock-in", requireApproved, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.currentUser.id);
  if (u.isWorking)
    return res.status(400).json({ error: "이미 출근 처리되어 있습니다." });

  const rec = { id: db.uid("att"), clockIn: new Date().toISOString(), clockOut: null };
  u.attendance = u.attendance || [];
  u.attendance.push(rec);
  u.isWorking = true;
  addLog(data, { type: "clock-in", icon: "🟢", actor: u.username, actorId: u.id, message: "출근" });
  db.write(data);
  res.json({ ok: true, record: rec, user: publicUser(u) });
});

app.post("/api/attendance/clock-out", requireApproved, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.currentUser.id);
  if (!u.isWorking)
    return res.status(400).json({ error: "출근 기록이 없습니다. 먼저 출근해 주세요." });

  const open = [...(u.attendance || [])].reverse().find((r) => !r.clockOut);
  if (open) open.clockOut = new Date().toISOString();
  u.isWorking = false;
  addLog(data, { type: "clock-out", icon: "🔴", actor: u.username, actorId: u.id, message: "퇴근" });
  db.write(data);
  res.json({ ok: true, record: open, user: publicUser(u) });
});

// ============================================================
//  홈 대시보드 요약
// ============================================================
app.get("/api/dashboard", requireApproved, (req, res) => {
  const data = db.read();
  const approved = data.users.filter((u) => u.status === "approved");
  const now = new Date();
  const isToday = (iso) => {
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // 조직 현황
  const org = {
    totalMembers: approved.length,
    workingNow: approved.filter((u) => u.isWorking).length,
    todayAttended: approved.filter((u) => (u.attendance || []).some((r) => r.clockIn && isToday(r.clockIn))).length,
  };

  // 내 현황
  const meUser = data.users.find((u) => u.id === req.currentUser.id);
  const myReports = (data.reports || []).filter((r) => r.authorId === req.currentUser.id);
  let weekMin = 0;
  for (const r of meUser.attendance || []) {
    const inT = new Date(r.clockIn).getTime();
    if (isNaN(inT)) continue;
    const outT = r.clockOut ? new Date(r.clockOut).getTime() : Date.now();
    const start = Math.max(inT, weekAgo);
    if (outT > start) weekMin += (outT - start) / 60000;
  }
  const me = {
    weekMinutes: Math.round(weekMin),
    isWorking: !!meUser.isWorking,
    reportCount: myReports.length,
    reportPoints: myReports.reduce((s, r) => s + (r.points || 0), 0),
    warningCount: (data.warnings || []).filter((w) => w.targetUserId === req.currentUser.id).length,
  };

  // 점수 순위 (RP 보고서 점수 합계 순위)
  const winLabel = (config.RP_RESULTS || ["승리"])[0];
  const map = {};
  for (const r of data.reports || []) {
    if (!map[r.authorId]) {
      const u = data.users.find((x) => x.id === r.authorId);
      map[r.authorId] = { userId: r.authorId, username: u ? u.username : r.author, rank: u ? u.rank : r.authorRank || "", count: 0, totalPoints: 0, wins: 0, losses: 0 };
    }
    map[r.authorId].count++;
    map[r.authorId].totalPoints += r.points || 0;
    if (r.result === winLabel) map[r.authorId].wins++;
    else if (r.result) map[r.authorId].losses++;
  }
  const topSellers = Object.values(map).sort((a, b) => b.totalPoints - a.totalPoints || b.count - a.count).slice(0, 5);

  // 최신 공지
  const sortedAnn = [...(data.announcements || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latestAnnouncement = sortedAnn[0]
    ? { title: sortedAnn[0].title, type: sortedAnn[0].type, category: sortedAnn[0].category, createdAt: sortedAnn[0].createdAt, author: sortedAnn[0].author }
    : null;

  const out = { org, me, topSellers, latestAnnouncement };

  // 관리자 알림
  if (req.currentUser.isAdmin) {
    const threshold = config.WARN_KICK_THRESHOLD || 3;
    out.admin = {
      pendingCount: data.users.filter((u) => u.status === "pending").length,
      kickReviewCount: approved.filter((u) => !u.isOwner && (data.warnings || []).filter((w) => w.targetUserId === u.id).length >= threshold).length,
      pendingLeaves: (data.leaves || []).filter((l) => l.status === "pending").length,
    };
  }
  res.json(out);
});

// ============================================================
//  휴가 신청
// ============================================================
// 휴가 신청 제출
app.post("/api/leaves", requireApproved, (req, res) => {
  const type = (config.LEAVE_TYPES || []).includes(String(req.body.type)) ? String(req.body.type) : (config.LEAVE_TYPES || ["기타"])[0];
  const startDate = String(req.body.startDate || "").trim();
  const endDate = String(req.body.endDate || "").trim();
  const reason = String(req.body.reason || "").trim();
  if (!startDate || !endDate) return res.status(400).json({ error: "시작일과 종료일을 입력해 주세요." });
  if (endDate < startDate) return res.status(400).json({ error: "종료일이 시작일보다 빠를 수 없습니다." });
  if (!reason) return res.status(400).json({ error: "사유를 입력해 주세요." });

  const data = db.read();
  data.leaves = data.leaves || [];
  const lv = {
    id: db.uid("lv"),
    userId: req.currentUser.id,
    username: req.currentUser.username,
    rank: req.currentUser.rank,
    type, startDate, endDate, reason,
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedBy: null,
    decidedAt: null,
  };
  data.leaves.push(lv);
  addLog(data, { type: "leave-req", icon: "🌴", actor: req.currentUser.username, actorId: req.currentUser.id, message: `휴가 신청 — ${type} ${startDate}~${endDate}` });
  db.write(data);
  sendDiscord(data, {
    title: "🌴 휴가 신청",
    description: reason,
    color: DISCORD_COLORS.blue,
    fields: [
      { name: "신청자", value: `${req.currentUser.username} (${req.currentUser.rank || "-"})`, inline: true },
      { name: "종류", value: type, inline: true },
      { name: "기간", value: `${startDate} ~ ${endDate}`, inline: true },
    ],
  });
  res.json({ ok: true, leave: lv });
});

// 내 휴가 신청 목록
app.get("/api/leaves", requireApproved, (req, res) => {
  const data = db.read();
  const list = (data.leaves || [])
    .filter((l) => l.userId === req.currentUser.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ leaves: list });
});

// 휴가 신청 취소 (본인 대기건 또는 관리자)
app.delete("/api/leaves/:id", requireApproved, (req, res) => {
  const data = db.read();
  data.leaves = data.leaves || [];
  const lv = data.leaves.find((l) => l.id === req.params.id);
  if (!lv) return res.status(404).json({ error: "신청을 찾을 수 없습니다." });
  if (lv.userId !== req.currentUser.id && !req.currentUser.isAdmin)
    return res.status(403).json({ error: "본인 신청만 취소할 수 있습니다." });
  data.leaves = data.leaves.filter((l) => l.id !== req.params.id);
  addLog(data, { type: "leave-cancel", icon: "🗑️", actor: req.currentUser.username, actorId: req.currentUser.id, message: `휴가 신청 취소 — ${lv.type} ${lv.startDate}~${lv.endDate}` });
  db.write(data);
  res.json({ ok: true });
});

// 전체 휴가 신청 (관리자)
app.get("/api/admin/leaves", requireAdmin, (req, res) => {
  const data = db.read();
  const list = [...(data.leaves || [])].sort((a, b) => {
    // 대기건 먼저, 그 다음 최신순
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  res.json({ leaves: list, pendingCount: list.filter((l) => l.status === "pending").length });
});

// 휴가 승인 / 거절 (관리자)
app.post("/api/admin/leaves/:id/decision", requireAdmin, (req, res) => {
  const decision = req.body.decision === "approved" ? "approved" : "rejected";
  const data = db.read();
  const lv = (data.leaves || []).find((l) => l.id === req.params.id);
  if (!lv) return res.status(404).json({ error: "신청을 찾을 수 없습니다." });
  lv.status = decision;
  lv.decidedBy = req.currentUser.username;
  lv.decidedAt = new Date().toISOString();
  addLog(data, { type: "leave-decide", icon: decision === "approved" ? "✅" : "🚫", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${lv.username} 휴가 ${decision === "approved" ? "승인" : "거절"} — ${lv.type} ${lv.startDate}~${lv.endDate}` });
  db.write(data);
  pushToUsers([lv.userId], {
    title: decision === "approved" ? "✅ 휴가 승인" : "🚫 휴가 거절",
    body: `${lv.type} ${lv.startDate}~${lv.endDate}`,
    tag: "perfect-bank",
    url: "/",
  });
  sendDiscord(data, {
    title: decision === "approved" ? "✅ 휴가 승인" : "🚫 휴가 거절",
    color: decision === "approved" ? DISCORD_COLORS.green : DISCORD_COLORS.red,
    fields: [
      { name: "대상", value: `${lv.username} (${lv.rank || "-"})`, inline: true },
      { name: "기간", value: `${lv.type} ${lv.startDate}~${lv.endDate}`, inline: true },
      { name: "처리자", value: req.currentUser.username, inline: true },
    ],
  });
  res.json({ ok: true, leave: lv });
});

// ============================================================
//  개인 프로필
// ============================================================
app.get("/api/profile/:id", requireApproved, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.params.id && x.status === "approved");
  if (!u) return res.status(404).json({ error: "회원을 찾을 수 없습니다." });

  const ti = tierOfRank(u.rank);
  const tm = teamByKey(u.team);
  const myReports = (data.reports || []).filter((r) => r.authorId === u.id);
  // 누적 근무시간
  let totalMin = 0;
  for (const r of u.attendance || []) {
    const inT = new Date(r.clockIn).getTime();
    if (isNaN(inT)) continue;
    const outT = r.clockOut ? new Date(r.clockOut).getTime() : Date.now();
    if (outT > inT) totalMin += (outT - inT) / 60000;
  }
  const recentAtt = [...(u.attendance || [])].reverse().slice(0, 8).map((r) => ({
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    minutes: r.clockIn ? Math.round(((r.clockOut ? new Date(r.clockOut).getTime() : Date.now()) - new Date(r.clockIn).getTime()) / 60000) : 0,
  }));

  const canSeeWarnings = req.currentUser.id === u.id || req.currentUser.isAdmin;
  const warns = (data.warnings || []).filter((w) => w.targetUserId === u.id);

  res.json({
    profile: {
      id: u.id,
      username: u.username,
      gobun: u.gobun || "",
      rank: u.rank,
      tier: ti ? ti.tier.label : "미배정",
      tierIcon: ti ? ti.tier.icon : "•",
      team: u.team || "",
      teamName: tm ? tm.name : "",
      teamTitle: u.team ? teamTitleOf(u.team, u.teamRole) : "",
      teamIcon: tm ? tm.icon : "",
      isWorking: !!u.isWorking,
      isAdmin: !!u.isAdmin,
      isOwner: !!u.isOwner,
      createdAt: u.createdAt,
      isMe: req.currentUser.id === u.id,
      discordLinked: !!u.discordId,
      discordUsername: u.discordUsername || "",
      discordAvatar: u.discordAvatar || "",
      stats: {
        reportCount: myReports.length,
        reportPoints: myReports.reduce((s, r) => s + (r.points || 0), 0),
        totalMinutes: Math.round(totalMin),
        warningCount: warns.length,
      },
      recentAttendance: recentAtt,
      warnings: canSeeWarnings ? warns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : null,
    },
  });
});

// ============================================================
//  관리자 설정 (디스코드 연동 등)
// ============================================================
app.get("/api/admin/settings", requireAdmin, (req, res) => {
  const data = db.read();
  const url = (data.settings && data.settings.discordWebhook) || "";
  res.json({
    discordWebhook: url,
    discordConfigured: !!getWebhookUrl(data),
    discordFromEnv: !!(process.env.DISCORD_WEBHOOK_URL || config.DISCORD_WEBHOOK_URL),
    // OAuth / 봇
    discordLoginEnabled: discordLoginEnabled(),
    discordClientIdSet: !!discordClientId(),
    discordSecretSet: !!discordClientSecret(),
    discordBotTokenSet: !!discordBotToken(),
    discordRedirectUri: discordRedirectUri(req),
    discordGuildId: discordGuildId(data),
    discordRoleMap: discordRoleMap(data),
    ranks: allRanks(),
  });
});

app.post("/api/admin/settings", requireAdmin, (req, res) => {
  const data = db.read();
  data.settings = data.settings || {};
  // 디스코드 웹훅
  if (req.body.discordWebhook !== undefined) {
    const webhook = String(req.body.discordWebhook || "").trim();
    if (webhook && !/^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//i.test(webhook))
      return res.status(400).json({ error: "올바른 디스코드 웹훅 URL이 아닙니다. (https://discord.com/api/webhooks/... 형식)" });
    data.settings.discordWebhook = webhook;
    addLog(data, { type: "settings", icon: "⚙️", actor: req.currentUser.username, actorId: req.currentUser.id, message: webhook ? "디스코드 웹훅 설정 변경" : "디스코드 웹훅 해제" });
  }
  // 길드(서버) ID
  if (req.body.discordGuildId !== undefined) {
    data.settings.discordGuildId = String(req.body.discordGuildId || "").trim();
  }
  // 직급 → 역할 ID 매핑
  if (req.body.discordRoleMap !== undefined) {
    let map = req.body.discordRoleMap;
    if (typeof map === "string") { try { map = JSON.parse(map); } catch (e) { return res.status(400).json({ error: "역할 매핑 JSON 형식이 올바르지 않습니다." }); } }
    if (map && typeof map === "object" && !Array.isArray(map)) {
      const clean = {};
      for (const k of Object.keys(map)) { const v = String(map[k] || "").trim(); if (v) clean[k] = v; }
      data.settings.discordRoleMap = clean;
    }
  }
  if (req.body.discordGuildId !== undefined || req.body.discordRoleMap !== undefined) {
    addLog(data, { type: "settings", icon: "⚙️", actor: req.currentUser.username, actorId: req.currentUser.id, message: "디스코드 역할 동기화 설정 변경" });
  }
  db.write(data);
  res.json({ ok: true, discordConfigured: !!getWebhookUrl(data) });
});

app.post("/api/admin/settings/test-discord", requireAdmin, async (req, res) => {
  const data = db.read();
  if (!getWebhookUrl(data)) return res.status(400).json({ error: "먼저 웹훅 URL을 저장해 주세요." });
  const ok = await sendDiscord(data, {
    title: "🔔 연동 테스트",
    description: `${req.currentUser.username} 님이 디스코드 연동을 테스트했습니다. 이 메시지가 보이면 정상 연동된 것입니다!`,
    color: DISCORD_COLORS.green,
  });
  if (ok) res.json({ ok: true });
  else res.status(502).json({ error: "디스코드로 전송하지 못했습니다. 웹훅 URL을 다시 확인해 주세요." });
});

// ============================================================
//  공지사항 / 경고 공지
// ============================================================

app.get("/api/announcements", requireApproved, (req, res) => {
  const data = db.read();
  const list = [...data.announcements].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ announcements: list });
});

app.post("/api/announcements", requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim();
  const body = String(req.body.body || "").trim();
  const type = req.body.type === "warning" ? "warning" : "notice"; // 공지 / 경고
  // 카테고리 (허용 목록 외 값이면 첫 번째 기본값)
  let category = String(req.body.category || "").trim();
  if (!config.ANNOUNCEMENT_CATEGORIES.includes(category))
    category = config.ANNOUNCEMENT_CATEGORIES[0];

  if (!title) return res.status(400).json({ error: "제목을 입력해 주세요." });

  const data = db.read();
  const item = {
    id: db.uid("ann"),
    title,
    body,
    type,
    category,
    author: req.currentUser.username,
    createdAt: new Date().toISOString(),
  };
  data.announcements.push(item);
  addLog(data, {
    type: type === "warning" ? "warn-notice" : "notice",
    icon: type === "warning" ? "⚠️" : "📢",
    actor: req.currentUser.username,
    actorId: req.currentUser.id,
    message: `${type === "warning" ? "경고 공지" : category} 게시 — ${title}`,
  });
  db.write(data);

  // 백그라운드 알림: 작성자 제외 전체 승인 회원에게
  const targets = data.users
    .filter((u) => u.status === "approved" && u.id !== req.currentUser.id)
    .map((u) => u.id);
  pushToUsers(targets, {
    title: type === "warning" ? "⚠️ 새 경고 공지" : "📢 새 공지사항",
    body: title,
    tag: "perfect-bank",
    url: "/",
  });

  sendDiscord(data, {
    title: `${type === "warning" ? "⚠️ 경고 공지" : "📢 " + category}`,
    description: `**${title}**${body ? "\n" + body : ""}`,
    color: type === "warning" ? DISCORD_COLORS.red : DISCORD_COLORS.gold,
    fields: [{ name: "작성자", value: req.currentUser.username, inline: true }],
  });

  res.json({ ok: true, announcement: item });
});

app.delete("/api/announcements/:id", requireAdmin, (req, res) => {
  const data = db.read();
  const before = data.announcements.length;
  data.announcements = data.announcements.filter((a) => a.id !== req.params.id);
  db.write(data);
  res.json({ ok: true, removed: before - data.announcements.length });
});

// ============================================================
//  개인 경고 기록
// ============================================================

// 내 경고 조회
app.get("/api/warnings", requireApproved, (req, res) => {
  const data = db.read();
  const list = data.warnings
    .filter((w) => w.targetUserId === req.currentUser.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ warnings: list });
});

// ============================================================
//  업무/판매 보고서 (예: 로또 판매 보고서)
// ============================================================

// 보고서 작성 (승인된 직원 누구나)
app.post("/api/reports", requireApproved, (req, res) => {
  const category = config.REPORT_CATEGORIES.includes(String(req.body.category || "").trim())
    ? String(req.body.category).trim()
    : config.REPORT_CATEGORIES[0];
  const participants = String(req.body.participants || "").trim();
  const content = String(req.body.content || "").trim();
  const results = config.RP_RESULTS || ["승리", "패배"];
  const result = results.includes(String(req.body.result)) ? String(req.body.result) : results[0];
  const winLabel = results[0];
  const points = result === winLabel
    ? (config.RP_WIN_POINTS != null ? config.RP_WIN_POINTS : 3)
    : (config.RP_LOSE_POINTS != null ? config.RP_LOSE_POINTS : 1);

  const ti = tierOfRank(req.currentUser.rank);
  const data = db.read();
  data.reports = data.reports || [];
  const rep = {
    id: db.uid("rep"),
    authorId: req.currentUser.id,
    author: req.currentUser.username,
    authorRank: req.currentUser.rank,
    authorTier: ti ? ti.tier.label : "",
    category,
    participants,
    result,
    points,
    content,
    createdAt: new Date().toISOString(),
  };
  data.reports.push(rep);
  addLog(data, {
    type: "report",
    icon: "🧾",
    actor: req.currentUser.username,
    actorId: req.currentUser.id,
    message: `RP 보고서 — ${category} · ${result} (+${points}${config.POINT_UNIT || "점"})${participants ? " · " + participants : ""}`,
  });
  db.write(data);
  res.json({ ok: true, report: rep });
});

// 내 보고서 목록
app.get("/api/reports", requireApproved, (req, res) => {
  const data = db.read();
  const list = (data.reports || [])
    .filter((r) => r.authorId === req.currentUser.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ reports: list });
});

// 보고서 삭제 (작성자 본인 또는 관리자)
app.delete("/api/reports/:id", requireApproved, (req, res) => {
  const data = db.read();
  data.reports = data.reports || [];
  const rep = data.reports.find((r) => r.id === req.params.id);
  if (!rep) return res.status(404).json({ error: "보고서를 찾을 수 없습니다." });
  if (rep.authorId !== req.currentUser.id && !req.currentUser.isAdmin)
    return res.status(403).json({ error: "본인 보고서만 삭제할 수 있습니다." });
  data.reports = data.reports.filter((r) => r.id !== req.params.id);
  db.write(data);
  res.json({ ok: true });
});

// 전체 보고서 + 합계 (관리자 전용)
app.get("/api/admin/reports", requireAdmin, (req, res) => {
  const data = db.read();
  const list = (data.reports || []).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const winLabel = (config.RP_RESULTS || ["승리"])[0];
  const summary = {
    count: list.length,
    totalPoints: list.reduce((s, r) => s + (r.points || 0), 0),
    wins: list.filter((r) => r.result === winLabel).length,
    losses: list.filter((r) => r.result && r.result !== winLabel).length,
  };
  // 카테고리별 합계
  const byCategory = {};
  for (const r of list) {
    const k = r.category || "기타";
    if (!byCategory[k]) byCategory[k] = { count: 0, points: 0, wins: 0, losses: 0 };
    byCategory[k].count++;
    byCategory[k].points += r.points || 0;
    if (r.result === winLabel) byCategory[k].wins++;
    else if (r.result) byCategory[k].losses++;
  }
  res.json({ reports: list, summary, byCategory });
});


// ============================================================
//  직급표 (로스터)
// ============================================================

app.get("/api/roster", requireApproved, (req, res) => {
  const data = db.read();
  const members = data.users.filter((u) => u.status === "approved");

  const tiers = config.TIERS.map((t) => {
    const ranks = t.ranks.map((rankName) => ({
      name: rankName,
      members: members
        .filter((u) => u.rank === rankName)
        .map((u) => ({
          id: u.id,
          username: u.username,
          isWorking: !!u.isWorking,
          isAdmin: !!u.isAdmin,
          teamTitle: u.team ? teamTitleOf(u.team, u.teamRole) : "",
        })),
    }));
    const count = ranks.reduce((s, r) => s + r.members.length, 0);
    return { key: t.key, label: t.label, icon: t.icon, count, ranks };
  });

  // 팀(부서) 편성 — 팀별 / 팀직책별 그룹
  const teams = (config.TEAMS || []).map((tm) => {
    const roles = (config.TEAM_ROLES || []).map((role) => ({
      role,
      title: tm.prefix + role,
      members: members
        .filter((u) => u.team === tm.key && (u.teamRole || (config.TEAM_ROLES ? config.TEAM_ROLES[config.TEAM_ROLES.length - 1] : "팀원")) === role)
        .map((u) => ({ id: u.id, username: u.username, rank: u.rank, isWorking: !!u.isWorking })),
    }));
    const count = members.filter((u) => u.team === tm.key).length;
    return { key: tm.key, name: tm.name, icon: tm.icon, count, roles };
  });

  res.json({ tiers, total: members.length, teams });
});

// ============================================================
//  관리자 전용 API
// ============================================================

// 승인 대기 목록
app.get("/api/admin/pending", requireAdmin, (req, res) => {
  const data = db.read();
  const pending = data.users
    .filter((u) => u.status === "pending")
    .map((u) => ({
      id: u.id,
      username: u.username,
      gobun: u.gobun || "",
      rank: u.rank,
      createdAt: u.createdAt,
    }));
  res.json({ pending });
});

// 전체 회원 목록
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const data = db.read();
  const kickThreshold = config.WARN_KICK_THRESHOLD || 3;
  const users = data.users.map((u) => {
    const warningCount = data.warnings.filter((w) => w.targetUserId === u.id).length;
    return {
      id: u.id,
      username: u.username,
      gobun: u.gobun || "",
      rank: u.rank,
      team: u.team || "",
      teamRole: u.teamRole || "",
      teamTitle: u.team ? teamTitleOf(u.team, u.teamRole) : "",
      status: u.status,
      isAdmin: !!u.isAdmin,
      isOwner: !!u.isOwner,
      isWorking: !!u.isWorking,
      createdAt: u.createdAt,
      warningCount,
      kickReview: !u.isOwner && warningCount >= kickThreshold,
    };
  });
  res.json({
    users,
    ranks: allRanks(),
    teams: (config.TEAMS || []).map((t) => ({ key: t.key, name: t.name })),
    teamRoles: config.TEAM_ROLES || [],
    kickThreshold,
  });
});

// 가입 승인
app.post("/api/admin/approve", requireAdmin, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.body.userId);
  if (!u) return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  u.status = "approved";
  u.approvedAt = new Date().toISOString();
  addLog(data, { type: "approve", icon: "✅", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} 가입 승인` });
  db.write(data);
  syncDiscordRole(u.id);
  res.json({ ok: true });
});

// 가입 거절
app.post("/api/admin/reject", requireAdmin, (req, res) => {
  const data = db.read();
  const u = data.users.find((x) => x.id === req.body.userId);
  if (!u) return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  if (isOwnerUser(u))
    return res.status(403).json({ error: "개발자(소유자) 계정은 거절할 수 없습니다." });
  u.status = "rejected";
  addLog(data, { type: "reject", icon: "🚫", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} 가입 거절` });
  db.write(data);
  res.json({ ok: true });
});

// 직급 변경
app.post("/api/admin/set-rank", requireAdmin, (req, res) => {
  const { userId, rank } = req.body;
  if (!allRanks().includes(rank))
    return res.status(400).json({ error: "존재하지 않는 직급입니다." });
  const data = db.read();
  const u = data.users.find((x) => x.id === userId);
  if (!u) return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  // 소유자 계정의 직급은 소유자 본인만 변경할 수 있습니다.
  if (isOwnerUser(u) && !isOwnerUser(req.currentUser))
    return res.status(403).json({ error: "개발자(소유자) 계정의 직급은 변경할 수 없습니다." });
  u.rank = rank;
  addLog(data, { type: "set-rank", icon: "🎖️", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} 직급 변경 → ${rank}` });
  db.write(data);
  syncDiscordRole(u.id);
  res.json({ ok: true });
});

// 팀(부서) 배정 — 팀 + 팀직책 (직급과 별개)
app.post("/api/admin/set-team", requireAdmin, (req, res) => {
  const { userId } = req.body;
  const teamKey = String(req.body.team || "");
  const teamRole = String(req.body.teamRole || "");
  const data = db.read();
  const u = data.users.find((x) => x.id === userId);
  if (!u) return res.status(404).json({ error: "대상을 찾을 수 없습니다." });

  if (!teamKey) {
    // 팀 해제
    u.team = "";
    u.teamRole = "";
    addLog(data, { type: "set-team", icon: "👥", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} 팀 해제` });
  } else {
    if (!teamByKey(teamKey)) return res.status(400).json({ error: "존재하지 않는 팀입니다." });
    const role = (config.TEAM_ROLES || []).includes(teamRole) ? teamRole : (config.TEAM_ROLES ? config.TEAM_ROLES[config.TEAM_ROLES.length - 1] : "팀원");
    u.team = teamKey;
    u.teamRole = role;
    addLog(data, { type: "set-team", icon: "👥", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} 팀 배정 → ${teamTitleOf(teamKey, role)}` });
  }
  db.write(data);
  res.json({ ok: true });
});

// 관리자 권한 토글
app.post("/api/admin/set-admin", requireAdmin, (req, res) => {
  const { userId, isAdmin } = req.body;
  const data = db.read();
  const u = data.users.find((x) => x.id === userId);
  if (!u) return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  // 본인의 관리자 권한을 스스로 해제하는 실수 방지
  if (u.id === req.currentUser.id && !isAdmin)
    return res.status(400).json({ error: "본인 관리자 권한은 해제할 수 없습니다." });
  // 소유자(개발자) 계정의 관리자 권한은 해제할 수 없습니다.
  if (isOwnerUser(u) && !isAdmin)
    return res.status(403).json({ error: "개발자(소유자) 계정의 관리자 권한은 해제할 수 없습니다." });
  u.isAdmin = !!isAdmin;
  if (u.isAdmin && u.status !== "approved") u.status = "approved";
  addLog(data, { type: "set-admin", icon: "🛡️", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} ${isAdmin ? "관리자 지정" : "관리자 해제"}` });
  db.write(data);
  res.json({ ok: true });
});

// 회원에게 경고 부여
app.post("/api/admin/warn", requireAdmin, (req, res) => {
  const { userId, reason } = req.body;
  const level = Math.max(1, Math.min(3, parseInt(req.body.level, 10) || 1));
  const data = db.read();
  const u = data.users.find((x) => x.id === userId);
  if (!u) return res.status(404).json({ error: "대상을 찾을 수 없습니다." });
  if (isOwnerUser(u))
    return res.status(403).json({ error: "개발자(소유자) 계정에는 경고를 부여할 수 없습니다." });

  const w = {
    id: db.uid("warn"),
    targetUserId: userId,
    targetUsername: u.username,
    reason: String(reason || "").trim() || "(사유 미기재)",
    level,
    issuedBy: req.currentUser.username,
    createdAt: new Date().toISOString(),
  };
  data.warnings.push(w);
  const count = data.warnings.filter((x) => x.targetUserId === userId).length;
  const threshold = config.WARN_KICK_THRESHOLD || 3;
  const kickReview = count >= threshold;
  addLog(data, { type: "warn", icon: "⚠️", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username}에게 ${level}단계 경고 — ${w.reason} (누적 ${count}회)` });
  if (kickReview) {
    addLog(data, { type: "kick-review", icon: "🚨", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${u.username} 강퇴 검토 대상 등록 (경고 ${count}회 누적)` });
  }
  db.write(data);
  pushToUsers([userId], {
    title: kickReview ? "🚨 경고 (강퇴 검토 대상)" : `⚠️ ${level}단계 경고`,
    body: kickReview ? `누적 ${count}회 — ${w.reason}` : w.reason,
    tag: "perfect-bank",
    url: "/",
  });
  sendDiscord(data, {
    title: kickReview ? "🚨 경고 발부 (강퇴 검토 대상)" : `⚠️ ${level}단계 경고 발부`,
    description: w.reason,
    color: DISCORD_COLORS.red,
    fields: [
      { name: "대상", value: `${u.username} (${u.rank || "-"})`, inline: true },
      { name: "누적", value: `${count}회`, inline: true },
      { name: "발부자", value: req.currentUser.username, inline: true },
    ],
  });
  res.json({ ok: true, warning: w, count, kickReview, threshold });
});

// 경고 삭제
app.delete("/api/admin/warning/:id", requireAdmin, (req, res) => {
  const data = db.read();
  const target = data.warnings.find((w) => w.id === req.params.id);
  const before = data.warnings.length;
  data.warnings = data.warnings.filter((w) => w.id !== req.params.id);
  if (target) addLog(data, { type: "warn-del", icon: "✅", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${target.targetUsername || ""} 경고 취소 (${target.level}단계)` });
  db.write(data);
  res.json({ ok: true, removed: before - data.warnings.length });
});

// 회원 삭제
app.post("/api/admin/delete-user", requireAdmin, (req, res) => {
  const { userId } = req.body;
  if (userId === req.currentUser.id)
    return res.status(400).json({ error: "본인 계정은 삭제할 수 없습니다." });
  const data = db.read();
  const target = data.users.find((u) => u.id === userId);
  if (target && isOwnerUser(target))
    return res.status(403).json({ error: "개발자(소유자) 계정은 삭제할 수 없습니다." });
  const removedName = target ? target.username : userId;
  data.users = data.users.filter((u) => u.id !== userId);
  data.warnings = data.warnings.filter((w) => w.targetUserId !== userId);
  addLog(data, { type: "delete-user", icon: "🗑️", actor: req.currentUser.username, actorId: req.currentUser.id, message: `${removedName} 회원 삭제` });
  db.write(data);
  res.json({ ok: true });
});

// 전체 경고 목록 (관리자)
app.get("/api/admin/warnings", requireAdmin, (req, res) => {
  const data = db.read();
  const list = [...data.warnings]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((w) => {
      const u = data.users.find((x) => x.id === w.targetUserId);
      return { ...w, targetRank: u ? u.rank : "", targetGobun: u ? u.gobun || "" : "" };
    });
  res.json({ warnings: list });
});

// 활동 로그 (관리자)
app.get("/api/admin/logs", requireAdmin, (req, res) => {
  const data = db.read();
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 150));
  const list = [...(data.logs || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  res.json({ logs: list });
});

// SPA 라우팅 (그 외 모든 경로는 index.html)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------------------------------------------------
app.listen(config.PORT, () => {
  console.log("====================================================");
  console.log("  북부 경찰서(보안국) 인트라넷 실행됨");
  console.log("  주소:  http://localhost:" + config.PORT);
  console.log("  개발자 IP:", config.DEVELOPER_IPS.join(", "));
  console.log("====================================================");
});
