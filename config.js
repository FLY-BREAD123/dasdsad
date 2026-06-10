// ============================================================
//  북부 경찰서 (보안국) - 인트라넷 웹사이트 설정 파일
//  (이 파일만 수정하면 대부분의 운영 설정을 바꿀 수 있습니다)
// ============================================================

module.exports = {
  // 서버 포트
  PORT: process.env.PORT || 3000,

  // 세션 암호화 키 (실제 운영 시 길고 무작위한 값으로 반드시 바꾸세요)
  SESSION_SECRET: process.env.SESSION_SECRET || "north-police-secret-change-this-please",

  // ----------------------------------------------------------
  //  개발자(관리자) IP
  //  여기에 등록된 IP로 회원가입하면 자동으로 "승인 + 최고관리자(소유자)" 권한을 받습니다.
  // ----------------------------------------------------------
  DEVELOPER_IPS: [
    "125.186.83.101",
  ],

  // nginx/Render 등 리버스 프록시 뒤에서 운영한다면 true (실제 접속자 IP 인식용)
  TRUST_PROXY: true,

  // 같은 IP의 중복 회원가입을 막을지 여부
  BLOCK_DUPLICATE_IP: true,

  // ----------------------------------------------------------
  //  직급 체계 (직급표)
  //  order 가 낮을수록(위에 있을수록) 높은 직급입니다.
  // ----------------------------------------------------------
  TIERS: [
    {
      key: "executive",
      label: "고위직",
      icon: "🕋",
      ranks: ["국장", "부국장", "총감", "차감"],
    },
    {
      key: "manager",
      label: "간부직",
      icon: "🕋",
      ranks: ["총괄", "부장", "과장", "팀장"],
    },
    {
      key: "staff",
      label: "일반직",
      icon: "🕋",
      ranks: ["부팀장", "정예요원", "선임요원", "요원", "수습요원", "대기요원"],
    },
    {
      key: "special",
      label: "특수직",
      icon: "🕋",
      ranks: ["금쪽이", "멘헤라"],
    },
  ],

  // 신규 가입자 기본 직급 (가장 낮은 직급)
  DEFAULT_RANK: "대기요원",

  // 가입 시 본인이 직급을 직접 선택할 수 있게 할지 여부
  ALLOW_RANK_ON_SIGNUP: true,

  // 가입 시 "고유번호(고번)" 입력을 받을지 여부
  REQUIRE_GOBUN: true,

  // 공지/게시글 카테고리 (관리자 작성 시 선택)
  ANNOUNCEMENT_CATEGORIES: ["공지사항", "이벤트", "인사발령", "작전", "기타"],

  // RP 보고서 종류 — 직원이 RP 보고서 작성 시 선택
  REPORT_CATEGORIES: ["편의점 RP", "보석상 RP", "은행 ATM RP"],

  // RP 결과 + 점수 (승리 시 / 패배 시 부여 점수)
  RP_RESULTS: ["승리", "패배"],
  RP_WIN_POINTS: 3,
  RP_LOSE_POINTS: 1,

  // 점수 단위 표시
  POINT_UNIT: "점",

  // 경고 누적 강퇴 검토 기준 (이 횟수 이상이면 강퇴 검토 대상)
  WARN_KICK_THRESHOLD: 3,

  // 휴가 종류 (휴가 신청 시 선택)
  LEAVE_TYPES: ["연차", "병가", "반차", "공가", "기타"],

  // ── 디스코드 연동 ──
  // 디스코드 채널 → 설정(톱니) → 연동 → 웹후크 → "새 웹후크" → URL 복사해서 붙여넣기
  // (비워두면 비활성. 관리자 콘솔 "설정" 탭에서 재배포 없이 바꿀 수도 있음)
  DISCORD_WEBHOOK_URL: "",

  // ── 디스코드 로그인(OAuth) & 역할 자동 동기화 ──
  // 디스코드 개발자포털(discord.com/developers) → New Application 에서 발급
  // 보안상 SECRET / BOT_TOKEN 은 Render "Environment" 변수로 넣는 걸 강력 권장합니다.
  DISCORD_CLIENT_ID: "",      // OAuth2 → Client ID
  DISCORD_CLIENT_SECRET: "",  // OAuth2 → Client Secret  (env: DISCORD_CLIENT_SECRET)
  DISCORD_BOT_TOKEN: "",      // Bot → Reset Token        (env: DISCORD_BOT_TOKEN) — 역할 동기화용
  DISCORD_GUILD_ID: "",       // 디스코드 서버(길드) ID — 관리자 콘솔 "설정"에서도 입력 가능
  DISCORD_REDIRECT_URI: "",   // 비우면 접속 주소로 자동 생성. OAuth2 → Redirects 에 똑같이 등록해야 함

  // ----------------------------------------------------------
  //  팀(부서) — 직급과 별개로 부여 (예: 요원 + 인사팀원)
  //  표시 이름 = prefix + 팀직책  (인사 + 팀원 = 인사팀원, 인사 + 팀장 = 인사팀장)
  // ----------------------------------------------------------
  TEAMS: [
    { key: "swat", name: "특공대", prefix: "특공대", icon: "🚨" },
    { key: "hr", name: "인사팀", prefix: "인사", icon: "🔔" },
    { key: "audit", name: "감사팀", prefix: "감사", icon: "📋" },
  ],
  TEAM_ROLES: ["팀장", "부팀장", "팀원"],
};
