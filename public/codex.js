// 스타도감 (기획안 3·4) — 함선/무기/부품 도감. db.json 값만 표시, 없으면 '없음', 추정 안 함.
// 1차는 텍스트·배지 카드 (repo에 함선 이미지/아이콘 없음).
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = n => n == null ? '없음' : (Math.round(n * 10) / 10).toLocaleString('en-US');
  const fmt0 = n => n == null ? '없음' : Math.round(n).toLocaleString('en-US');
  const C_LIGHT = 299792458;

  const CATS = [
    { id: 'ships', label: '🚀 함선' },
    { id: 'weapons', label: '🔫 무기' },
    { id: 'shields', label: '🛡️ 실드' },
    { id: 'powerplants', label: '⚡ 파워플랜트' },
    { id: 'coolers', label: '❄️ 쿨러' },
    { id: 'qds', label: '🌀 양자드라이브' },
    { id: 'missiles', label: '💥 미사일·랙' },
    { id: 'radars', label: '📡 레이더' },
    { id: 'personal', label: '🪖 개인 화기' },
  ];

  // ---- 개인 화기 분류 픽토그램 (직접 그린 일반 도식, 특정 모델/사진 기반 아님. 수치·모델 목록 없음) ----
  const PF_SVG = {"knife": "<path d=\"M8 36 Q40 20 94 26 L106 36 L94 42 Q40 46 8 36z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M22 36 Q50 32 92 33\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M76 40 Q86 39 94 38\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M106 26 v20\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"110\" y=\"30\" width=\"32\" height=\"12\" rx=\"5\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M118 30v12M126 30v12M134 30v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"147\" cy=\"36\" r=\"3.5\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "pistol-b": "<path d=\"M26 17 H110 L117 21 V31 H26z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M44 31 H100 L92 37 H58 L56 31\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M60 36 L52 60 Q51 64 55 64 H76 Q79 64 80 60 L88 36\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M50 62 H82\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M62 36 v8 q0 4 5 4 h9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M72 36 l-2 9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M30 14 h6 M102 14 h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M34 19v10M38 19v10M42 19v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"68\" y=\"20\" width=\"20\" height=\"5\" rx=\"1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M117 24h8M117 28h8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M126 59v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M126 59h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M134 59v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M134 59h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "pistol-e": "<path d=\"M26 17 H110 L117 21 V31 H26z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M44 31 H100 L92 37 H58 L56 31\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M60 36 L52 60 Q51 64 55 64 H76 Q79 64 80 60 L88 36\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M50 62 H82\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M62 36 v8 q0 4 5 4 h9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M72 36 l-2 9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M30 14 h6 M102 14 h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M86 19v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M91 19v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M96 19v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M101 19v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"36\" y=\"21\" width=\"22\" height=\"5\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><circle cx=\"117\" cy=\"26\" r=\"3.5\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"117\" cy=\"26\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M136 44 l-9 14 h7 l-4 12 l12 -16 h-7 z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "smg-b": "<path d=\"M30 18 H108 L114 22 V38 H30z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M30 22 H12 V34 H30\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M114 25 H140 M114 31 H140\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M118 24 v14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M44 38 L40 54 H52 L56 38\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M86 38 L82 58 Q82 62 86 62 H96 Q99 62 100 58 L104 38\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M48 18 V13 H72 V18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M34 22v12M38 22v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M60 38 V64 Q60 66 63 66 H72 Q75 66 75 64 V38\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M60 58 H75\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"80\" y=\"24\" width=\"20\" height=\"5\" rx=\"1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M122 25v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M138 61v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M138 61h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M146 61v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M146 61h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "smg-e": "<path d=\"M30 18 H108 L114 22 V38 H30z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M30 22 H12 V34 H30\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M114 25 H140 M114 31 H140\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M118 24 v14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M44 38 L40 54 H52 L56 38\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M86 38 L82 58 Q82 62 86 62 H96 Q99 62 100 58 L104 38\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M48 18 V13 H72 V18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M34 22v12M38 22v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M94 20v16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M100 20v16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M106 20v16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"52\" y=\"24\" width=\"22\" height=\"6\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><rect x=\"60\" y=\"46\" width=\"14\" height=\"20\" rx=\"2\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"63\" y=\"50\" width=\"8\" height=\"12\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><circle cx=\"140\" cy=\"28\" r=\"0.1\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"140\" cy=\"28\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M148 44 l-9 14 h7 l-4 12 l12 -16 h-7 z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "rifle-b": "<path d=\"M6 24 H24 L30 20 H60 L64 17 H100 V25 H128 V32 H64 L60 40 H30 L26 34 H6z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M128 27 H152 M128 31 H152\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M152 25v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M62 17 V10 H92 V17\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M66 13h22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 32 L64 60 H80 L88 32\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M96 32 L102 48 H112 L108 32\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M30 24v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"38\" y=\"24\" width=\"16\" height=\"5\" rx=\"1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M126 57v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M126 57h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M134 57v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M134 57h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "rifle-e": "<path d=\"M6 24 H24 L30 20 H60 L64 17 H100 V25 H128 V32 H64 L60 40 H30 L26 34 H6z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M128 27 H152 M128 31 H152\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M152 25v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M62 17 V10 H92 V17\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M66 13h22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 32 L64 60 H80 L88 32\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M96 32 L102 48 H112 L108 32\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M30 24v10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M104 19v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M110 19v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M116 19v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M122 19v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"70\" y=\"20\" width=\"22\" height=\"5\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><circle cx=\"152\" cy=\"29\" r=\"3\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"152\" cy=\"29\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M138 40 l-9 14 h7 l-4 12 l12 -16 h-7 z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "lmg-b": "<path d=\"M6 24 H22 L28 18 H100 V26 H132 V34 H100 V40 H34 L30 36 H6z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M132 27 H152 M132 31 H152\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M104 26 v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M50 18 V10 H88 V18\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M54 14h30\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M92 40 L88 56 H100 L104 40\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M128 34 L138 62 M128 34 L116 62\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M112 62h8M134 62h8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M44 40 v18 h32 v-18\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M44 48 H76 M44 54 H76\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"60\" y=\"24\" width=\"16\" height=\"5\" rx=\"1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M142 57v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M142 57h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M150 57v-8a3 3 0 0 1 6 0v8z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M150 57h6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "lmg-e": "<path d=\"M6 24 H22 L28 18 H100 V26 H132 V34 H100 V40 H34 L30 36 H6z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M132 27 H152 M132 31 H152\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M104 26 v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M50 18 V10 H88 V18\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M54 14h30\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M92 40 L88 56 H100 L104 40\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M128 34 L138 62 M128 34 L116 62\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M112 62h8M134 62h8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M106 20v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M112 20v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M118 20v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M124 20v12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"36\" y=\"24\" width=\"24\" height=\"5\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><rect x=\"44\" y=\"44\" width=\"30\" height=\"18\" rx=\"3\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"50\" y=\"49\" width=\"18\" height=\"8\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><path d=\"M150 42 l-9 14 h7 l-4 12 l12 -16 h-7 z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "shotgun-b": "<path d=\"M4 28 L20 22 H46 L52 30 H70 V36 H52 L46 40 H20 L4 38z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 28 H150 V34 H70z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 38 H146 V45 H70z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M150 27v8M146 40v4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M80 45 H126 V50 H80z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M86 50v0M100 36v0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M52 36 L50 56 Q50 60 54 60 H62 Q64 60 64 56 L62 36\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M66 36 v10 q0 4 5 4 h8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10 30 L24 26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M92 24 v-6 h10 v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"108\" y=\"50\" width=\"6\" height=\"12\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"118\" y=\"50\" width=\"6\" height=\"12\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"128\" y=\"50\" width=\"6\" height=\"12\" rx=\"1\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"120\" cy=\"31\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/>", "shotgun-e": "<path d=\"M4 28 L20 22 H46 L52 30 H70 V36 H52 L46 40 H20 L4 38z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 28 H150 V34 H70z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 38 H146 V45 H70z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M150 27v8M146 40v4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M80 45 H126 V50 H80z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M86 50v0M100 36v0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M52 36 L50 56 Q50 60 54 60 H62 Q64 60 64 56 L62 36\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M66 36 v10 q0 4 5 4 h8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10 30 L24 26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M92 25v6M98 25v6M104 25v6M110 25v6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"84\" y=\"29\" width=\"22\" height=\"4\" rx=\"1.5\" fill=\"currentColor\" stroke=\"none\" fill-opacity=\".85\"/><path d=\"M142 46 l-8 12 h6 l-3 10 l10 -14 h-6 z\" fill=\"currentColor\" fill-opacity=\".14\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"};
  const PF_CLASSES = [
    ['knife', '나이프', '근접 · 탄종 구분 없음'],
    ['pistol-b', '권총', '실탄'], ['pistol-e', '권총', '에너지'],
    ['smg-b', '기관단총', '실탄'], ['smg-e', '기관단총', '에너지'],
    ['rifle-b', '라이플', '실탄'], ['rifle-e', '라이플', '에너지'],
    ['lmg-b', 'LMG', '실탄'], ['lmg-e', 'LMG', '에너지'],
    ['shotgun-b', '샷건', '실탄'], ['shotgun-e', '샷건', '에너지'],
  ];
  let PERS = null;
  const KO_SUB = { 'Pistol': '권총', 'SMG': '기관단총', 'Assault Rifle': '돌격소총', 'Rifle': '라이플', 'Sniper Rifle': '저격소총', 'LMG': 'LMG', 'Shotgun': '샷건', 'HMG': 'HMG', 'Railgun': '레일건', 'Grenade Launcher': '유탄발사기', 'Missile Launcher': '미사일 발사기', 'Launcher': '발사기', 'Crossbow': '석궁', 'Frag Pistol': '파편 권총' };
  const PF_TABS = [['all', '전체'], ['pistol', '권총'], ['smg', '기관단총'], ['rifle', '라이플'], ['sniper', '저격소총'], ['lmg', 'LMG'], ['shotgun', '샷건'], ['knife', '나이프'], ['other', '기타']];
  let pfTab = 'all', pfSort = 'name';
  const PF_ICON = { pistol: 'pistol', smg: 'smg', rifle: 'rifle', sniper: 'rifle', lmg: 'lmg', shotgun: 'shotgun' };
  const PF_KO = { pistol: '권총', smg: '기관단총', rifle: '라이플', sniper: '저격소총', lmg: 'LMG', shotgun: '샷건', knife: '나이프', other: '기타 (HMG·발사기 등)' };
  const pfNum = n => n == null ? '–' : (Math.round(n * 10) / 10).toLocaleString('en-US');
  const pfNum2 = n => n == null ? '–' : (Math.round(n * 100) / 100).toLocaleString('en-US');
  function pfBar() {
    return `<div class="pf-tabs" id="pfTabs">${PF_TABS.map(([k, n]) => `<button class="chip${k === pfTab ? ' on' : ''}" data-pf="${k}">${n}${PERS ? ' <span class="pf-n">' + PERS.items.filter(it => k === 'all' || it.k === k).length + '</span>' : ''}</button>`).join('')}</div>`;
  }
  function renderPersonal() {
    const g = $('cxGrid');
    if (!PERS) { g.innerHTML = '<div class="cx-empty">불러오는 중…</div>'; return; }
    const tb = $('pfTabsHost'); if (tb) { tb.innerHTML = pfBar(); tb.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => { pfTab = b.dataset.pf; renderPersonal(); }); }
    const items = PERS.items.filter(it => (pfTab === 'all' || it.k === pfTab) && (!q || (it.n + ' ' + it.m + ' ' + (it.vn || []).join(' ')).toLowerCase().includes(q)));
    const cmp = pfSort === 'name' ? (a, b) => a.n.localeCompare(b.n) : (a, b) => (b[pfSort] || 0) - (a[pfSort] || 0) || a.n.localeCompare(b.n);
    const groups = pfTab === 'all' ? ['pistol', 'smg', 'rifle', 'sniper', 'lmg', 'shotgun', 'knife', 'other'] : [pfTab];
    let h = '';
    for (const k of groups) {
      const ks = items.filter(it => it.k === k);
      if (!ks.length) continue;
      const parts = (k === 'knife' || k === 'other') ? [[null, ks]] : [['b', ks.filter(it => it.a === 'b')], ['e', ks.filter(it => it.a === 'e')], ['', ks.filter(it => it.a !== 'b' && it.a !== 'e')]];
      for (const [a, list] of parts) {
        if (!list.length) continue;
        const tag = a === 'b' ? '실탄' : a === 'e' ? '에너지' : a === '' ? '탄종 미상' : '';
        h += `<div class="cx-group-h" style="grid-column:1/-1">${esc(PF_KO[k])}${tag ? ' · <span class="pf-tag ' + (a || '') + '">' + tag + '</span>' : ''} <span>${list.length}</span></div>`;
        h += list.sort(cmp).map(it => pfCard(it, PF_ICON[k] && a ? PF_ICON[k] + '-' + a : (k === 'knife' ? 'knife' : null))).join('');
      }
    }
    if (!h) h = '<div class="cx-empty">조건에 맞는 무기가 없습니다.</div>';
    h += `<div class="cx-sub pf-note" style="grid-column:1/-1;margin-top:4px">닉네임·스킨만 다른 변형은 대표 모델 하나로 묶었습니다(제조사·분류·피해·rpm·탄창과 제작 보정이 모두 같을 때만). 아이콘은 분류별 대표 도식이며 실제 모델의 외형이 아닙니다(저격소총은 라이플 도식 사용). 출처: star-citizen.wiki API (${esc(PERS.meta.version)}). 발당=소스 damage_per_shot(샷건은 펠릿 합산값), 탄창당=발당×탄창 수, 분당=발당×rpm. 분당 피해는 <b>재장전·반동·명중률을 뺀 이론값</b>이며(재장전 시간은 소스에 없음), rpm은 소스 최상위 값(점사·연사 모드가 있으면 빠른 쪽일 수 있음)입니다. 게임 내 측정값이 아닙니다.</div>`;
    g.innerHTML = h;
    if (CRAFT) bindCraft(g); else if (!craftLoading) { craftLoading = true; fetch('crafting.json?v=1').then(r => r.json()).then(d => { CRAFT = d; if (cat === 'personal') renderPersonal(); }).catch(() => {}); }
  }
  let CRAFT = null, craftLoading = false;
  const pfOpen = new Set(), pfQ = {};
  const SLOT_KO = { FRAME: '프레임', BARREL: '총열', BARRELS: '총열', STOCK: '개머리판', GRIP: '그립', LENSES: '렌즈', WIRING: '배선', REGULATOR: '레귤레이터', CABLING: '케이블', 'PRECISION PARTS': '정밀 부품', CONDUIT: '도관', STABILIZER: '안정기', 'TENSIVE FIBRE': '인장 섬유' };
  const STAT_KO = { weapon_damage: '피해(Impact Force)', weapon_firerate: '연사속도', weapon_recoil_smoothness: '반동 부드러움', weapon_recoil_handling: '반동 제어', weapon_recoil_kick: '반동 킥' };
  function cmult(m, Q) {
    if (m[3]) { for (const [q0, q1, a, b] of m[3]) if (Q >= q0 && Q <= q1) return q1 === q0 ? a : a + (b - a) * (Q - q0) / (q1 - q0); }
    return m[1] + (m[2] - m[1]) * Q / 1000;
  }
  const mx = n => '×' + (Math.round(n * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  function craftPanel(cn) {
    const c = CRAFT.items[cn];
    const q = pfQ[cn] || (pfQ[cn] = c.s.map(() => 500));
    const rows = c.s.map((sl, i) => `<div class="cq-slot"><div class="cq-sh"><b>${esc(SLOT_KO[sl.n] || sl.n)}</b> <span class="cx-sub">${esc(sl.n)} · ${sl.m.map(m => esc(m[0]) + (m[1] == null ? ' · 수량 미상' : ' ' + m[1] + ' SCU')).join(', ')}</span></div>
      <div class="cq-sl"><input type="range" min="0" max="1000" step="10" value="${q[i]}" data-cqi="${i}" data-cn="${esc(cn)}"><b data-qv="${i}">${q[i]}</b></div>
      ${sl.x.map((m, j) => `<div class="cq-m"><span>${esc(STAT_KO[m[0]] || m[0])}</span><span>${mx(m[1])} ~ ${mx(m[2])}${m[3] ? ' (구간식)' : ''}</span><b data-mv="${i}-${j}"></b></div>`).join('')}</div>`).join('');
    return `<div class="cq" data-cqp="${esc(cn)}"><div class="cq-top"><span class="cx-sub">슬롯별 재료 품질(Q0~Q1000)을 움직이면 그 슬롯의 보정 배율이 바뀝니다. 각 줄: 스탯 · Q0~Q1000 배율 · 현재 배율.</span><span class="cq-btns"><button class="chip" data-cqset="0">전부 0</button><button class="chip" data-cqset="500">전부 500</button><button class="chip" data-cqset="1000">전부 1000</button></span></div>${rows}<div class="cq-est" data-est></div>
      <div class="cx-sub cq-note">확인된 값: 슬롯별 배율(소스 <a href="${esc(c.u)}" target="_blank" rel="noopener">star-citizen.wiki 청사진</a>, ${esc(CRAFT.meta.gameVersion)}, 품질 0~1000, 선형 또는 구간 선형). 배율은 해당 스탯의 어떤 값에 곱해지는지 문서에 없습니다. <b>추정</b>: 아이템 API의 기본 스탯이 품질 500일 때 값이라고 가정(커뮤니티 도구 기반 추정, 공식 문서 아님)하고 배율 ÷ Q500 배율을 곱해 계산. 같은 스탯이 여러 슬롯에 있으면 합산 방식을 알 수 없어 슬롯별 값만 표시하며 절대값을 계산하지 않습니다(반동 3종은 항상 슬롯별). 청사진 데이터가 없는 무기는 "제작 불가"가 아니라 "데이터 없음"입니다.</div></div>`;
  }
  function craftFill(p) {
    const cn = p.dataset.cqp, c = CRAFT.items[cn], q = pfQ[cn], it = PERS.items.find(x => x.cn === cn);
    const cnt = {}; c.s.forEach(sl => sl.x.forEach(m => cnt[m[0]] = (cnt[m[0]] || 0) + 1));
    const one = {}; c.s.forEach((sl, i) => sl.x.forEach(m => { if (cnt[m[0]] === 1) one[m[0]] = cmult(m, q[i]) / cmult(m, 500); }));
    c.s.forEach((sl, i) => { p.querySelector(`[data-qv="${i}"]`).textContent = q[i]; sl.x.forEach((m, j) => { p.querySelector(`[data-mv="${i}-${j}"]`).textContent = mx(cmult(m, q[i])); }); });
    let h = '';
    const dm = one.weapon_damage, fm = one.weapon_firerate;
    if (it && it.d != null) {
      const d = it.d * (dm == null ? 1 : dm), r = it.r ? it.r * (fm == null ? 1 : fm) : null;
      const rows = [];
      if (dm != null) rows.push(`발당 피해 ${pfNum2(it.d)} → <b>${pfNum2(d)}</b>`);
      if (fm != null && it.r) rows.push(`rpm ${pfNum2(it.r)} → <b>${pfNum2(r)}</b>`);
      if (dm != null && it.c) rows.push(`탄창당 ${pfNum2(it.mag)} → <b>${pfNum2(d * it.c)}</b>`);
      if ((dm != null || fm != null) && r && it.c > 1) rows.push(`분당(재장전 제외) ${pfNum2(it.dpm)} → <b>${pfNum2(d * r)}</b>`);
      if (rows.length) h += `<b>추정(기본 스탯=Q500 가정)</b>: ` + rows.join(' · ');
      if (cnt.weapon_damage > 1) h += `${h ? '<br>' : ''}피해 보정이 ${cnt.weapon_damage}개 슬롯에 있어 합산 방식 미확인: 절대 피해는 계산하지 않음(슬롯별 배율만 확인된 값).`;
    }
    p.querySelector('[data-est]').innerHTML = h || '<span class="cx-sub">이 무기는 절대값 추정이 가능한 단일 슬롯 스탯이 없습니다.</span>';
  }
  function closeCraft() { const o = document.getElementById('cq-ov'); if (o) o.remove(); document.body.style.overflow = ''; }
  function openCraft(cn) {
    closeCraft();
    const it = PERS.items.find(x => x.cn === cn);
    const ov = document.createElement('div');
    ov.className = 'modal-ov'; ov.id = 'cq-ov';
    ov.innerHTML = `<div class="modal cq-modal" role="dialog" aria-modal="true"><div class="modal-h"><b>🛠 제작 품질 · ${esc(it ? it.n : cn)}</b><button class="modal-x" data-cqx aria-label="닫기">✕</button></div><div class="modal-list cq-body">${craftPanel(cn)}</div></div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    ov.querySelector('[data-cqx]').onclick = closeCraft;
    const p = ov.querySelector('[data-cqp]');
    craftFill(p);
    p.querySelectorAll('input[type=range]').forEach(r => r.oninput = () => { pfQ[r.dataset.cn][+r.dataset.cqi] = +r.value; craftFill(p); });
    p.querySelectorAll('[data-cqset]').forEach(b => b.onclick = () => { pfQ[cn] = pfQ[cn].map(() => +b.dataset.cqset); p.querySelectorAll('input[type=range]').forEach((r, i) => r.value = pfQ[cn][i]); craftFill(p); });
  }
  function bindCraft(g) {
    g.querySelectorAll('[data-cqtoggle]').forEach(b => b.onclick = () => openCraft(b.dataset.cqtoggle));
  }
  function pfCard(it, k) {
    const ico = k ? `<svg class="pf-ico sm" viewBox="0 0 160 72" aria-hidden="true">${PF_SVG[k]}</svg>` : '';
    const sub = (it.m && it.m !== 'Unknown' ? esc(it.m) : '제조사 미상') + (it.sub ? ' · ' + esc(KO_SUB[it.sub] || it.sub) : '');
    let st = '';
    if (it.d != null) {
      st = `<div class="pf-stats"><div><span>발당 피해</span><b>${pfNum(it.d)}</b></div><div><span>탄창당 피해</span><b>${pfNum(it.mag)}</b></div><div><span>분당 피해</span><b>${it.dpm != null ? pfNum(it.dpm) : '–'}</b></div></div><div class="cx-sub">${it.r ? pfNum(it.r) + ' rpm' : 'rpm 없음'} · 탄창 ${it.c != null ? it.c : '없음'}${it.c === 1 ? ' (1발 장전식, 분당 생략)' : ''}${it.t ? ' · 소진 ' + pfNum(it.t) + '초' : ''}</div>`;
    } else if (it.k !== 'knife') st = '<div class="cx-sub">피해 수치 소스에 없음</div>';
    const vr = it.vn && it.vn.length ? `<details class="pf-var"><summary>닉네임·스킨 변형 ${it.vn.length}종 포함 (성능 동일)</summary><div class="cx-sub">${it.vn.map(esc).join('<br>')}</div></details>` : '';
    const has = CRAFT && it.cn && CRAFT.items[it.cn];
    const cb = has ? `<button class="chip pf-craft" data-cqtoggle="${esc(it.cn)}">🛠 제작 품질 보기</button>` : '';
    return `<div class="cx-card pf-card" style="cursor:default">${ico}<div class="cx-name">${esc(it.n)}</div><div class="cx-sub">${sub}</div>${st}${cb}${vr}</div>`;
  }
  const SORTS = { name: '이름순', size: '사이즈순', perf: '주요 수치순' };
  const CAREER_ICON = { 'Combat': '⚔️', 'Ground': '🛞', 'Industrial': '⛏️', 'Competition': '🏁', 'Transporter': '🚚', 'Exploration': '🔭', 'Support': '🛟', 'Multi-Role': '🔀', 'Personal Transport': '🚐', 'Starter': '🌱' };


  // ---- 분류 규칙 (게임 데이터의 role/career 문자열만 사용, 애매한 값은 '기타·복합') ----
  const SHIP_CATS = ['경전투기', '중형 전투기', '중전투기', '스텔스 전투기', '인터셉터·스닙', '폭격기', '건쉽·드롭쉽', '특수 전투', '함대급', '화물', '여객', '채굴', '샐비지', '탐사·여행', '지원', '레이싱', '기타·복합'];
  function shipCat(s) {
    const role = String(s.role || ''), car = String(s.career || '');
    if (/Heavy Fighter \/ Bomber/.test(role)) return '중전투기';
    if (role.includes('/')) return '기타·복합';
    if (/Light Fighter/.test(role)) return '경전투기';
    if (/Medium Fighter/.test(role)) return '중형 전투기';
    if (/Heavy Fighter/.test(role)) return '중전투기';
    if (/Stealth Fighter/.test(role)) return '스텔스 전투기';
    if (/Interceptor|Snub Fighter/.test(role)) return '인터셉터·스닙';
    if (/Bomber/.test(role)) return '폭격기';
    if (/Gunship|Dropship|Gun Ship/.test(role)) return '건쉽·드롭쉽';
    if (/Anti-Air|Anti-Vehicle|Interdiction/.test(role)) return '특수 전투';
    if (/Frigate|Corvette|Destroyer|Carrier/.test(role)) return '함대급';
    if (/Salvage/.test(role)) return '샐비지';
    if (/Mining/.test(role)) return '채굴';
    if (/Freight/.test(role)) return '화물';
    if (/Passenger|Data/.test(role)) return /Data/.test(role) ? '기타·복합' : '여객';
    if (/Expedition|Pathfinder|Touring|Generalist/.test(role)) return '탐사·여행';
    if (/Medical|Refueling|Recovery|Reporting|Science/.test(role)) return '지원';
    if (/Racing/.test(role)) return '레이싱';
    return '기타·복합';
  }
  const WTYPES = ['에너지', '실탄', '디스토션', '기타'];
  function weaponType(w) {
    const f = String(w.family || '');
    if (/Rocket Pod|Tractor/i.test(f)) return '기타';
    if (/Ballistic|Mass Driver/i.test(f)) return '실탄';
    if (/Laser|Neutron|Plasma|Tachyon/i.test(f)) return '에너지';
    if (/Distortion/i.test(f)) return '디스토션';
    const t = (w.dmgtype || [])[0];
    return t === 'Energy' ? '에너지' : t === 'Physical' ? '실탄' : t === 'Distortion' ? '디스토션' : '기타';
  }
  const CLS_KO = { Civilian: '민수', Military: '군용', Competition: '경쟁(레이싱)', Stealth: '스텔스', Industrial: '산업', '': '미분류' };
  const CLS_ORDER = ['Civilian', 'Military', 'Competition', 'Stealth', 'Industrial', ''];
  const COMP_CATS = ['shields', 'powerplants', 'coolers', 'qds', 'radars'];
  const SUB_KO = { Missile: '미사일', Torpedo: '어뢰', GroundVehicleMissile: '지상차량용', Rocket: '로켓' };
  const TRACK_KO = { Infrared: '적외선(IR)', CrossSection: '단면적(CS)', Electromagnetic: '전자기(EM)' };
  const mmeta = cls => (MMETA && MMETA.missiles && MMETA.missiles[cls]) || null;

  let SHOPS = null, shopsTried = false;
  let cat = 'ships', q = '', fSize = '', fGrade = '', fMfr = '', sort = 'name';
  let fCat = '', fType = '', fCls = '', group = 'auto';
  let SMETA = null, MMETA = null;
  // 함선 이미지는 RSI 공식 스토어 공개 URL(ship_meta.json의 img)을 원본 그대로 연결. 매칭 없는 함선은 자리표시자.
  const SHOW_SHIP_IMAGES = true;
  // 이미지 URL이 깨지면 깨진 아이콘 대신 자리표시자로 교체
  window.cxImgFail = function (img, cls) { const s = document.createElement('div'); s.className = cls; s.textContent = '이미지 준비 중'; const cred = img.nextElementSibling; if (cred && cred.classList.contains('cx-m-cred')) cred.remove(); img.replaceWith(s); };
  let built = false, selKey = null;

  const isPlaceholder = it => !it || !it.name || /PLACEHOLDER/i.test(it.name);

  // 제조사별 포인트 색 (기획안 4): 이름 해시로 팔레트에서 결정적으로 배정
  const MFR_PALETTE = ['#4cc2ff', '#51d88a', '#ffb454', '#ff8ab3', '#b592ff', '#ffd166', '#6ee7de', '#f08018', '#9dff57', '#ff6b6b', '#5aa9ff', '#e0aaff'];
  function mfrColor(m) { let h = 0; for (const ch of String(m)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return MFR_PALETTE[h % MFR_PALETTE.length]; }

  // ---- 카테고리별 정규화: {key, name, size, grade, mfr, sub, bars:[{k,v,txt}], raw, kind} ----
  function itemsOf(cid) {
    if (!dbOk()) return [];
    const out = [];
    const push = (kind, it, o) => { if (!isPlaceholder(it)) out.push(Object.assign({ key: kind + ':' + it.class, kind, raw: it, name: it.name, size: it.size, grade: String(it.grade || ''), mfr: it.mfr || '', sub: '', bars: [] }, o)); };
    if (cid === 'ships') {
      for (const s of DB.ships || []) push('ship', s, {
        grade: (CAREER_ICON[s.career] || '🛸') + ' ' + (s.role || s.career || ''),
        sub: `👥 승무원 ${s.crew ?? '—'} · 📦 ${s.cargo ?? '—'}${s.career ? ' · ' + s.career : ''}`,
        bars: [
          { k: '버스트 DPS', v: s.stockDps || 0 },
          { k: '지속 DPS', v: s.stockSus || 0 },
          { k: '미사일', v: s.stockMsl || 0 },
          { k: '스톡 전력', v: s.stockGen || 0 },
        ],
        perf: s.stockDps || 0,
        cat: shipCat(s),
        mfr: ((SMETA && SMETA.ships && SMETA.ships[s.class] && SMETA.ships[s.class].mfr) || ''),
        img: (SHOW_SHIP_IMAGES && SMETA && SMETA.ships && SMETA.ships[s.class] && SMETA.ships[s.class].img) || '',
        large: (s.size || 0) >= 5,
      });
    } else if (cid === 'weapons') {
      for (const w of DB.weapons || []) push('weapon', w, {
        sub: `${w.family || ''}${(w.dmgtype || []).length ? ' [' + w.dmgtype.join('+') + ']' : ''}${w.rpm ? ' · ' + w.rpm + 'rpm' : ''}${(w.vn || []).length ? ' · 변형 ' + w.vn.length + '종 통합' : ''}`,
        bars: [
          { k: 'DPS', v: w.dps || 0 },
          { k: '알파', v: w.alpha || 0 },
          { k: '사거리', v: w.range || 0, txt: w.range != null ? fmt0(w.range) + 'm' : null },
          { k: '탄속', v: w.speed || 0, txt: w.speed != null ? fmt0(w.speed) + 'm/s' : null },
        ],
        perf: w.dps || 0,
        wtype: weaponType(w),
      });
    } else if (cid === 'shields') {
      for (const s of DB.shields || []) push('shield', s, {
        sub: CLS_KO[s.cls || ''] || s.cls, ccls: s.cls || '',
        bars: [
          { k: 'HP', v: s.hp || 0 },
          { k: '재생/s', v: s.regen || 0 },
        ],
        perf: s.hp || 0,
      });
    } else if (cid === 'powerplants') {
      for (const p of DB.powerplants || []) push('power', p, {
        sub: CLS_KO[p.cls || ''] || p.cls, ccls: p.cls || '',
        bars: [{ k: '출력(핍)', v: p.pwGen != null ? p.pwGen : (p.output || 0) }],
        perf: p.pwGen != null ? p.pwGen : (p.output || 0),
      });
    } else if (cid === 'coolers') {
      for (const c of DB.coolers || []) push('cooler', c, {
        sub: CLS_KO[c.cls || ''] || c.cls, ccls: c.cls || '',
        bars: [{ k: '냉각량', v: c.rate || 0 }],
        perf: c.rate || 0,
      });
    } else if (cid === 'qds') {
      for (const d of DB.qds || []) push('qd', d, {
        ccls: d.cls || '',
        sub: `${CLS_KO[d.cls || ''] || d.cls} · 스풀 ${d.spool != null ? d.spool + 's' : '—'} · 쿨다운 ${d.cooldown != null ? d.cooldown + 's' : '—'}`,
        bars: [{ k: '속도', v: d.driveSpeed || d.speed || 0, txt: d.driveSpeed ? (d.driveSpeed / C_LIGHT * 100).toFixed(1) + '%c' : null }],
        perf: d.driveSpeed || d.speed || 0,
      });
    } else if (cid === 'missiles') {
      for (const m of DB.missiles || []) { const mm = mmeta(m.class); push('missile', m, {
        sub: (mm ? (SUB_KO[mm.sub] || mm.sub) + ' · ' + (TRACK_KO[mm.track] || mm.track || '') + (mm.cluster ? ' · 클러스터' : '') : '미사일'),
        mtype: mm ? (SUB_KO[mm.sub] || '기타') : '미확인', mtrack: mm ? (TRACK_KO[mm.track] || '미확인') : '미확인',
        bars: [{ k: '피해', v: m.damage || 0 }],
        perf: m.damage || 0,
      }); }
      for (const r of DB.racks || []) push('rack', r, {
        mtype: '랙', mtrack: '—',
        sub: `랙 · S${r.msize != null ? r.msize : '?'} 미사일`,
        bars: [{ k: '장전 수', v: r.missiles || 0 }],
        perf: r.missiles || 0,
      });
    } else if (cid === 'radars') {
      for (const r of DB.radars || []) {
        const sen = (r.detection && r.detection.Sensitivity) || {};
        const senTxt = ['IR', 'CS', 'EM', 'RS'].filter(k => sen[k] != null).map(k => `${k} ${sen[k]}`).join(' · ');
        push('radar', r, {
          ccls: r.cls || '',
          sub: (CLS_KO[r.cls || ''] || r.cls) + ' · ' + (senTxt || '탐지장비'),
          bars: [{ k: '최대 감도', v: Math.max(0, ...['IR', 'CS', 'EM', 'RS'].map(k => sen[k] || 0)) }],
          perf: Math.max(0, ...['IR', 'CS', 'EM', 'RS'].map(k => sen[k] || 0)),
        });
      }
    }
    return out;
  }

  // 막대 정규화 기준: 카테고리 전체(필터 전) 최대값 — 한 번만 계산
  const barMax = {};
  function barMaxFor(cid) {
    if (barMax[cid]) return barMax[cid];
    const m = [];
    for (const it of itemsOf(cid)) it.bars.forEach((b, i) => { m[i] = Math.max(m[i] || 0, b.v || 0); });
    barMax[cid] = m;
    return m;
  }

  function filtered() {
    let arr = itemsOf(cat);
    if (q) arr = arr.filter(it => (it.name + ' ' + it.mfr + ' ' + (it.raw.family || '') + ' ' + (it.raw.vn || []).join(' ')).toLowerCase().includes(q));
    if (fSize !== '' && fSize !== 'large') arr = arr.filter(it => String(it.size) === fSize);
    if (fGrade !== '') arr = arr.filter(it => it.grade === fGrade);
    if (fMfr !== '') arr = arr.filter(it => it.mfr === fMfr);
    if (cat === 'ships') {
      if (fCat !== '') arr = arr.filter(it => it.cat === fCat);
      if (fSize === 'large') arr = arr.filter(it => it.large);
    }
    if (cat === 'weapons' && fType !== '') arr = arr.filter(it => it.wtype === fType);
    if (COMP_CATS.includes(cat) && fCls !== '') arr = arr.filter(it => it.ccls === (fCls === '_none' ? '' : fCls));
    if (cat === 'missiles' && fType !== '') arr = arr.filter(it => it.mtype === fType || it.mtrack === fType);
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => ((a.size ?? 99) - (b.size ?? 99)) || a.name.localeCompare(b.name),
      perf: (a, b) => (b.perf - a.perf) || a.name.localeCompare(b.name),
    }[sort] || ((a, b) => a.name.localeCompare(b.name));
    return arr.sort(by);
  }

  const opts = (arr, cur, allLabel) => `<option value="">${allLabel}</option>` + arr.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  function buildHead() {
    $('cxTabs').innerHTML = CATS.map(c => `<button class="chip${c.id === cat ? ' on' : ''}" data-cat="${c.id}">${c.label}</button>`).join('');
    $('cxTabs').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; selKey = null; fSize = cat === 'weapons' ? '3' : ''; fGrade = ''; fMfr = ''; fCat = ''; fType = ''; fCls = ''; group = 'auto'; buildHead(); renderGrid(); closeModal(); });
    if (cat === 'personal') { $('cxFilters').innerHTML = `<div id="pfTabsHost" style="flex:1 1 100%"></div><input id="cxQ" placeholder="검색 (이름·제조사)" value="${esc(q)}"><select id="pfSort"><option value="name">이름순</option><option value="dpm">분당 피해순</option><option value="mag">탄창당 피해순</option><option value="d">발당 피해순</option></select>`; $('pfSort').value = pfSort; $('pfSort').onchange = e => { pfSort = e.target.value; renderPersonal(); }; $('cxQ').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); renderGrid(); }); if (!PERS) fetch('personal.json?v=4').then(r => r.json()).then(d => { PERS = d; if (cat === 'personal') renderGrid(); }).catch(() => { $('cxGrid').innerHTML = '<div class="cx-empty">목록을 불러오지 못했습니다.</div>'; }); else renderPersonal(); return; }
    const arr = itemsOf(cat);
    const sizes = [...new Set(arr.map(it => String(it.size)))].sort((a, b) => Number(a) - Number(b));
    const grades = [...new Set(arr.map(it => it.grade).filter(g => g && g.length <= 2))].sort();
    const mfrs = [...new Set(arr.map(it => it.mfr).filter(Boolean))].sort();
    let h = `<input id="cxQ" placeholder="검색 (이름·제조사)" value="${esc(q)}">`;
    if (cat === 'ships') {
      const cnt = {}; arr.forEach(it => { cnt[it.cat] = (cnt[it.cat] || 0) + 1; });
      h += `<select id="cxCat">${opts(SHIP_CATS.filter(c => cnt[c]).map(c => [c, `${c} (${cnt[c]})`]), fCat, '카테고리 전체')}</select>`;
      h += `<select id="cxSize"><option value="">사이즈 전체</option><option value="large"${fSize === 'large' ? ' selected' : ''}>대형함 (S5 이상 · 임시 기준)</option>${sizes.map(s => `<option value="${esc(s)}"${s === fSize ? ' selected' : ''}>S${esc(s)}</option>`).join('')}</select>`;
      h += `<select id="cxGroup"><option value="auto"${group === 'auto' ? ' selected' : ''}>묶기: 자동(전체=카테고리별)</option><option value="cat"${group === 'cat' ? ' selected' : ''}>묶기: 카테고리별</option><option value="mfr"${group === 'mfr' ? ' selected' : ''}>묶기: 제조사별</option><option value="none"${group === 'none' ? ' selected' : ''}>묶지 않음</option></select>`;
    } else if (cat !== 'weapons') {
      h += `<select id="cxSize"><option value="">사이즈 전체</option>${sizes.map(s => `<option value="${esc(s)}"${s === fSize ? ' selected' : ''}>S${esc(s)}</option>`).join('')}</select>`;
    }
    if (cat === 'weapons') h += `<select id="cxType">${opts(WTYPES.map(t => [t, t === '실탄' ? '실탄(Ballistic)' : t === '에너지' ? '에너지(Energy)' : t]), fType, '무기 종류 전체')}</select>`
      + `<select id="cxGroup"><option value="auto"${group !== 'none' ? ' selected' : ''}>묶기: 종류별 (기본)</option><option value="none"${group === 'none' ? ' selected' : ''}>묶지 않음</option></select>`;
    if (COMP_CATS.includes(cat)) {
      const have = new Set(arr.map(it => it.ccls));
      h += `<select id="cxCls">${opts(CLS_ORDER.filter(c => have.has(c)).map(c => [c === '' ? '_none' : c, CLS_KO[c]]), fCls, '용도 전체(민수·군용·경쟁·스텔스)')}</select>`
        + `<select id="cxGroup"><option value="none"${group !== 'cls' ? ' selected' : ''}>묶지 않음</option><option value="cls"${group === 'cls' ? ' selected' : ''}>용도별로 묶기</option></select>`;
    }
    if (cat === 'missiles') {
      const ts = [...new Set(arr.map(it => it.mtype))].filter(t => t && t !== '랙'), ks = [...new Set(arr.map(it => it.mtrack))].filter(t => t && t !== '—');
      h += `<select id="cxType">${opts([...ts, ...ks].map(t => [t, t]), fType, '종류·추적방식 전체')}</select>`;
    }
    if (grades.length && cat !== 'ships') h += `<select id="cxGrade"><option value="">등급 전체</option>${grades.map(g => `<option value="${esc(g)}"${g === fGrade ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
    if (mfrs.length) h += `<select id="cxMfr"><option value="">제조사 전체</option>${mfrs.map(m => `<option value="${esc(m)}"${m === fMfr ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>`;
    h += `<select id="cxSort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    if (cat === 'weapons') {
      h += `<div class="cx-size-row" role="radiogroup" aria-label="무기 사이즈"><span class="grp-lbl">사이즈</span>`
        + `<label class="chip cx-size-opt"><input type="radio" name="cxSizeR" value=""${fSize === '' ? ' checked' : ''}>전체</label>`
        + sizes.map(s => `<label class="chip cx-size-opt"><input type="radio" name="cxSizeR" value="${esc(s)}"${s === fSize ? ' checked' : ''}>S${esc(s)}</label>`).join('') + `</div>`;
    }
    $('cxFilters').innerHTML = h;
    $('cxFilters').querySelectorAll('input[name="cxSizeR"]').forEach(r => r.onchange = e => { fSize = e.target.value; renderGrid(); });
    $('cxQ').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); renderGrid(); });
    const on = (id, fn) => { const el = $(id); if (el) el.onchange = e => { fn(e.target.value); renderGrid(); }; };
    on('cxSize', v => fSize = v); on('cxGrade', v => fGrade = v); on('cxMfr', v => fMfr = v); on('cxSort', v => sort = v);
    on('cxCat', v => fCat = v); on('cxType', v => fType = v); on('cxCls', v => fCls = v); on('cxGroup', v => group = v);
  }

  function cardHTML(it, maxes) {
    const bars = it.bars.filter(b => b.v > 0).slice(0, 4).map((b, i) => {
      const bi = it.bars.indexOf(b);
      const mx = maxes[bi] || 0;
      const pct = mx > 0 ? Math.max(2, Math.min(100, b.v / mx * 100)) : 0;
      return `<div class="cx-bar-row"><span>${esc(b.k)}</span><span class="cx-bar"><i style="width:${pct}%"></i></span><span class="v">${esc(b.txt || fmt(b.v))}</span></div>`;
    }).join('');
    const sz = it.kind === 'ship' || it.size != null ? `<span class="cx-sz">S${it.size}</span>` : '<span></span>';
    const grCls = /^[ABCD]$/.test(it.grade) ? it.grade : '';
    const thumb = it.kind === 'ship' ? (it.img ? `<img class="cx-thumb" loading="lazy" src="${esc(it.img)}" alt="${esc(it.name)}" onerror="cxImgFail(this,'cx-thumb none')">` : '<span class="cx-thumb none">이미지 준비 중</span>') : '';
    return `<button class="cx-card${selKey === it.key ? ' sel' : ''}" data-key="${esc(it.key)}">
      ${thumb}<span class="cx-top">${sz}<span class="cx-gr ${grCls}">${esc(it.grade || '—')}</span></span>
      <span class="cx-name">${esc(it.name)}</span>${it.kind === 'ship' ? `<span class="cx-cat">${esc(it.cat)}${it.large ? ' · 대형' : ''}</span>` : ''}
      <span class="cx-mfr"${it.mfr ? ` style="color:${mfrColor(it.mfr)};font-weight:700"` : ''}>${esc(it.mfr || '')}</span>
      ${it.sub ? `<span class="cx-sub">${esc(it.sub)}</span>` : ''}
      <span class="cx-bars">${bars}</span>
    </button>`;
  }

  function groupKeyOf(it) {
    if (cat === 'ships') { const g = group === 'auto' ? (fCat === '' ? 'cat' : 'none') : group; return g === 'cat' ? it.cat : g === 'mfr' ? (it.mfr || '제조사 미확인') : null; }
    if (cat === 'weapons') return group === 'none' ? null : it.wtype;
    if (COMP_CATS.includes(cat) && group === 'cls') return CLS_KO[it.ccls];
    return null;
  }
  function renderGrid() {
    if (cat === 'personal') { renderPersonal(); return; }
    const arr = filtered();
    const maxes = barMaxFor(cat);
    const g = $('cxGrid');
    if (!arr.length) { g.innerHTML = '<div class="cx-empty">조건에 맞는 항목이 없습니다.</div>'; return; }
    const groups = new Map();
    arr.forEach(it => { const k = groupKeyOf(it); (groups.get(k) || groups.set(k, []).get(k)).push(it); });
    const order = cat === 'ships' ? (group === 'mfr' ? null : SHIP_CATS) : cat === 'weapons' ? WTYPES : null;
    let keys = [...groups.keys()];
    if (order) keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    else if (cat !== 'ships' && COMP_CATS.includes(cat)) keys.sort((a, b) => Object.values(CLS_KO).indexOf(a) - Object.values(CLS_KO).indexOf(b));
    else keys.sort((a, b) => String(a).localeCompare(String(b)));
    g.innerHTML = keys.map(k => (k == null ? '' : `<div class="cx-group-h">${esc(k)} <span>${groups.get(k).length}</span></div>`) + groups.get(k).map(it => cardHTML(it, maxes)).join('')).join('');
    g.querySelectorAll('.cx-card').forEach(c => c.onclick = () => {
      selKey = c.dataset.key;
      renderDetail(itemsOf(cat).find(it => it.key === selKey) || null);
    });
  }

  // ---- 구매처 (shops.json — UEX, 무기 89/197 매칭 등 일부만) ----
  async function ensureShops() {
    if (SHOPS || shopsTried) return;
    shopsTried = true;
    try { const r = await fetch('shops.json?v=11', { cache: 'no-store' }); if (r.ok) SHOPS = await r.json(); } catch (e) { /* 없으면 구매처 미확인 */ }
  }
  function shopHTML(cls) {
    if (!SHOPS || !SHOPS.items || !SHOPS.items[cls] || !SHOPS.items[cls].length)
      return '<div class="cx-shop fit-dim">구매처 미확인 (UEX 매칭 없음)</div>';
    const offers = SHOPS.items[cls].slice().sort((a, b) => a[1] - b[1]);
    const terms = SHOPS.terms || [];
    const rows = offers.slice(0, 5).map(([t, p]) => {
      const st = terms[t] || {};
      return `<div>· ${esc(st.n || '판매점 ' + t)} <span class="pr">${fmt0(p)} aUEC</span></div>`;
    }).join('');
    return `<div class="cx-shop"><b>구매처 (UEX ${esc((SHOPS.meta || {}).fetched || '')} 기준, 최저가 순 ${offers.length}곳 중 상위)</b>${rows}</div>`;
  }

  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${v == null || v === '' ? '없음' : v}</td></tr>`;
  const pct = v => v == null ? null : (v * 100).toFixed(0) + '%';

  function detailRows(it) {
    const r = it.raw;
    if (it.kind === 'ship') {
      const ss = shipStatusMap(); const st = (ss && ss.ships && ss.ships[r.class]) || null;
      const ag = r.agility || {}, ac = r.accel || {}, ifcs = r.ifcs || {};
      return [
        row('분류', `${esc(r.career || '')}${r.role ? ' · ' + esc(r.role) : ''}`),
        row('크기', 'S' + r.size), row('승무원', r.crew ?? null), row('화물', r.cargo ?? null),
        row('스톡 버스트 DPS', fmt(r.stockDps)),
        row('스톡 지속 DPS', fmt(r.stockSus)),
        row('스톡 알파', fmt(r.stockAlpha)),
        r.turretDps != null ? row('터렛 버스트 DPS', fmt(r.turretDps)) : '',
        row('미사일 합산 피해', r.stockMsl != null ? fmt0(r.stockMsl) : null),
        row('회전 °/s', ag.Pitch != null ? `P ${ag.Pitch}° · Y ${ag.Yaw}° · R ${ag.Roll}°` : null),
        row('가속 m/s²', ac.Main != null ? `Main ${fmt(ac.Main)} · Maneuver ${fmt(ac.Maneuver)}` : null),
        row('속도 m/s', ifcs.ScmSpeed != null ? `SCM ${ifcs.ScmSpeed} · MAX ${ifcs.MaxSpeed ?? '—'} · BST ${ifcs.BoostSpeedForward ?? '—'}` : null),
        row('EM 시그니처', r.emTotal != null ? `${fmt0(r.emTotal)} (QD시 ${fmt0(r.emQuantum)})` : null),
        row('IR 시그니처', fmt0(r.irTotal)),
        row('스톡 발전', r.stockGen != null ? r.stockGen + '핍' : null),
        row('패치 상태', st ? (st.st === 'special' ? `<span style="color:var(--warn)">⚠ 특수 — ${esc(st.note || '획득 경로 제한')}</span>` : esc(st.st)) : '없음'),
      ].join('');
    }
    if (it.kind === 'weapon') {
      const modes = (r.modes || []).map(m => `${m.name} ${m.rpm}rpm`).join(' · ');
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('종류', esc(r.family || '') + (r.cls ? ' · ' + esc(r.cls) : '')),
        row('DPS', fmt(r.dps)), row('지속 DPS', fmt(r.sustain)), row('알파', fmt(r.alpha)),
        row('발사 모드', esc(modes)),
        row('사거리', r.range != null ? fmt0(r.range) + 'm' : null),
        row('탄속', r.speed != null ? fmt0(r.speed) + 'm/s' : null),
        row('분당 발사', r.rpm != null ? r.rpm + 'rpm' : null),
        row('피해 유형', esc((r.dmgtype || []).join(' + '))),
        (r.vn || []).length ? row('닉네임·스킨 변형', esc(r.vn.join(', ')) + ' — 성능 동일, 대표 모델로 통합') : '',
      ].join('');
    }
    if (it.kind === 'shield') {
      const ab = r.absorption || {};
      const absAvg = t => { const v = ab[t]; if (!v) return null; const lo = v.Minimum != null ? v.Minimum : 1, hi = v.Maximum != null ? v.Maximum : 1; return pct((lo + hi) / 2) + (lo !== hi ? ` (${pct(lo)}~${pct(hi)})` : ''); };
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('HP', fmt0(r.hp)), row('재생/s', fmt(r.regen)),
        row('피격 후 재생 지연', r.damagedDelay != null ? r.damagedDelay + 's' : null),
        row('다운 후 지연', r.downedDelay != null ? r.downedDelay + 's' : null),
        row('흡수율 Physical', absAvg('Physical')),
        row('흡수율 Energy', absAvg('Energy')),
        row('흡수율 Distortion', absAvg('Distortion')),
      ].join('');
    }
    if (it.kind === 'power')
      return [row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')), row('출력', (r.pwGen != null ? r.pwGen : r.output) + '핍')].join('');
    if (it.kind === 'cooler')
      return [row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')), row('냉각량', fmt(r.rate))].join('');
    if (it.kind === 'qd') {
      const spd = r.driveSpeed || r.speed;
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('속도', spd != null ? `${fmt0(spd)} m/s (${(spd / C_LIGHT * 100).toFixed(1)}%c)` : null),
        row('10Gm 이동', r.t10gm != null ? Math.round(r.t10gm) + 's' : null),
        row('스풀', r.spool != null ? r.spool + 's' : null),
        row('쿨다운', r.cooldown != null ? r.cooldown + 's' : null),
        row('연료 요구량', r.fuelReq != null ? r.fuelReq + ' SCU/Gm' : null),
      ].join('');
    }
    if (it.kind === 'missile')
      return [row('크기', 'S' + r.size), row('제조사', esc(r.mfr || '')), row('피해(합계)', fmt0(r.damage)), row('피해 유형', (() => { const mm = mmeta(r.class); return mm ? esc(Object.entries(mm.dmg).map(([k, v]) => k + ' ' + fmt0(v)).join(' + ')) : null; })())].join('');
    if (it.kind === 'rack')
      return [row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')), row('장전 수', r.missiles), row('미사일 크기', r.msize != null ? 'S' + r.msize : null)].join('');
    if (it.kind === 'radar') {
      const det = r.detection || {};
      const sen = det.Sensitivity || {}, pier = det.Piercing || {};
      const f = o => ['IR', 'CS', 'EM', 'RS'].map(k => `${k} ${o[k] != null ? o[k] : '—'}`).join(' · ');
      return [
        row('크기', 'S' + r.size), row('등급', esc(r.grade || '')), row('제조사', esc(r.mfr || '')),
        row('탐지 감도', esc(f(sen))), row('관통', esc(f(pier))),
      ].join('');
    }
    return '';
  }

  function missileInfographic(it) {
    const mm = mmeta(it.raw.class);
    if (!mm) return '<div class="cx-shop fit-dim">이 항목은 미사일 상세 원본 데이터가 없어 도식을 만들지 않았습니다.</div>';
    const dm = mm.dmg || {}, tot = Object.values(dm).reduce((a, b) => a + b, 0) || 1;
    const DM_KO = { Physical: '물리(Physical) 피해', Energy: '에너지', Distortion: '디스토션' };
    const bar = Object.entries(dm).map(([k, v]) => `<div class="mi-dm"><span>${esc(DM_KO[k] || k)}</span><span class="mi-bar"><i class="${k}" style="width:${Math.max(3, v / tot * 100)}%"></i></span><b>${fmt0(v)}</b></div>`).join('');
    const bl = mm.blast || [], pr = mm.prox;
    const bMax = bl[1] || 0, bMin = bl[0] || 0, scale = 70 / Math.max(bMax, 1);
    const svg = `<svg viewBox="0 0 320 170" class="mi-svg" role="img" aria-label="${esc(it.name)} 폭발 반경 도식">
      <rect width="320" height="170" rx="10" fill="#0b1119"/>
      <circle cx="210" cy="85" r="${(bMax * scale).toFixed(1)}" fill="#ff8a3d" fill-opacity=".15" stroke="#ff8a3d" stroke-dasharray="4 3"/>
      <circle cx="210" cy="85" r="${Math.max(2, bMin * scale).toFixed(1)}" fill="#ff5a3d" fill-opacity=".45" stroke="#ff5a3d"/>
      <circle cx="210" cy="85" r="3" fill="#fff"/>
      <path d="M20 85 H${210 - Math.max(2, bMin * scale) - 4}" stroke="#4cc2ff" stroke-width="3" marker-end="url(#ar)"/>
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#4cc2ff"/></marker></defs>
      <text x="20" y="72" fill="#4cc2ff" font-size="11">${esc(TRACK_KO[mm.track] || '추적')} 추적</text>
      <text x="20" y="108" fill="#8fa3b8" font-size="10">락 ${mm.lockT != null ? mm.lockT + 's' : '—'} · 유효 ${mm.lockR != null ? fmt0(mm.lockR) + 'm' : '—'}</text>
      <text x="210" y="${Math.min(160, 85 + bMax * scale + 14).toFixed(0)}" fill="#ffb98a" font-size="10" text-anchor="middle">폭발 반경 ${bMin}~${bMax}m</text>
    </svg>`;
    return `<div class="mi-wrap"><div class="mi-h">공격 형태 도식 <span>게임 데이터 값 기반 · 실제 체감 거동 측정 아님</span></div>${svg}
      <div class="mi-dms">${bar}</div>
      <ul class="mi-list">
        <li><b>추적 신호</b> ${esc(TRACK_KO[mm.track] || '미확인')} — 표적의 해당 신호를 따라 유도</li>
        <li><b>폭발</b> 근접 신관 ${pr != null ? pr + 'm' : '—'} · 안전거리 ${mm.safe != null ? fmt0(mm.safe) + 'm' : '—'} · 무장 ${mm.arm != null ? mm.arm + 's' : '—'}</li>
        <li><b>탄두</b> ${mm.cluster ? '클러스터(자탄 분산)' : '단일 탄두'}</li>
        <li><b>비행</b> 속도 ${mm.speed != null ? fmt0(mm.speed) + 'm/s' : '—'} · 사거리 ${mm.range != null ? fmt0(mm.range) + 'm' : '—'} · 수명 ${mm.life != null ? mm.life + 's' : '—'}</li>
      </ul></div>`;
  }

  function closeModal() { const m = $('cxModal'); if (m) m.remove(); selKey = null; document.body.classList.remove('cx-modal-open'); }
  function renderDetail(it) {
    const old = $('cxModal'); if (old) old.remove();
    if (!it) { document.body.classList.remove('cx-modal-open'); return; }
    const ssm = shipStatusMap(); const badge = it.kind === 'ship' && ssm && ssm.ships && ssm.ships[it.raw.class] && ssm.ships[it.raw.class].st === 'special'
      ? ' <span class="badge" style="color:var(--warn)">⚠ 특수</span>' : '';
    const img = it.kind === 'ship' ? (it.img ? `<img class="cx-m-img" src="${esc(it.img)}" alt="${esc(it.name)}" onerror="cxImgFail(this,'cx-m-img none')"><div class="cx-m-cred">이미지: RSI 공식 스토어</div>` : '<div class="cx-m-img none">이미지 준비 중</div>') : '';
    const extra = it.kind === 'missile' ? missileInfographic(it) : '';
    const head = it.kind === 'ship' ? `<div class="cx-d-sub"><b>${esc(it.cat)}</b>${it.large ? ' · 대형함(S5+ 임시 기준)' : ''} · ${esc(it.sub || '')}${it.mfr ? ` · <b style="color:${mfrColor(it.mfr)}">${esc(it.mfr)}</b>` : ''}</div>`
      : `<div class="cx-d-sub">${esc(it.sub || '')}${it.mfr ? ` · <b style="color:${mfrColor(it.mfr)}">${esc(it.mfr)}</b>` : ''}</div>`;
    const m = document.createElement('div');
    m.id = 'cxModal'; m.className = 'cx-modal-back';
    m.innerHTML = `<div class="cx-modal panel" role="dialog" aria-modal="true"><h3>${esc(it.name)}${badge}<button class="modal-x cx-close" id="cxClose" aria-label="닫기">✕</button></h3>${img}${head}${extra}<table class="cx-d-table">${detailRows(it)}</table>`
      + (it.kind === 'ship' ? `<button class="cx-fit-btn" id="cxFit">🛠️ 이 함선으로 피팅하기</button>` : shopHTML(it.raw.class)) + '</div>';
    document.body.appendChild(m); document.body.classList.add('cx-modal-open');
    $('cxClose').onclick = closeModal;
    const fb = $('cxFit');
    if (fb) fb.onclick = () => {
      closeModal();
      if (window.switchView) switchView('fitting');
      if (typeof selectShip === 'function') selectShip(it.raw.slug);
    };
  }

  async function ensureMeta() {
    try { const r = await fetch('ship_meta.json?v=9'); if (r.ok) SMETA = await r.json(); } catch (e) { /* 이미지·제조사 없음 */ }
    try { const r = await fetch('missile_meta.json?v=1'); if (r.ok) MMETA = await r.json(); } catch (e) { /* */ }
  }
  async function build() {
    await ensureMeta();
    buildHead();
    renderGrid();
    ensureShops();
  }

  // app.js 최상위가 let 이라 window.DB 로는 못 읽는다 — 스크립트 전역 렉시컬 바인딩으로 접근.
  function dbOk() { try { return typeof DB !== 'undefined' && !!DB; } catch (e) { return false; } }
  function shipStatusMap() { try { return typeof SHIP_STATUS !== 'undefined' ? SHIP_STATUS : null; } catch (e) { return null; } }

  // app.js의 상단 메뉴가 스타도감을 열 때 호출
  window.codexShow = function () {
    if (!dbOk()) return; // DB 로드 전이면 app.js init 완료 후 다시 호출됨
    if (!built) { built = true; build(); }
  };
})();
