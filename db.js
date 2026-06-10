// ============================================================
//  간단한 JSON 파일 데이터베이스
//  - 로컬:  ./data/db.json 에 저장
//  - Render 등 배포 환경: 환경변수 DATA_DIR 를 영구 디스크 마운트 경로
//    (예: /var/data) 로 지정하면 그 안에 db.json 을 저장해 데이터가 보존됩니다.
//    DATA_DIR 를 지정하지 않으면 기존처럼 ./data 를 사용합니다.
// ============================================================

const fs = require("fs");
const path = require("path");

// 환경변수 DATA_DIR 가 있으면 그 경로(영구 디스크)에 저장, 없으면 로컬 ./data
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_DATA = {
  users: [], // 회원
  announcements: [], // 공지사항 / 경고 공지
  warnings: [], // 개인 경고 기록
  reports: [], // 업무/판매 보고서 (예: 로또 판매)
  logs: [], // 활동 로그 (감사 로그)
  rp: [], // RP 활동 기록 (점수 포함)
  pushSubs: [], // 브라우저 푸시 구독 정보
  vapid: null, // VAPID 키쌍 (백그라운드 알림용, 최초 1회 생성 후 보존)
  leaves: [], // 휴가 신청
  settings: { discordWebhook: "", discordGuildId: "", discordRoleMap: {} }, // 관리자 설정
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

// 시작 시 데이터 저장 위치를 로그로 출력 (Render 로그에서 확인 가능)
console.log("[DB] 데이터 저장 위치:", DB_FILE, process.env.DATA_DIR ? "(영구 디스크)" : "(로컬 폴더 · 배포 시 휘발됨)");

function read() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const data = JSON.parse(raw || "{}");
    // 누락된 키 보정
    return {
      users: data.users || [],
      announcements: data.announcements || [],
      warnings: data.warnings || [],
      reports: data.reports || [],
      logs: data.logs || [],
      rp: data.rp || [],
      pushSubs: data.pushSubs || [],
      vapid: data.vapid || null,
      leaves: data.leaves || [],
      settings: Object.assign({ discordWebhook: "", discordGuildId: "", discordRoleMap: {} }, data.settings || {}),
    };
  } catch (e) {
    console.error("DB 읽기 오류, 기본값으로 복구합니다:", e.message);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function write(data) {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

// 간단한 고유 ID 생성기
function uid(prefix = "id") {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

module.exports = { read, write, uid };
