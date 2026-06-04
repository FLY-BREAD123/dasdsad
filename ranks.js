// ranks.js - 레전드 조직 계급 체계 (서버/프론트 공통 기준)
// level: 권한 비교용 숫자. 높을수록 상위. canManage = level >= 50 (간부직 이상 + 인사/감사 팀장·부팀장)

const TIERS = [
  { key: "exec",     name: "최고위직", emoji: "👑" },
  { key: "high",     name: "고위직",   emoji: "🔱" },
  { key: "cadre",    name: "간부직",   emoji: "🔥" },
  { key: "normal",   name: "일반직",   emoji: "⚔️" },
  { key: "special",  name: "특수직",   emoji: "🙂" },
  { key: "hr",       name: "인사팀",   emoji: "🤝" },
  { key: "audit",    name: "감사팀",   emoji: "📋" },
];

// 표시 순서대로
const RANKS = [
  // 👑 최고위직
  { name: "총책",       tier: "exec",    level: 100 },
  { name: "오른팔",     tier: "exec",    level: 96  },
  { name: "왼팔",       tier: "exec",    level: 95  },
  // 🔱 고위직
  { name: "집행관",     tier: "high",    level: 82  },
  { name: "총수",       tier: "high",    level: 80  },
  { name: "고문",       tier: "high",    level: 78  },
  // 🔥 간부직
  { name: "타격대장",   tier: "cadre",   level: 64  },
  { name: "돌격대장",   tier: "cadre",   level: 62  },
  { name: "기동대장",   tier: "cadre",   level: 60  },
  { name: "행동대장",   tier: "cadre",   level: 58  },
  // ⚔️ 일반직
  { name: "에이스",     tier: "normal",  level: 40  },
  { name: "타격대원",   tier: "normal",  level: 32  },
  { name: "돌격대원",   tier: "normal",  level: 30  },
  { name: "기동대원",   tier: "normal",  level: 28  },
  { name: "행동대원",   tier: "normal",  level: 26  },
  { name: "조직원",     tier: "normal",  level: 20  },
  { name: "수습대원",   tier: "normal",  level: 10  },
  // 🙂 특수직
  { name: "금쪽이",     tier: "special", level: 15  },
  { name: "멘헤라",     tier: "special", level: 15  },
  // 🤝 인사팀
  { name: "인사팀장",   tier: "hr",      level: 72  },
  { name: "인사부팀장", tier: "hr",      level: 66  },
  { name: "인사팀원",   tier: "hr",      level: 35  },
  // 📋 감사팀
  { name: "감사팀장",   tier: "audit",   level: 72  },
  { name: "감사부팀장", tier: "audit",   level: 66  },
  { name: "감사팀원",   tier: "audit",   level: 35  },
];

const MANAGE_LEVEL = 50; // 이 이상이면 관리 권한 (경고/계급변경/제명/공지/추가)

const RANK_MAP = Object.fromEntries(RANKS.map(r => [r.name, r]));
const TIER_MAP = Object.fromEntries(TIERS.map(t => [t.key, t]));

function rankInfo(name) {
  return RANK_MAP[name] || { name: name || "미지정", tier: "normal", level: 1 };
}
function canManage(name) {
  return rankInfo(name).level >= MANAGE_LEVEL;
}

module.exports = { TIERS, RANKS, MANAGE_LEVEL, RANK_MAP, TIER_MAP, rankInfo, canManage };
