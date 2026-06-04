// db.js - 의존성 없는 JSON 파일 DB (소규모 조직 운영에 충분)
// 모든 데이터를 메모리에 두고, 변경 시 디스크에 원자적으로 저장한다.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");

function defaultData() {
  return {
    secret: crypto.randomBytes(32).toString("hex"), // JWT 서명 키 (최초 1회 생성 후 고정)
    members: [],
    attendance: [],
    warnings: [],
    announcements: [],
    logs: [],
    config: { warnThreshold: 3, devIps: [], regMode: "approval" },
    inviteCodes: [],
    activities: [],
  };
}

let data;

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (fs.existsSync(DB_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
      // 누락 필드 보정
      const d = defaultData();
      for (const k of Object.keys(d)) if (data[k] === undefined) data[k] = d[k];
      if (!data.config) data.config = { warnThreshold: 3, devIps: [] };
      if (!Array.isArray(data.config.devIps)) data.config.devIps = [];
      if (!data.config.regMode) data.config.regMode = "approval";
      if (!Array.isArray(data.inviteCodes)) data.inviteCodes = [];
      if (!Array.isArray(data.activities)) data.activities = [];
    } catch (e) {
      console.error("DB 읽기 실패, 새로 초기화합니다:", e.message);
      data = defaultData();
      save();
    }
  } else {
    data = defaultData();
    save();
  }
  return data;
}

let saveTimer = null;
function save() {
  // 원자적 저장: temp 파일에 쓰고 rename
  try {
    ensureDir();
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_PATH);
  } catch (e) {
    console.error("DB 저장 실패:", e.message);
  }
}

function uid() {
  return crypto.randomBytes(8).toString("hex");
}

load();

module.exports = { data, save, uid, DB_PATH };
