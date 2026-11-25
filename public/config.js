// SC Fitting Sim 서비스 연결 설정.
// 이 파일은 공개 저장소에 올라가도 되는 값만 둔다 (URL, 공개 anon 키, 서버 ID).
// anon 키는 공개돼도 RLS로 보호되는 공개용 키다. 서비스 롤 키·봇 토큰은 절대 여기 두지 않는다.
// 설정 방법은 docs/SETUP_DISCORD_SUPABASE.md 참고.
window.SCFIT_CONFIG = {
  // Supabase 프로젝트 설정 > API 의 Project URL (예: https://abcdefgh.supabase.co)
  SUPABASE_URL: "https://sijnasvcvyafxalwqdsp.supabase.co",
  // 같은 화면의 anon public 키
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpam5hc3ZjdnlhZnhhbHdxZHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NjcyNTYsImV4cCI6MjExMTE0MzI1Nn0.RaLAWvBC7XhBUZAw6VFV6CfCiUwCpQbaAHgobBUT2JM",
  // 권한 기준으로 삼을 Discord 서버 ID (개발자 모드에서 서버 우클릭 > 서버 ID 복사)
  DISCORD_GUILD_ID: "",
  // 화면 표시용 서버 이름 (선택)
  DISCORD_GUILD_LABEL: "",
  // 이용 중 역할 재확인 간격(분). 봇 설정 전에는 로그인 시에만 확인한다.
  ROLE_REFRESH_MINUTES: 10,
};
